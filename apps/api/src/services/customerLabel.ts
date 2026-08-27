/**
 * Bild-Bezeichnung in der Kundengalerie — die serverseitigen
 * Entscheidungen dazu.
 *
 * Als eigene Datei und nicht inline in routes/galleries.ts, weil hier
 * eine Datenschutz-Entscheidung liegt, die man testen und nicht
 * versehentlich umdrehen will: ob der echte Dateiname das Haus verlaesst.
 */

/** Die drei Modi aus Gallery.customerLabelMode. */
export type CustomerLabelMode = "hidden" | "filename" | "index";

/**
 * Darf der echte Dateiname in die Customer-Antwort?
 *
 * NUR bei Modus "filename". Bei "hidden" und "index" bleibt er komplett
 * draussen — nicht bloss unsichtbar im Frontend. Der Grund: die
 * Nummernfolge der Dateinamen verraet, wie viele Aufnahmen aussortiert
 * wurden (IMG_4821 bei 40 gezeigten Bildern), und manche Studios haben
 * interne Shoot-Codes oder Kundennamen im Dateinamen. Wuerden wir ihn
 * mitsenden und nur nicht rendern, stuende er im Netzwerk-Tab — also
 * genau bei dem Kunden, der genau danach sucht.
 *
 * Unbekannte/fehlende Werte gelten als "nicht ausliefern" (fail closed):
 * bei einem kaputten oder neuen Enum-Wert ist Zurueckhalten die
 * harmlosere Richtung.
 */
export function shouldExposeFilename(
  mode: CustomerLabelMode | string | null | undefined
): boolean {
  return mode === "filename";
}

/**
 * Ist der Modus einer, bei dem der Kunde ueberhaupt etwas zu sehen
 * bekommt? Steuert im Frontend, ob der Ein-/Ausblenden-Toggle
 * angeboten wird — hier fuer die Wiederverwendung in Tests und
 * moeglichen weiteren Serverpfaden.
 */
export function hasVisibleLabel(
  mode: CustomerLabelMode | string | null | undefined
): boolean {
  return mode === "filename" || mode === "index";
}
