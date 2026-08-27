import type { CustomerLabelMode, PublicFile } from "./api";

/**
 * Bild-Bezeichnung in der KUNDENGALERIE.
 *
 * Warum zentral und nicht inline an den drei Render-Stellen (Grid,
 * Lightbox, Slideshow): der Modus entscheidet nicht nur ueber den Text,
 * sondern auch darueber, ob `file.filename` ueberhaupt gesetzt ist. Bei
 * customerLabelMode = "hidden" liefert die API den Dateinamen gar nicht
 * mit. Jede Stelle, die selbst `file.filename` rendert, wuerde dort ein
 * leeres "null" anzeigen.
 *
 * `visible` ist der Kunden-Toggle (siehe customerLabelToggleEnabled). Er
 * schaltet NUR zwischen Modus und "aus" — er kann den Modus nicht
 * wechseln, sonst koennte der Kunde die vom Studio versteckten
 * Dateinamen hervorholen.
 */
export function fileLabel(
  file: Pick<PublicFile, "filename" | "labelIndex">,
  mode: CustomerLabelMode | undefined,
  total: number,
  visible: boolean,
  t: (key: string, vars?: Record<string, string | number>) => string
): string | null {
  if (!visible) return null;
  if (mode === "filename") {
    // Fallback auf die Nummer, falls der Server (aelterer Stand,
    // Race nach Settings-Wechsel) keinen Namen mitgeliefert hat.
    return (
      file.filename ??
      t("gallery.labelIndex", { n: file.labelIndex, total })
    );
  }
  if (mode === "index") {
    return t("gallery.labelIndex", { n: file.labelIndex, total });
  }
  return null;
}

/**
 * Dateiname fuer Web-Share / clientseitigen Blob-Download in der
 * Kundengalerie.
 *
 * Getrennt von fileLabel(), weil hier andere Regeln gelten: der Kunde
 * DARF die Datei ja herunterladen, es geht nur darum, dass wir ohne
 * `filename` im Payload trotzdem etwas Vernuenftiges an das Blob
 * haengen. Der echte Download-Endpoint setzt seinen Namen
 * serverseitig per Content-Disposition — der hier greift nur fuer
 * navigator.share() und Blob-Links.
 *
 * Bewusst nicht lokalisiert: das wird ein Dateiname auf dem Geraet des
 * Kunden, und Umlaute/Sonderzeichen aus uebersetzten Strings sind in
 * Dateinamen mehr Risiko als Gewinn.
 */
export function shareFilename(
  file: Pick<PublicFile, "filename" | "labelIndex" | "mimeType">
): string {
  if (file.filename) return file.filename;
  const ext = extFromMime(file.mimeType);
  const n = String(file.labelIndex).padStart(3, "0");
  return `image-${n}${ext}`;
}

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/avif": ".avif",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "application/pdf": ".pdf",
  };
  return map[mime] ?? "";
}
