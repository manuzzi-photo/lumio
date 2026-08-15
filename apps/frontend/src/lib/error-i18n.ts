"use client";

/**
 * Uebersetzung von Fehlermeldungen aus der API.
 *
 * Die API antwortet im Fehlerfall mit einem stabilen Code und einem
 * deutschen Klartext:
 *
 *     reply.status(400).send({ error: "wrong_current_password",
 *                              message: "Aktuelles Passwort ist nicht korrekt." })
 *
 * api.ts wirft daraus einen ApiError mit `code` und `message`. Angezeigt
 * wurde bisher `message` — also deutscher Text, egal welche Sprache die
 * Oberflaeche hatte.
 *
 * Uebersetzt wird ueber den CODE, nicht ueber den Text: der Code ist stabil,
 * der Text kann sich jederzeit aendern, ohne dass eine Uebersetzung bricht.
 * Fehlt ein Code im Dictionary, gewinnt die Meldung aus der API — deutscher
 * Text ist ein schlechter, aber brauchbarer Rueckfall; ein roher Key waere
 * keiner.
 *
 * Neuen Fehlercode ergaenzen: `error: "foo_bar"` in der API -> Key
 * `apiError.fooBar` in en/de/it.
 */
import { ApiError } from "@/lib/api";
import { useT } from "@/lib/i18n";

/** "wrong_current_password" -> "wrongCurrentPassword" */
function camel(code: string): string {
  return code
    .split(/[_-]/)
    .filter(Boolean)
    .map((part, i) => (i === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join("");
}

export interface ErrorTextResolver {
  /**
   * Liefert den anzuzeigenden Text zu einem gefangenen Fehler.
   *
   * @param err       Der gefangene Wert — bewusst `unknown`, weil in einem
   *                  catch-Block alles ankommen kann.
   * @param fallback  Text fuer den Fall, dass es weder Code noch Message
   *                  gibt (Netzwerkabbruch, geworfener String).
   */
  (err: unknown, fallback?: string): string;
}

export function useErrorText(): ErrorTextResolver {
  const t = useT();
  return (err, fallback) => {
    if (err instanceof ApiError && err.code) {
      const key = `apiError.${camel(err.code)}`;
      const translated = t(key);
      // t() gibt bei fehlendem Key den Key selbst zurueck.
      if (translated !== key) return translated;
    }
    if (err instanceof Error && err.message) return err.message;
    return fallback ?? t("common.error");
  };
}

/**
 * Fehler-Codes, die aus dem Worker in der Datenbank stehen
 * (zip_downloads.errorMessage und Verwandte).
 *
 * Getrennt von useErrorText(), weil die Quelle eine andere ist: hier kommt
 * kein ApiError, sondern ein String aus einem DB-Feld.
 *
 * Der Unterschied im Rueckfall ist Absicht. Bei einem API-Fehler ist die
 * Meldung von uns formuliert und darf notfalls durchgereicht werden. Hier
 * kann der Wert noch eine rohe Python-Exception aus der Zeit vor v0.65.x
 * sein — die enthaelt womoeglich Bucket-Namen oder Serverpfade und geht
 * einen Galerie-Gast nichts an. Deshalb gewinnt bei unbekanntem Wert der
 * generische Text, nicht der Wert selbst.
 */
export function useWorkerErrorText(): (code: string) => string {
  const t = useT();
  return (code) => {
    // Codes sind snake_case ohne Leerzeichen. Alles andere ist Alt-Text.
    if (/^[a-z][a-z0-9_]*$/.test(code)) {
      const key = `apiError.${camel(code)}`;
      const translated = t(key);
      if (translated !== key) return translated;
    }
    return t("apiError.zipBuildFailed");
  };
}

