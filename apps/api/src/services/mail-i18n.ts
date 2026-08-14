/**
 * Sprache ausgehender Mails.
 *
 * Bewusst getrennt vom Frontend-Dictionary in apps/frontend/src/lib/i18n:
 * das haengt am Cookie des jeweiligen Browsers und beschreibt, was EINE
 * Person gerade auf dem Bildschirm sieht. Eine Mail wird dagegen
 * serverseitig fuer jemand anderen gebaut, oft lange nachdem diese Person
 * zuletzt da war — teilweise fuer Leute ohne Konto, die nie eine
 * Spracheinstellung hatten.
 *
 * Drei Empfaengergruppen, drei Quellen:
 *
 *   1. Studio-Team (Kommentar-Benachrichtigung, Speicherwarnung,
 *      Passwort-Reset) -> User.locale. Die persoenliche Sprache des
 *      Empfaengers, nicht die des Studios: eine Agentur kann eine
 *      englischsprachige Mitarbeiterin haben.
 *   2. Endkunden des Studios (Galerie-Einladung, Upload-Bestaetigung,
 *      Ablauf-Hinweis) -> Tenant.locale. Deren eigene Sprache kennen wir
 *      nicht, also folgt sie dem Studio.
 *   3. Super-Admin (neuer Tenant, Digest) -> DEFAULT_MAIL_LOCALE.
 *
 * Ueberall gilt: null faellt auf DEFAULT_MAIL_LOCALE zurueck, und das ist
 * per Default "de". Ein Bestand ohne gesetzte Felder verhaelt sich damit
 * exakt wie vor Einfuehrung dieses Moduls.
 */
import { config } from "../config.js";
import { prisma } from "../db.js";
import { logger } from "../logger.js";

export type MailLocale = "de" | "en";

const SUPPORTED: readonly MailLocale[] = ["de", "en"] as const;

/** Akzeptiert auch "de-DE" o.ae. und faellt sonst auf den Default zurueck. */
export function normalizeLocale(value: string | null | undefined): MailLocale {
  if (!value) return config.DEFAULT_MAIL_LOCALE as MailLocale;
  const base = value.toLowerCase().split(/[-_]/)[0];
  return (SUPPORTED as readonly string[]).includes(base)
    ? (base as MailLocale)
    : (config.DEFAULT_MAIL_LOCALE as MailLocale);
}

/**
 * Sprache fuer Mails an die KUNDEN eines Studios.
 *
 * Fehlschlaege werden geschluckt und auf den Default abgebildet: eine
 * nicht aufloesbare Sprache darf keinen Mailversand verhindern.
 */
export async function tenantMailLocale(tenantId: string): Promise<MailLocale> {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { locale: true },
    });
    return normalizeLocale(tenant?.locale);
  } catch (err) {
    logger.warn({ err, tenantId }, "tenantMailLocale failed, using default");
    return config.DEFAULT_MAIL_LOCALE as MailLocale;
  }
}

/** Sprache fuer Mails an ein einzelnes Team-Mitglied. */
export async function userMailLocale(userId: string): Promise<MailLocale> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { locale: true },
    });
    return normalizeLocale(user?.locale);
  } catch (err) {
    logger.warn({ err, userId }, "userMailLocale failed, using default");
    return config.DEFAULT_MAIL_LOCALE as MailLocale;
  }
}

/** Sprache fuer Mails an den Betreiber der Instanz. */
export function instanceMailLocale(): MailLocale {
  return config.DEFAULT_MAIL_LOCALE as MailLocale;
}

/**
 * Ersetzt {platzhalter} durch Werte. Fehlende Werte bleiben als Literal
 * stehen, damit ein Tippfehler im Template sichtbar wird statt eine Luecke
 * in der Mail zu hinterlassen.
 */
export function interpolate(
  template: string,
  vars?: Record<string, string | number>
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in vars ? String(vars[key]) : match
  );
}

/**
 * Ein Mail-Baustein in allen unterstuetzten Sprachen.
 *
 * Bewusst als Record ueber MailLocale statt als optionale Felder: so
 * erzwingt der Compiler eine Uebersetzung, sobald eine Sprache dazukommt.
 * Ein stiller Rueckfall auf Deutsch waere in einer Mail schlimmer als in
 * der Oberflaeche — der Empfaenger kann nicht einfach umschalten.
 */
export type Phrase = Record<MailLocale, string>;

export function phrase(
  p: Phrase,
  locale: MailLocale,
  vars?: Record<string, string | number>
): string {
  return interpolate(p[locale], vars);
}

/**
 * Bausteine, die in mehreren Templates vorkommen. Template-spezifische
 * Texte stehen beim jeweiligen Template in mail.ts, damit man sie beim
 * Lesen nicht suchen muss.
 */
export const common = {
  signature: { de: "— Lumio", en: "— Lumio" },
  openGallery: { de: "Galerie öffnen", en: "Open gallery" },
  viewGallery: { de: "Galerie ansehen", en: "View gallery" },
} satisfies Record<string, Phrase>;
