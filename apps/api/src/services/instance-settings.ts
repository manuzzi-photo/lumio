/**
 * Instanz-Einstellungen aus SystemConfig, synchron lesbar.
 *
 * Warum ein Cache: renderMailLayout() ist synchron und wird aus jedem
 * Mail-Template heraus aufgerufen. Die Fusszeile kann dort also nicht per
 * await aus der Datenbank geholt werden, ohne die gesamte Template-Schicht
 * auf async umzustellen — 32 Funktionen und jede Aufrufstelle, fuer einen
 * Wert, der sich praktisch nie aendert.
 *
 * Stattdessen: beim Start einmal laden, bei jeder Aenderung ueber die
 * Super-Admin-Oberflaeche sofort aktualisieren, und zusaetzlich nach
 * TTL_MS neu ziehen. Das letzte ist wichtig, wenn die API in mehreren
 * Prozessen laeuft: ein Schreibvorgang in Prozess A erreicht den Cache von
 * Prozess B sonst nie. Mit der TTL laufen sie binnen einer Minute wieder
 * zusammen — fuer eine Fusszeile die richtige Abwaegung.
 */
import { prisma } from "../db.js";
import { logger } from "../logger.js";

/** Fusszeile der Mails; ueberstimmt MAIL_FOOTER_TEXT aus der Umgebung. */
export const KEY_MAIL_FOOTER_TEXT = "mail_footer_text";
/** Ziel des Links in der Fusszeile; ueberstimmt MAIL_FOOTER_URL. */
export const KEY_MAIL_FOOTER_URL = "mail_footer_url";

export const MAIL_FOOTER_KEYS = [
  KEY_MAIL_FOOTER_TEXT,
  KEY_MAIL_FOOTER_URL,
] as const;

const TTL_MS = 60_000;

let cache = new Map<string, string>();
let loadedAt = 0;

/**
 * Laedt alle relevanten Keys neu. Faellt bei einem Datenbankfehler auf den
 * bisherigen Cache zurueck: eine Mail ohne aktuelle Fusszeile ist besser als
 * eine Mail, die gar nicht rausgeht.
 */
export async function refreshInstanceSettings(): Promise<void> {
  try {
    const rows = await prisma.systemConfig.findMany({
      where: { key: { in: [...MAIL_FOOTER_KEYS] } },
    });
    const next = new Map<string, string>();
    for (const row of rows) {
      if (row.value.trim() !== "") next.set(row.key, row.value);
    }
    cache = next;
    loadedAt = Date.now();
  } catch (err) {
    logger.warn({ err }, "instance-settings refresh failed, keeping cache");
  }
}

/**
 * Synchroner Zugriff. Ist der Cache aelter als die TTL, wird im Hintergrund
 * nachgeladen — der aktuelle Aufruf bekommt noch den alten Wert, statt auf
 * die Datenbank zu warten.
 */
export function instanceSetting(key: string): string | undefined {
  if (Date.now() - loadedAt > TTL_MS) {
    loadedAt = Date.now(); // verhindert einen Sturm paralleler Refreshes
    void refreshInstanceSettings();
  }
  return cache.get(key);
}

/** Schreiben und den lokalen Cache sofort nachziehen. */
export async function setInstanceSetting(
  key: string,
  value: string | null
): Promise<void> {
  const clean = value?.trim() ?? "";
  await prisma.systemConfig.upsert({
    where: { key },
    create: { key, value: clean },
    update: { value: clean },
  });
  if (clean === "") cache.delete(key);
  else cache.set(key, clean);
}

/** Alle verwalteten Werte, fuer die Super-Admin-Oberflaeche. */
export async function readMailFooterSettings(): Promise<{
  text: string | null;
  url: string | null;
}> {
  const rows = await prisma.systemConfig.findMany({
    where: { key: { in: [...MAIL_FOOTER_KEYS] } },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const pick = (k: string) => {
    const v = byKey.get(k)?.trim();
    return v ? v : null;
  };
  return {
    text: pick(KEY_MAIL_FOOTER_TEXT),
    url: pick(KEY_MAIL_FOOTER_URL),
  };
}
