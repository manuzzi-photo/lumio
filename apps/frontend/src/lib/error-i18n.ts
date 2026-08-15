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
