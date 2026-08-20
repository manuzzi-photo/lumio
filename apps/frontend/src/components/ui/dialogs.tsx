"use client";

/**
 * Ersatz fuer window.confirm() und window.prompt().
 *
 * Warum ueberhaupt: die eingebauten Dialoge werden in manchen Browsern
 * stillschweigend unterdrueckt — Brave auf iOS ist der Fall, den wir kennen.
 * Dann erscheint nichts, confirm() liefert false, und die Aktion bricht ab,
 * als haette jemand "Abbrechen" gedrueckt. Der Nutzer sieht einen Knopf, der
 * nichts tut. Bei prompt() ist es schlimmer: die Funktion ist dort nicht
 * benutzbar, weil die Eingabe gar nicht stattfinden kann.
 *
 * Die API ist bewusst nah am Original, damit die Umstellung an ~28 Stellen
 * eine kleine Aenderung pro Stelle bleibt:
 *
 *     if (!confirm("Wirklich loeschen?")) return;          // vorher
 *     if (!(await confirm({ message: someKey }))) return;   // nachher
 *
 * Der Unterschied: es muss `await` davor und die Funktion `async` sein.
 * Das ist kein Schoenheitsfehler, sondern der Kern der Sache — window.confirm
 * haelt den ganzen Browser an, ein gerendertes Modal kann das nicht.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { Modal, DialogActions } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n";

export interface ConfirmOptions {
  /** Fliesstext. Zeilenumbrueche mit \n werden als Absaetze gerendert. */
  message: string;
  /** Optionale Ueberschrift. */
  title?: string;
  /** Beschriftung des bestaetigenden Knopfes. Default: common.confirm */
  confirmLabel?: string;
  /** Beschriftung des abbrechenden Knopfes. Default: common.cancel */
  cancelLabel?: string;
  /** Faerbt den Bestaetigen-Knopf rot. Fuer Loeschungen. */
  destructive?: boolean;
}

export interface PromptOptions extends Omit<ConfirmOptions, "destructive"> {
  /** Vorbelegung des Eingabefeldes. */
  defaultValue?: string;
  placeholder?: string;
  /** Leere Eingabe ablehnen. Default: true. */
  required?: boolean;
}

interface DialogApi {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  /** Liefert den eingegebenen Text, oder null bei Abbruch. */
  prompt: (opts: PromptOptions) => Promise<string | null>;
  /**
   * Kurze Mitteilung, Ersatz fuer window.alert().
   *
   * Bewusst KEIN Dialog: alert() wurde ausschliesslich in Fehlerpfaden
   * benutzt ("Konnte nicht gespeichert werden"), und dafuer ist ein modales
   * Fenster mit OK-Knopf zu schwer — es unterbricht, obwohl es nichts
   * fragt. Eine Einblendung sagt dasselbe, ohne den Nutzer festzuhalten.
   */
  notify: (message: string, tone?: "error" | "info") => void;
}

const DialogContext = createContext<DialogApi | null>(null);

type State =
  | { kind: "none" }
  | { kind: "confirm"; opts: ConfirmOptions }
  | { kind: "prompt"; opts: PromptOptions; value: string };

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const t = useT();
  const [state, setState] = useState<State>({ kind: "none" });
  const [notice, setNotice] = useState<
    { message: string; tone: "error" | "info"; id: number } | null
  >(null);
  // Das Promise wird beim Oeffnen erzeugt und beim Klick aufgeloest.
  const resolveRef = useRef<((value: never) => void) | null>(null);

  const settle = useCallback((value: boolean | string | null) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setState({ kind: "none" });
    // Der Aufrufer wartet auf genau einen Wert; welcher Typ, weiss er selbst.
    (resolve as ((v: boolean | string | null) => void) | null)?.(value);
  }, []);

  const api = useMemo<DialogApi>(
    () => ({
      confirm: (opts) =>
        new Promise<boolean>((resolve) => {
          resolveRef.current = resolve as never;
          setState({ kind: "confirm", opts });
        }),
      notify: (message, tone = "error") => {
        const id = Date.now();
        setNotice({ message, tone, id });
        // Fehler laenger stehen lassen als Hinweise — man will sie lesen
        // koennen, ohne sie zu jagen.
        window.setTimeout(
          () => setNotice((cur) => (cur?.id === id ? null : cur)),
          tone === "error" ? 8000 : 4000
        );
      },
      prompt: (opts) =>
        new Promise<string | null>((resolve) => {
          resolveRef.current = resolve as never;
          setState({
            kind: "prompt",
            opts,
            value: opts.defaultValue ?? "",
          });
        }),
    }),
    []
  );

  const titleId = "dialog-title";

  return (
    <DialogContext.Provider value={api}>
      {children}

      {notice && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] max-w-md w-[calc(100%-2rem)]"
        >
          <div
            className={
              "rounded-md px-4 py-3 text-ui-sm shadow-lg border flex items-start gap-3 " +
              (notice.tone === "error"
                ? "bg-semantic-danger/10 border-semantic-danger/30 text-semantic-danger"
                : "bg-surface-raised border-line-subtle text-ink-secondary")
            }
          >
            <span className="flex-1">{notice.message}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="shrink-0 opacity-70 hover:opacity-100"
              aria-label={t("common.close")}
            >
              ×
            </button>
          </div>
        </div>
      )}

      {state.kind !== "none" && (
        <Modal
          onClose={() => settle(state.kind === "prompt" ? null : false)}
          labelledBy={state.opts.title ? titleId : undefined}
        >
          {state.opts.title && (
            <h2
              id={titleId}
              className="text-lg font-medium text-ink-primary mb-2"
            >
              {state.opts.title}
            </h2>
          )}

          {/* window.confirm rendert \n als Zeilenumbruch; hier entsprechend
              als Absaetze, damit vorhandene Texte gleich aussehen. */}
          {state.opts.message.split("\n").map((line, i) =>
            line.trim() === "" ? (
              <div key={i} className="h-2" />
            ) : (
              <p key={i} className="text-ui-sm text-ink-secondary">
                {line}
              </p>
            )
          )}

          {state.kind === "prompt" && (
            <input
              type="text"
              value={state.value}
              placeholder={state.opts.placeholder}
              onChange={(e) =>
                setState({ ...state, value: e.target.value })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const ok =
                    state.opts.required === false || state.value.trim() !== "";
                  if (ok) settle(state.value);
                }
              }}
              className="mt-3 w-full rounded-md border border-line-subtle bg-surface-raised px-3 py-2 text-ui text-ink-primary focus:border-accent focus:outline-none"
            />
          )}

          <DialogActions>
            <button
              type="button"
              onClick={() => settle(state.kind === "prompt" ? null : false)}
              className="px-3 py-1.5 rounded-md text-ui-sm text-ink-secondary hover:bg-surface-overlay transition-colors duration-motion"
            >
              {state.opts.cancelLabel ?? t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={
                state.kind === "prompt" &&
                state.opts.required !== false &&
                state.value.trim() === ""
              }
              onClick={() =>
                settle(state.kind === "prompt" ? state.value : true)
              }
              className={
                "px-3 py-1.5 rounded-md text-ui-sm font-medium disabled:opacity-40 transition-colors duration-motion " +
                (state.kind === "confirm" && state.opts.destructive
                  ? "bg-semantic-danger text-white hover:opacity-90"
                  : "bg-accent text-paper hover:opacity-90")
              }
            >
              {state.opts.confirmLabel ?? t("common.confirm")}
            </button>
          </DialogActions>
        </Modal>
      )}
    </DialogContext.Provider>
  );
}

/**
 * Wirft, wenn der Provider fehlt. Bewusst laut: ein stiller Rueckfall auf
 * window.confirm waere genau der Zustand, den diese Datei behebt.
 */
function useDialogs(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error("useConfirm/usePrompt requires <DialogProvider> above it");
  }
  return ctx;
}

export function useConfirm() {
  return useDialogs().confirm;
}

export function usePrompt() {
  return useDialogs().prompt;
}

export function useNotify() {
  return useDialogs().notify;
}
