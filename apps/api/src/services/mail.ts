/**
 * Lumio API — Mail Service
 *
 * SMTP-Versand via nodemailer. Wenn SMTP nicht konfiguriert ist
 * (z.B. lokales Dev oder Self-Hoster ohne Mail), läuft der Service im
 * No-Op-Modus und loggt die Mails — bricht aber nichts.
 *
 * Templates sind bewusst simpel: Text-Mails, keine HTML-Komplexität.
 * Wer schicker will, kann später ein React-Email-Setup darüberlegen.
 */
import nodemailer, { type Transporter } from "nodemailer";

import { config } from "../config.js";
import { logger } from "../logger.js";
import { prisma } from "../db.js";
import {
  common,
  instanceMailLocale,
  phrase,
  type MailLocale,
  type Phrase,
} from "./mail-i18n.js";

let _transport: Transporter | null = null;
let _initAttempted = false;

function getTransport(): Transporter | null {
  if (_initAttempted) return _transport;
  _initAttempted = true;

  if (!config.SMTP_HOST) {
    logger.info("mail: SMTP_HOST not set, running in no-op mode");
    return null;
  }

  _transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth:
      config.SMTP_USER && config.SMTP_PASSWORD
        ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }
        : undefined,
  });
  return _transport;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Optional HTML-Version. Wenn gesetzt, wird die Mail multipart
   *  (alternative) versendet: Klartext als Fallback fuer Clients die
   *  HTML nicht koennen/wollen, HTML als bevorzugte Darstellung. */
  html?: string;
  /** Optionale Antwortadresse fuer genau diese Mail. Ueberschreibt den
   *  globalen Default aus SMTP_REPLY_TO. Wenn beides fehlt, wird kein
   *  Reply-To-Header gesetzt. */
  replyTo?: string;
}

// ---------------------------------------------------------------------------
// Kontaktangaben in System-Mails
//
// Problem, das diese Helper loesen: Mail-Texte duerfen nicht blind
// "antworte einfach auf diese Mail" versprechen. Der Absender aus
// SMTP_FROM ist typischerweise eine noreply-Adresse ohne Postfach —
// Antworten landen im Nirvana und der Empfaenger merkt es nicht.
//
// Antworten funktioniert nur, wenn SMTP_REPLY_TO gesetzt UND das
// Postfach beim Provider auch wirklich existiert. Deshalb:
//   - SMTP_REPLY_TO gesetzt  → "antworten oder an <adresse> schreiben"
//   - nur SUPPORT_EMAIL      → "schreib an <adresse>"
//   - gar nichts konfiguriert→ kein Kontakt-Satz (statt einer fremden
//     Adresse; frueher stand ueberall fest support@lumio-cloud.de)
// ---------------------------------------------------------------------------

/** Zieht die nackte Mail-Adresse aus einem Header-Wert wie
 *  "Lumio Support <support@example.com>" oder "support@example.com". */
function bareAddress(value: string | undefined): string | null {
  if (!value) return null;
  const angle = value.match(/<([^>]+)>/);
  const addr = (angle ? angle[1] : value).trim();
  return addr.includes("@") ? addr : null;
}

/** Adresse, die in System-Mails als Support-Kontakt genannt wird.
 *  SUPPORT_EMAIL > SMTP_REPLY_TO > keine. */
export function supportAddress(): string | null {
  return bareAddress(config.SUPPORT_EMAIL) ?? bareAddress(config.SMTP_REPLY_TO);
}

/** Adresse fuer Produkt-Feedback. FEEDBACK_EMAIL > Support-Adresse. */
export function feedbackAddress(): string | null {
  return bareAddress(config.FEEDBACK_EMAIL) ?? supportAddress();
}

/** Kann der Empfaenger auf diese Mail antworten? Nur wenn ein
 *  Reply-To-Header gesetzt wird. */
function canReplyToMails(): boolean {
  return bareAddress(config.SMTP_REPLY_TO) !== null;
}

/**
 * Freundlicher Kontakt-Satz fuers Mail-Ende. Liefert null, wenn keine
 * Kontaktadresse konfiguriert ist — dann laesst der Aufrufer den Satz
 * einfach weg, statt eine tote Adresse zu nennen.
 */
export function supportHint(): string | null {
  const addr = supportAddress();
  if (!addr) return null;
  return canReplyToMails()
    ? `Fragen? Antworte einfach auf diese Mail oder schreib an ${addr}.`
    : `Fragen? Schreib uns an ${addr}.`;
}

/**
 * Dringlicher Kontakt-Satz fuer sicherheitsrelevante Hinweise
 * ("das warst du nicht?"). Ohne konfigurierte Adresse wird auf den
 * Betreiber der Instanz verwiesen — bei Self-Hostern ist das der
 * Admin, den der Empfaenger ohnehin kennt.
 */
export function urgentSupportHint(intro: string): string {
  const addr = supportAddress();
  if (!addr) {
    return `${intro} melde dich umgehend beim Betreiber dieser Lumio-Instanz.`;
  }
  return canReplyToMails()
    ? `${intro} antworte umgehend auf diese Mail oder schreib an ${addr}.`
    : `${intro} melde dich umgehend unter ${addr}.`;
}

/**
 * Feedback-Bitte fuer Lifecycle-Mails. Nennt nur dann einen Rueckkanal,
 * wenn es ihn wirklich gibt — sonst bleibt es bei der Frage ohne
 * Aufforderung, die ins Leere laufen wuerde.
 */
export function feedbackInvite(): string {
  const question =
    "Wir wären neugierig: War etwas unklar, hat etwas gefehlt oder war es einfach der falsche Zeitpunkt?";
  if (canReplyToMails()) {
    return `${question} Antworte gerne kurz auf diese Mail — wir lesen jede Antwort.`;
  }
  const addr = feedbackAddress();
  if (addr) {
    return `${question} Schreib uns gerne kurz an ${addr} — wir lesen jede Rückmeldung.`;
  }
  return question;
}

/**
 * Verschickt eine Mail. Wirft NIE — ein Mail-Problem darf keine
 * Business-Operation killen.
 *
 * Der Rueckgabewert sagt, ob es geklappt hat. Die meisten Aufrufer
 * ignorieren ihn (fire-and-forget ist dort richtig), aber wo eine
 * verlorene Mail den ganzen Vorgang sinnlos macht — Support-Anfragen
 * haben kein Auffangnetz in der DB — kann der Aufrufer damit einen
 * Fehler an den Nutzer zurueckgeben statt ein falsches "gesendet".
 *
 * No-Op (kein SMTP konfiguriert) zaehlt bewusst NICHT als Erfolg, sonst
 * sieht eine unkonfigurierte Instanz aus wie eine funktionierende.
 */
export async function sendMail(msg: MailMessage): Promise<boolean> {
  const transport = getTransport();
  if (!transport) {
    logger.info(
      { to: msg.to, subject: msg.subject },
      "mail (no-op, SMTP not configured)"
    );
    void logMail(msg.to, msg.subject, "skipped");
    return false;
  }
  try {
    await transport.sendMail({
      from: config.SMTP_FROM ?? "Lumio <noreply@lumio.local>",
      // Reply-To: pro Mail > globaler Default > gar nicht. Damit koennen
      // Empfaenger auch bei einem noreply-Absender einfach antworten.
      replyTo: msg.replyTo ?? config.SMTP_REPLY_TO,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    logger.info({ to: msg.to, subject: msg.subject }, "mail sent");
    void logMail(msg.to, msg.subject, "sent");
    return true;
  } catch (err) {
    logger.warn({ err, to: msg.to, subject: msg.subject }, "mail send failed");
    void logMail(
      msg.to,
      msg.subject,
      "failed",
      err instanceof Error ? err.message : String(err)
    );
    // Wir werfen NICHT — Mail-Fehler sollten Business-Operationen nicht killen
    return false;
  }
}

// Schreibt einen Zustell-Log-Eintrag. Komplett fail-safe: ein Fehler hier
// darf den Mailversand niemals beeinflussen.
async function logMail(
  recipient: string,
  subject: string,
  status: "sent" | "failed" | "skipped",
  error?: string
): Promise<void> {
  try {
    await prisma.mailLog.create({
      data: {
        recipient: recipient.slice(0, 500),
        subject: subject.slice(0, 500),
        status,
        error: error ? error.slice(0, 1000) : null,
      },
    });
  } catch (e) {
    logger.warn({ e }, "mailLog write failed");
  }
}

// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Templates
//
// Jedes Template gibt zurueck: { subject, text, html }
//   - text: Klartext-Fallback (manche Mail-Clients ziehen den vor; Tools wie
//     mutt zeigen ohnehin nur text)
//   - html: Schicke HTML-Variante mit Layout-Wrapper aus mail-layout.ts
//
// Templates die an Endkund:innen gehen (tmplGalleryInvite) duerfen
// optional Studio-Branding (Logo + Akzentfarbe) bekommen — siehe
// notifier.ts wo das geladen wird. System-Mails an den Fotograf nutzen
// das default Lumio-Branding.
// -----------------------------------------------------------------------------
import {
  renderMailLayout,
  mailParagraph,
  mailParagraphInterpolated,
  mailHeading,
  mailButton,
  mailBullets,
  mailDivider,
  mailNoticeBox,
  mailQuoteBlock,
  type MailBranding,
} from "./mail-layout.js";

/**
 * Empfaenger: Studio-Team. Sprache kommt daher aus User.locale, siehe
 * mail-i18n.ts. `locale` ist optional, damit bestehende Aufrufer ohne
 * Anpassung weiterlaufen — ohne Angabe gilt DEFAULT_MAIL_LOCALE.
 */
const newCommentPhrases = {
  subject: {
    de: 'Neuer Kommentar in "{title}"',
    en: 'New comment in "{title}"',
  },
  preheader: {
    de: '{author} hat in "{title}" kommentiert',
    en: '{author} commented in "{title}"',
  },
  heading: {
    de: "Neuer Kommentar in „{title}“",
    en: "New comment in “{title}”",
  },
  intro: {
    de: "{author} hat einen Kommentar hinterlassen:",
    en: "{author} left a comment:",
  },
} satisfies Record<string, Phrase>;

export function tmplNewComment(opts: {
  galleryTitle: string;
  galleryUrl: string;
  authorLabel: string;
  body: string;
  branding?: MailBranding;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const vars = { title: opts.galleryTitle, author: opts.authorLabel };
  return {
    subject: phrase(newCommentPhrases.subject, l, vars),
    text:
      `${phrase(newCommentPhrases.intro, l, vars)}\n\n` +
      `"${opts.body}"\n\n` +
      `${phrase(common.viewGallery, l)}: ${opts.galleryUrl}\n\n` +
      `${phrase(common.signature, l)}`,
    html: renderMailLayout({
      branding: opts.branding,
      preheader: phrase(newCommentPhrases.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(newCommentPhrases.heading, l, vars)) +
        mailParagraph(phrase(newCommentPhrases.intro, l, vars)) +
        mailQuoteBlock(opts.body, opts.branding?.accentColor) +
        mailButton(
          opts.galleryUrl,
          phrase(common.openGallery, l),
          opts.branding?.accentColor
        ),
    }),
  };
}

const selectionFinishedPhrases = {
  subject: { de: 'Auswahl fertig: "{title}"', en: 'Selection finished: "{title}"' },
  preheader: {
    de: "{who} hat {files} ausgewählt",
    en: "{who} selected {files}",
  },
  heading: { de: "Auswahl abgeschlossen", en: "Selection finished" },
  bodyText: {
    de: "{who} hat die Auswahl abgeschlossen ({files}).",
    en: "{who} finished their selection ({files}).",
  },
  bodyHtml: {
    de: "{who} hat die Auswahl in „{title}“ abgeschlossen — {files} markiert.",
    en: "{who} finished the selection in “{title}” — {files} marked.",
  },
  button: { de: "Auswahl ansehen", en: "View selection" },
  fileOne: { de: "1 Datei", en: "1 file" },
  fileMany: { de: "{n} Dateien", en: "{n} files" },
} satisfies Record<string, Phrase>;

export function tmplSelectionFinished(opts: {
  galleryTitle: string;
  galleryUrl: string;
  accessLabel: string;
  count: number;
  branding?: MailBranding;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = selectionFinishedPhrases;
  const files =
    opts.count === 1
      ? phrase(P.fileOne, l)
      : phrase(P.fileMany, l, { n: opts.count });
  const vars = { title: opts.galleryTitle, who: opts.accessLabel, files };
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${phrase(P.bodyText, l, vars)}\n\n` +
      `${phrase(common.viewGallery, l)}: ${opts.galleryUrl}\n\n` +
      `${phrase(common.signature, l)}`,
    html: renderMailLayout({
      branding: opts.branding,
      preheader: phrase(P.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(P.heading, l)) +
        mailParagraph(phrase(P.bodyHtml, l, vars)) +
        mailButton(opts.galleryUrl, phrase(P.button, l), opts.branding?.accentColor),
    }),
  };
}

/**
 * Empfaenger: die KUNDEN des Studios (Adressen am GalleryAccess).
 * Sprache folgt daher dem Studio, siehe mail-i18n.ts.
 */
const zipReadyPhrases = {
  subject: {
    de: 'Download bereit: "{title}"',
    en: 'Download ready: "{title}"',
  },
  preheader: {
    de: "Dein ZIP-Download ({files}) ist fertig",
    en: "Your ZIP download ({files}) is ready",
  },
  heading: { de: "Download bereit", en: "Download ready" },
  bodyText: {
    de: "Dein ZIP-Download mit {files} ist fertig:",
    en: "Your ZIP download with {files} is ready:",
  },
  bodyHtml: {
    de: "Dein ZIP-Download mit {files} aus „{title}“ ist fertig.",
    en: "Your ZIP download with {files} from “{title}” is ready.",
  },
  button: { de: "ZIP herunterladen", en: "Download ZIP" },
  validity: {
    de: "Der Link ist 7 Tage gültig.",
    en: "The link is valid for 7 days.",
  },
  fileOne: { de: "1 Datei", en: "1 file" },
  fileMany: { de: "{n} Dateien", en: "{n} files" },
} satisfies Record<string, Phrase>;

export function tmplZipReady(opts: {
  galleryTitle: string;
  downloadUrl: string;
  fileCount: number;
  branding?: MailBranding;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  // Singular/Plural als eigene Phrasen statt Wortanhang: das traegt auch
  // in Sprachen, die die Zahl anders behandeln als Deutsch/Englisch.
  const files =
    opts.fileCount === 1
      ? phrase(zipReadyPhrases.fileOne, l)
      : phrase(zipReadyPhrases.fileMany, l, { n: opts.fileCount });
  const vars = { title: opts.galleryTitle, files };
  return {
    subject: phrase(zipReadyPhrases.subject, l, vars),
    text:
      `${phrase(zipReadyPhrases.bodyText, l, vars)}\n\n` +
      `${opts.downloadUrl}\n\n` +
      `${phrase(zipReadyPhrases.validity, l)}\n\n` +
      `${phrase(common.signature, l)}`,
    html: renderMailLayout({
      branding: opts.branding,
      preheader: phrase(zipReadyPhrases.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(zipReadyPhrases.heading, l)) +
        mailParagraph(phrase(zipReadyPhrases.bodyHtml, l, vars)) +
        mailButton(
          opts.downloadUrl,
          phrase(zipReadyPhrases.button, l),
          opts.branding?.accentColor
        ) +
        mailNoticeBox(phrase(zipReadyPhrases.validity, l)),
    }),
  };
}

const storageWarningPhrases = {
  subject: {
    de: "Speicher fast voll: {percent}% belegt",
    en: "Storage almost full: {percent}% used",
  },
  preheader: {
    de: "Dein Speicher ist zu {percent}% belegt",
    en: "Your storage is {percent}% used",
  },
  heading: { de: "Speicher fast voll", en: "Storage almost full" },
  bodyText: {
    de: "Dein Lumio-Speicher ist zu {percent}% belegt ({used} von {limit} GB).",
    en: "Your Lumio storage is {percent}% used ({used} of {limit} GB).",
  },
  bodyHtml: {
    de: "Dein belegter Speicher liegt bei {percent}% — {used} von {limit} GB.",
    en: "Your used storage is at {percent}% — {used} of {limit} GB.",
  },
  consequence: {
    de: "Ist das Limit erreicht, sind keine neuen Uploads mehr möglich. Du kannst alte Galerien aufräumen oder deinen Speicher erweitern.",
    en: "Once the limit is reached, no new uploads are possible. You can clear out old galleries or increase your storage.",
  },
  button: { de: "Speicher & Tarif", en: "Storage & plan" },
} satisfies Record<string, Phrase>;

export function tmplStorageWarning(opts: {
  usedGib: number;
  limitGib: number;
  percent: number;
  billingUrl: string;
  branding?: MailBranding;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = storageWarningPhrases;
  const vars = {
    percent: opts.percent,
    used: opts.usedGib,
    limit: opts.limitGib,
  };
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${phrase(P.bodyText, l, vars)}\n\n` +
      `${phrase(P.consequence, l)}\n\n` +
      `${opts.billingUrl}\n\n${phrase(common.signature, l)}`,
    html: renderMailLayout({
      branding: opts.branding,
      preheader: phrase(P.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(P.heading, l)) +
        mailParagraph(phrase(P.bodyHtml, l, vars)) +
        mailParagraph(phrase(P.consequence, l)) +
        mailButton(opts.billingUrl, phrase(P.button, l), opts.branding?.accentColor),
    }),
  };
}

const ownerSetupPhrases = {
  subject: {
    de: 'Dein Lumio-Studio "{tenant}" ist bereit',
    en: 'Your Lumio studio "{tenant}" is ready',
  },
  preheader: {
    de: "Dein Studio „{tenant}“ wartet auf dich",
    en: "Your studio “{tenant}” is waiting for you",
  },
  greeting: { de: "Hallo {name},", en: "Hello {name}," },
  bodyText: {
    de: "{by} hat ein Lumio-Studio für dich angelegt:\n  {tenant}\n\nKlick auf den folgenden Link, um dein Passwort zu setzen und direkt loszulegen:",
    en: "{by} created a Lumio studio for you:\n  {tenant}\n\nUse the link below to set your password and get started:",
  },
  bodyHtml: {
    de: "{by} hat ein Lumio-Studio für dich angelegt: „{tenant}“. Setze jetzt dein Passwort und leg los.",
    en: "{by} created a Lumio studio for you: “{tenant}”. Set your password now and get started.",
  },
  button: { de: "Passwort setzen", en: "Set password" },
  validity: {
    de: "Der Link ist {hours} Stunden gültig. Falls die Frist abläuft, melde dich bei {by}.",
    en: "The link is valid for {hours} hours. If it expires, get in touch with {by}.",
  },
} satisfies Record<string, Phrase>;

export function tmplOwnerSetup(opts: {
  displayName: string;
  tenantName: string;
  setupUrl: string;
  invitedBy: string;
  validHours: number;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = ownerSetupPhrases;
  const vars = {
    name: opts.displayName,
    tenant: opts.tenantName,
    by: opts.invitedBy,
    hours: opts.validHours,
  };
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${phrase(P.greeting, l, vars)}\n\n` +
      `${phrase(P.bodyText, l, vars)}\n\n` +
      `${opts.setupUrl}\n\n` +
      `${phrase(P.validity, l, vars)}\n\n` +
      `${phrase(common.signature, l)}`,
    html: renderMailLayout({
      preheader: phrase(P.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(P.greeting, l, vars)) +
        mailParagraph(phrase(P.bodyHtml, l, vars)) +
        mailButton(opts.setupUrl, phrase(P.button, l)) +
        mailNoticeBox(phrase(P.validity, l, vars)),
    }),
  };
}

const passwordResetPhrases = {
  subject: {
    de: "Passwort zurücksetzen für „{tenant}“",
    en: "Reset your password for “{tenant}”",
  },
  preheader: {
    de: "Passwort-Reset für „{tenant}“",
    en: "Password reset for “{tenant}”",
  },
  greeting: { de: "Hallo {name},", en: "Hello {name}," },
  body: {
    de: "Du (oder jemand mit deiner E-Mail-Adresse) hat ein neues Passwort für dein Lumio-Studio „{tenant}“ angefordert.",
    en: "You (or someone with your email address) requested a new password for your Lumio studio “{tenant}”.",
  },
  instruction: {
    de: "Klick auf den folgenden Link, um ein neues Passwort zu setzen:",
    en: "Use the link below to set a new password:",
  },
  button: { de: "Neues Passwort setzen", en: "Set a new password" },
  validity: {
    de: "Der Link ist {hours} Stunden gültig.",
    en: "The link is valid for {hours} hours.",
  },
  requestedFromIp: {
    de: "Angefordert von IP-Adresse: {ip}",
    en: "Requested from IP address: {ip}",
  },
  notYou: {
    de: "Falls du das NICHT angefordert hast, kannst du diese Mail ignorieren — dein aktuelles Passwort bleibt gültig. Bei verdächtiger Aktivität melde dich bitte beim Studio-Owner.",
    en: "If you did NOT request this, you can ignore this email — your current password stays valid. If anything looks suspicious, please contact the studio owner.",
  },
  notYouShort: {
    de: "Falls du das NICHT angefordert hast, kannst du diese Mail ignorieren — dein aktuelles Passwort bleibt gültig.",
    en: "If you did NOT request this, you can ignore this email — your current password stays valid.",
  },
} satisfies Record<string, Phrase>;

export function tmplPasswordReset(opts: {
  displayName: string;
  tenantName: string;
  resetUrl: string;
  validHours: number;
  ipAddress?: string;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = passwordResetPhrases;
  const vars = {
    name: opts.displayName,
    tenant: opts.tenantName,
    hours: opts.validHours,
  };
  const ipLine = opts.ipAddress
    ? `${phrase(P.requestedFromIp, l, { ip: opts.ipAddress })}\n\n`
    : "";
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${phrase(P.greeting, l, vars)}\n\n` +
      `${phrase(P.body, l, vars)}\n\n` +
      `${phrase(P.instruction, l)}\n\n` +
      `${opts.resetUrl}\n\n` +
      `${phrase(P.validity, l, vars)}\n\n` +
      ipLine +
      `${phrase(P.notYou, l)}\n\n` +
      `${phrase(common.signature, l)}`,
    html: renderMailLayout({
      preheader: phrase(P.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(P.greeting, l, vars)) +
        mailParagraph(phrase(P.body, l, vars)) +
        mailButton(opts.resetUrl, phrase(P.button, l)) +
        mailNoticeBox(
          phrase(P.validity, l, vars) +
            (opts.ipAddress
              ? " " + phrase(P.requestedFromIp, l, { ip: opts.ipAddress })
              : "")
        ) +
        mailParagraph(phrase(P.notYouShort, l)),
    }),
  };
}

const emailChangeConfirmPhrases = {
  subject: {
    de: "Bestätige deine neue E-Mail-Adresse für „{tenant}“",
    en: "Confirm your new email address for “{tenant}”",
  },
  preheader: {
    de: "Bestätige den Wechsel zu {newEmail}",
    en: "Confirm the change to {newEmail}",
  },
  greeting: { de: "Hallo {name},", en: "Hello {name}," },
  body: {
    de: "Du hast deine E-Mail-Adresse für dein Lumio-Studio „{tenant}“ geändert:",
    en: "You changed the email address for your Lumio studio “{tenant}”:",
  },
  fromTo: { de: "  von: {old}\n  zu:  {new}", en: "  from: {old}\n  to:   {new}" },
  instruction: {
    de: "Klick auf den folgenden Link, um die Änderung zu bestätigen:",
    en: "Use the link below to confirm the change:",
  },
  button: { de: "Wechsel bestätigen", en: "Confirm change" },
  validity: {
    de: "Der Link ist {hours} Stunden gültig. Bis du klickst, bleibt deine alte E-Mail-Adresse aktiv.",
    en: "The link is valid for {hours} hours. Until you click it, your old address stays active.",
  },
  notYou: {
    de: "Bis du den Link klickst, bleibt deine alte E-Mail-Adresse aktiv. Falls du diesen Wechsel NICHT angefordert hast, ignoriere die Mail einfach.",
    en: "Until you click the link, your old address stays active. If you did NOT request this change, simply ignore this email.",
  },
} satisfies Record<string, Phrase>;

export function tmplEmailChangeConfirm(opts: {
  displayName: string;
  tenantName: string;
  oldEmail: string;
  newEmail: string;
  confirmUrl: string;
  validHours: number;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = emailChangeConfirmPhrases;
  const vars = {
    name: opts.displayName,
    tenant: opts.tenantName,
    hours: opts.validHours,
    newEmail: opts.newEmail,
  };
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${phrase(P.greeting, l, vars)}\n\n` +
      `${phrase(P.body, l, vars)}\n\n` +
      `${phrase(P.fromTo, l, { old: opts.oldEmail, new: opts.newEmail })}\n\n` +
      `${phrase(P.instruction, l)}\n\n` +
      `${opts.confirmUrl}\n\n` +
      `${phrase(P.notYou, l)}\n\n` +
      `${phrase(common.signature, l)}`,
    html: renderMailLayout({
      preheader: phrase(P.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(P.greeting, l, vars)) +
        mailParagraph(phrase(P.body, l, vars)) +
        mailParagraphInterpolated(`\${old} → \${new}`, {
          old: opts.oldEmail,
          new: opts.newEmail,
        }) +
        mailButton(opts.confirmUrl, phrase(P.button, l)) +
        mailNoticeBox(phrase(P.validity, l, vars)),
    }),
  };
}

const emailChangeNoticePhrases = {
  subject: {
    de: "E-Mail-Wechsel für „{tenant}“ angefordert",
    en: "Email change requested for “{tenant}”",
  },
  preheader: {
    de: "E-Mail-Wechsel auf {newEmail} angefordert",
    en: "Email change to {newEmail} requested",
  },
  greeting: { de: "Hallo {name},", en: "Hello {name}," },
  bodyText: {
    de: "Es wurde ein Wechsel deiner E-Mail-Adresse für dein Lumio-Studio „{tenant}“ angefordert. Die neue Adresse lautet:\n\n  {newEmail}",
    en: "A change of your email address for your Lumio studio “{tenant}” was requested. The new address is:\n\n  {newEmail}",
  },
  bodyHtml: {
    de: "Es wurde ein Wechsel deiner E-Mail-Adresse für dein Lumio-Studio „{tenant}“ angefordert. Neue Adresse: {newEmail}.",
    en: "A change of your email address for your Lumio studio “{tenant}” was requested. New address: {newEmail}.",
  },
  linkSent: {
    de: "An die neue Adresse haben wir einen Bestätigungslink geschickt. Erst nach Klick darauf ist der Wechsel vollzogen.",
    en: "We sent a confirmation link to the new address. The change only takes effect once it is clicked.",
  },
  ifNotYouText: {
    de: "Wenn du das selbst angefordert hast, brauchst du nichts weiter zu tun. Wenn NICHT, melde dich umgehend beim Studio-Owner und ändere dein Passwort — möglicherweise hat jemand Fremdes Zugriff auf deinen Account.",
    en: "If you requested this yourself, there is nothing more to do. If NOT, contact the studio owner immediately and change your password — someone else may have access to your account.",
  },
  ifNotYouBox: {
    de: "Wenn du das selbst angefordert hast, ist alles in Ordnung. Wenn NICHT, melde dich beim Studio-Owner und ändere dein Passwort — möglicherweise hat jemand Fremdes Zugriff auf deinen Account.",
    en: "If you requested this yourself, all is well. If NOT, contact the studio owner and change your password — someone else may have access to your account.",
  },
} satisfies Record<string, Phrase>;

export function tmplEmailChangeNotice(opts: {
  displayName: string;
  tenantName: string;
  newEmail: string;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = emailChangeNoticePhrases;
  const vars = {
    name: opts.displayName,
    tenant: opts.tenantName,
    newEmail: opts.newEmail,
  };
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${phrase(P.greeting, l, vars)}\n\n` +
      `${phrase(P.bodyText, l, vars)}\n\n` +
      `${phrase(P.linkSent, l)}\n\n` +
      `${phrase(P.ifNotYouText, l)}\n\n` +
      `${phrase(common.signature, l)}`,
    html: renderMailLayout({
      preheader: phrase(P.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(P.greeting, l, vars)) +
        mailParagraph(phrase(P.bodyHtml, l, vars)) +
        mailParagraph(phrase(P.linkSent, l)) +
        mailNoticeBox(phrase(P.ifNotYouBox, l)),
    }),
  };
}

/**
 * Galerie-Einladung — die EINZIGE Mail die optional Studio-Branding
 * bekommt (Logo + Akzentfarbe vom Studio). Geht an Endkunden, deshalb
 * soll der Fotograf vorne stehen, nicht Lumio.
 */
/**
 * Empfaenger: die KUNDEN des Studios. Deren eigene Sprache kennen wir
 * nicht — sie haben kein Konto und waren evtl. noch nie da. Die Sprache
 * folgt deshalb dem Studio (Tenant.locale), siehe mail-i18n.ts.
 */
const galleryInvitePhrases = {
  subject: {
    de: "Deine Galerie „{title}“ von {studio}",
    en: "Your gallery “{title}” from {studio}",
  },
  preheader: {
    de: "Deine Galerie „{title}“ ist bereit",
    en: "Your gallery “{title}” is ready",
  },
  greetingFallback: { de: "Hallo", en: "Hello" },
  introText: {
    de: "{name},\n\ndeine Galerie „{title}“ ist da. Über den folgenden Link kannst du:\n\n",
    en: "{name},\n\nyour gallery “{title}” is ready. Using the link below you can:\n\n",
  },
  introHtml: {
    de: "{name}, deine Galerie „{title}“ ist da.",
    en: "{name}, your gallery “{title}” is ready.",
  },
  whatYouCanDo: {
    de: "Was du in der Galerie tun kannst:",
    en: "What you can do in the gallery:",
  },
  capView: { de: "Bilder ansehen", en: "View the photos" },
  capSelect: {
    de: "Lieblings-Bilder markieren",
    en: "Mark your favourites",
  },
  capDownload: { de: "Bilder herunterladen", en: "Download the photos" },
  openGalleryLine: { de: "Galerie öffnen:", en: "Open the gallery:" },
  expiry: {
    de: "Der Link ist gültig bis {date}.",
    en: "The link is valid until {date}.",
  },
  sentVia: { de: "(verschickt via Lumio)", en: "(sent via Lumio)" },
  footerNote: {
    de: "Diese Mail wurde von {studio} über Lumio verschickt.",
    en: "This email was sent by {studio} via Lumio.",
  },
} satisfies Record<string, Phrase>;

export function tmplGalleryInvite(opts: {
  galleryTitle: string;
  shareUrl: string;
  studioName: string;
  recipientLabel: string;
  personalMessage?: string;
  canSelect: boolean;
  canDownload: boolean;
  expiresAt?: Date | null;
  /** Optional: Studio-Branding fuer die HTML-Mail. */
  branding?: MailBranding;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const greetingName =
    opts.recipientLabel || phrase(galleryInvitePhrases.greetingFallback, l);
  const vars = {
    title: opts.galleryTitle,
    studio: opts.studioName,
    name: greetingName,
  };

  // Datum in der Sprache des Empfaengers, nicht fest de-DE.
  const expiryText = opts.expiresAt
    ? phrase(galleryInvitePhrases.expiry, l, {
        date: opts.expiresAt.toLocaleDateString(l === "de" ? "de-DE" : "en-GB", {
          day: "2-digit",
          month: "long",
          year: "numeric",
        }),
      })
    : "";
  const expiryLine = expiryText ? `\n${expiryText}\n` : "";

  const capabilities: string[] = [phrase(galleryInvitePhrases.capView, l)];
  if (opts.canSelect)
    capabilities.push(phrase(galleryInvitePhrases.capSelect, l));
  if (opts.canDownload)
    capabilities.push(phrase(galleryInvitePhrases.capDownload, l));
  const capLines = capabilities.map((c) => `  • ${c}`).join("\n");

  const intro = opts.personalMessage
    ? `${opts.personalMessage}\n\n`
    : phrase(galleryInvitePhrases.introText, l, vars);

  const accent = opts.branding?.accentColor ?? null;

  return {
    subject: phrase(galleryInvitePhrases.subject, l, vars),
    text:
      intro +
      (opts.personalMessage
        ? `${phrase(galleryInvitePhrases.whatYouCanDo, l)}\n`
        : "") +
      capLines +
      `\n\n` +
      `${phrase(galleryInvitePhrases.openGalleryLine, l)}\n${opts.shareUrl}\n` +
      expiryLine +
      `\n` +
      `— ${opts.studioName}\n` +
      `\n` +
      `${phrase(galleryInvitePhrases.sentVia, l)}`,
    html: renderMailLayout({
      branding: {
        ...(opts.branding ?? {}),
        brandName: opts.studioName,
        footerNote: phrase(galleryInvitePhrases.footerNote, l, vars),
      },
      preheader: opts.personalMessage
        ? opts.personalMessage.slice(0, 100)
        : phrase(galleryInvitePhrases.preheader, l, vars),
      bodyHtml:
        (opts.personalMessage
          ? mailQuoteBlock(opts.personalMessage, accent)
          : mailParagraph(phrase(galleryInvitePhrases.introHtml, l, vars))) +
        mailParagraph(phrase(galleryInvitePhrases.whatYouCanDo, l)) +
        mailBullets(capabilities) +
        mailButton(opts.shareUrl, phrase(common.openGallery, l), accent) +
        (expiryText ? mailNoticeBox(expiryText) : ""),
    }),
  };
}

const welcomePhrases = {
  subject: {
    de: "Willkommen bei Lumio — dein Studio „{studio}“ ist startklar",
    en: "Welcome to Lumio — your studio “{studio}” is ready",
  },
  preheader: {
    de: "Dein Studio „{studio}“ ist startklar",
    en: "Your studio “{studio}” is ready",
  },
  greetingNamed: { de: "Hallo {name},", en: "Hello {name}," },
  greetingPlain: { de: "Hallo,", en: "Hello," },
  heading: { de: "Willkommen bei Lumio", en: "Welcome to Lumio" },
  bodyText: {
    de: "dein Lumio-Studio „{studio}“ ist angelegt und einsatzbereit. Du bist im {plan}-Plan mit einem 14-tägigen Trial — kostenlos bis zum {date}, kein Risiko.",
    en: "your Lumio studio “{studio}” is set up and ready. You are on the {plan} plan with a 14-day trial — free until {date}, no risk.",
  },
  bodyHtml: {
    de: "{prefix}dein Studio „{studio}“ ist angelegt und einsatzbereit. Du bist im {plan}-Plan mit einem 14-tägigen Trial — kostenlos bis zum {date}.",
    en: "{prefix}your studio “{studio}” is set up and ready. You are on the {plan} plan with a 14-day trial — free until {date}.",
  },
  loginAt: { de: "Einloggen kannst du dich jederzeit unter:", en: "You can sign in any time at:" },
  firstSteps: { de: "Erste Schritte für dein Studio:", en: "First steps for your studio:" },
  firstStepsHeading: { de: "Erste Schritte", en: "First steps" },
  step1: {
    de: "Branding anpassen (Logo, Farben, eigene Domain)",
    en: "Set up your branding (logo, colours, custom domain)",
  },
  step2: {
    de: "Eine erste Galerie anlegen und ein paar Bilder hochladen",
    en: "Create a first gallery and upload a few photos",
  },
  step3: {
    de: "Test-Share-Link an dich selbst schicken, um den Endkunden-Workflow zu durchlaufen",
    en: "Send yourself a test share link to walk through the customer flow",
  },
  button: { de: "Studio öffnen", en: "Open studio" },
  seeYouSoon: { de: "Bis bald", en: "See you soon" },
} satisfies Record<string, Phrase>;

export function tmplWelcome(opts: {
  displayName: string | null;
  studioName: string;
  studioUrl: string;
  trialEndsAt: Date;
  planName: string;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = welcomePhrases;
  const greeting = opts.displayName
    ? phrase(P.greetingNamed, l, { name: opts.displayName })
    : phrase(P.greetingPlain, l);
  const trialEnd = opts.trialEndsAt.toLocaleDateString(
    l === "de" ? "de-DE" : "en-GB",
    { day: "2-digit", month: "long", year: "numeric" }
  );
  const vars = {
    studio: opts.studioName,
    plan: opts.planName,
    date: trialEnd,
    prefix: opts.displayName ? opts.displayName + ", " : "",
  };
  const steps = [phrase(P.step1, l), phrase(P.step2, l), phrase(P.step3, l)];
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${greeting}\n\n` +
      `${phrase(P.bodyText, l, vars)}\n\n` +
      `${phrase(P.loginAt, l)}\n  ${opts.studioUrl}\n\n` +
      `${phrase(P.firstSteps, l)}\n` +
      steps.map((x) => `  • ${x}`).join("\n") +
      `\n\n` +
      (supportHint() ? `${supportHint()}\n\n` : "") +
      `${phrase(P.seeYouSoon, l)}\n${phrase(common.signature, l)}`,
    html: renderMailLayout({
      preheader: phrase(P.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(P.heading, l)) +
        mailParagraph(phrase(P.bodyHtml, l, vars)) +
        mailButton(opts.studioUrl, phrase(P.button, l)) +
        mailDivider() +
        mailHeading(phrase(P.firstStepsHeading, l)) +
        mailBullets(steps) +
        (supportHint() ? mailNoticeBox(supportHint()!) : ""),
    }),
  };
}

// ---------------------------------------------------------------------------
// Self-Service Tenant-Loeschung (DSGVO Art. 17)
// ---------------------------------------------------------------------------

export function tmplDeletionRequested(opts: {
  displayName: string | null;
  studioName: string;
  scheduledFor: Date;
  cancelUrl: string;
}): { subject: string; text: string; html: string } {
  const greeting = opts.displayName ? `Hallo ${opts.displayName},` : "Hallo,";
  const dateStr = opts.scheduledFor.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  return {
    subject: `Löschung deines Studios „${opts.studioName}" geplant`,
    text:
      `${greeting}\n\n` +
      `wir haben deine Anfrage zur Löschung deines Lumio-Studios ` +
      `„${opts.studioName}" erhalten.\n\n` +
      `Was jetzt passiert:\n` +
      `  • Deine Stripe-Subscription wurde sofort gekündigt — keine ` +
      `weitere Abrechnung.\n` +
      `  • Alle Galerien, Freigabe- und Upload-Links sind ab sofort ` +
      `offline. Deine Kundinnen und Kunden haben keinen Zugriff mehr.\n` +
      `  • Das Studio bleibt für 60 Tage in der Karenzphase. Die Daten ` +
      `bleiben in dieser Zeit vollständig erhalten.\n` +
      `  • Du kannst die Löschung bis zum ${dateStr} jederzeit ` +
      `zurücknehmen.\n` +
      `  • Am ${dateStr} werden alle Daten endgültig gelöscht.\n\n` +
      `Löschung zurücknehmen:\n${opts.cancelUrl}\n\n` +
      `${urgentSupportHint("Wenn du die Löschung NICHT angefordert hast,")}\n\n` +
      `— Lumio`,
    html: renderMailLayout({
      preheader: `Endgültige Löschung am ${dateStr} — bis dahin rücknehmbar`,
      bodyHtml:
        mailHeading(`Studio-Löschung geplant`) +
        mailParagraph(
          `${greeting.replace(",", "")} — wir haben deine Anfrage zur Löschung von „${opts.studioName}" erhalten.`
        ) +
        mailHeading(`Was jetzt passiert`) +
        mailBullets([
          "Deine Stripe-Subscription wurde sofort gekündigt — keine weitere Abrechnung.",
          "Alle Galerien, Freigabe- und Upload-Links sind ab sofort offline — deine Kundinnen und Kunden haben keinen Zugriff mehr.",
          "Das Studio bleibt für 60 Tage in der Karenzphase. Die Daten bleiben in dieser Zeit vollständig erhalten; nimmst du die Löschung zurück, sind alle Galerien sofort wieder erreichbar.",
          `Du kannst die Löschung bis zum ${dateStr} jederzeit zurücknehmen.`,
          `Am ${dateStr} werden alle Daten endgültig gelöscht.`,
        ]) +
        mailButton(opts.cancelUrl, "Löschung zurücknehmen") +
        mailNoticeBox(
          `${urgentSupportHint("Wenn du die Löschung NICHT angefordert hast,")} Möglicherweise hat jemand Fremdes Zugriff auf deinen Account.`
        ),
    }),
  };
}

export function tmplDeletionCancelled(opts: {
  displayName: string | null;
  studioName: string;
}): { subject: string; text: string; html: string } {
  const greeting = opts.displayName ? `Hallo ${opts.displayName},` : "Hallo,";
  return {
    subject: `Löschung deines Studios „${opts.studioName}" zurückgenommen`,
    text:
      `${greeting}\n\n` +
      `du hast die Löschung deines Studios „${opts.studioName}" ` +
      `zurückgenommen. Dein Studio ist wieder aktiv und voll nutzbar.\n\n` +
      `Wichtiger Hinweis zur Abrechnung:\n` +
      `Deine Stripe-Subscription wurde bei der Lösch-Anfrage gekündigt ` +
      `und wird NICHT automatisch reaktiviert. Wenn du Lumio weiter ` +
      `nutzen willst, musst du im Studio unter „Billing" eine neue ` +
      `Subscription starten.\n\n` +
      `— Lumio`,
    html: renderMailLayout({
      preheader: `Dein Studio „${opts.studioName}" ist wieder aktiv`,
      bodyHtml:
        mailHeading(`Löschung zurückgenommen`) +
        mailParagraph(
          `${greeting.replace(",", "")} — du hast die Löschung deines Studios „${opts.studioName}" zurückgenommen. Dein Studio ist wieder aktiv und voll nutzbar.`
        ) +
        mailNoticeBox(
          `Wichtig zur Abrechnung: Deine Stripe-Subscription wurde bei der Lösch-Anfrage gekündigt und wird NICHT automatisch reaktiviert. Wenn du Lumio weiter nutzen willst, starte im Studio unter „Billing" eine neue Subscription.`
        ),
    }),
  };
}

export function tmplDeletionExecuted(opts: {
  studioName: string;
}): { subject: string; text: string; html: string } {
  return {
    subject: `Dein Lumio-Studio „${opts.studioName}" wurde gelöscht`,
    text:
      `Hallo,\n\n` +
      `wie angekündigt haben wir dein Lumio-Studio „${opts.studioName}" ` +
      `und alle zugehörigen Daten endgültig gelöscht.\n\n` +
      `Gelöscht wurden:\n` +
      `  • Alle Bilder und Videos in deinen Galerien\n` +
      `  • Alle Galerien und ihre Konfiguration\n` +
      `  • Dein Account und alle Team-Accounts\n` +
      `  • Branding, Watermarks, Templates\n` +
      `  • Audit-Logs (nur die Tenant-spezifischen)\n\n` +
      `Behalten:\n` +
      `  • Stripe-Customer-Datensatz (für Rechnungs-Audit-Trail in Stripe).${
        supportAddress()
          ? `\n    Wenn du den auch endgültig gelöscht haben möchtest, schreibe an ${supportAddress()}.`
          : ""
      }\n\n` +
      `Diese Mail ist deine Löschungs-Bestätigung — bitte aufbewahren ` +
      `falls du sie später für dein eigenes Verarbeitungsverzeichnis ` +
      `brauchst.\n\n` +
      (feedbackAddress()
        ? `Schade dass du gehst. Falls es technische Gründe waren oder ein ` +
          `Feature gefehlt hat: ${feedbackAddress()} — wir lesen das.\n\n`
        : "") +
      `— Lumio`,
    html: renderMailLayout({
      preheader: `Bestätigung der endgültigen Löschung von „${opts.studioName}"`,
      bodyHtml:
        mailHeading(`Studio gelöscht`) +
        mailParagraph(
          `Wie angekündigt haben wir dein Lumio-Studio „${opts.studioName}" und alle zugehörigen Daten endgültig gelöscht.`
        ) +
        mailHeading(`Gelöscht wurden`) +
        mailBullets([
          "Alle Bilder und Videos in deinen Galerien",
          "Alle Galerien und ihre Konfiguration",
          "Dein Account und alle Team-Accounts",
          "Branding, Watermarks, Templates",
          "Audit-Logs (nur die Tenant-spezifischen)",
        ]) +
        mailHeading(`Behalten`) +
        mailParagraph(
          `Stripe-Customer-Datensatz (für Rechnungs-Audit-Trail in Stripe).${
            supportAddress()
              ? ` Wenn du den auch endgültig gelöscht haben möchtest, schreibe an ${supportAddress()}.`
              : ""
          }`
        ) +
        mailDivider() +
        mailNoticeBox(
          `Diese Mail ist deine Löschungs-Bestätigung — bitte aufbewahren, falls du sie später für dein eigenes Verarbeitungsverzeichnis brauchst.`
        ) +
        mailParagraph(
          `Schade dass du gehst.${feedbackAddress() ? ` Falls es technische Gründe waren oder ein Feature gefehlt hat: ${feedbackAddress()} — wir lesen das.` : ""}`
        ),
    }),
  };
}

export function tmplDeletionReminder(opts: {
  displayName: string | null;
  studioName: string;
  scheduledFor: Date;
  cancelUrl: string;
}): { subject: string; text: string; html: string } {
  const greeting = opts.displayName ? `Hallo ${opts.displayName},` : "Hallo,";
  const dateStr = opts.scheduledFor.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  return {
    subject: `Erinnerung: dein Studio „${opts.studioName}" wird in 7 Tagen gelöscht`,
    text:
      `${greeting}\n\n` +
      `am ${dateStr} löschen wir dein Lumio-Studio „${opts.studioName}" ` +
      `endgültig — wie von dir angefragt.\n\n` +
      `Das ist deine letzte Erinnerung. Wenn du es dir anders überlegt ` +
      `hast, kannst du die Löschung jetzt noch zurücknehmen:\n\n` +
      `${opts.cancelUrl}\n\n` +
      `Nach dem Stichtag sind die Daten unwiderruflich weg.\n\n` +
      `— Lumio`,
    html: renderMailLayout({
      preheader: `Letzte 7 Tage — endgültige Löschung am ${dateStr}`,
      bodyHtml:
        mailHeading(`Letzte Erinnerung`) +
        mailParagraph(
          `${greeting.replace(",", "")} — am ${dateStr} löschen wir dein Lumio-Studio „${opts.studioName}" endgültig, wie von dir angefragt.`
        ) +
        mailParagraph(
          `Wenn du es dir anders überlegt hast, kannst du die Löschung jetzt noch zurücknehmen:`
        ) +
        mailButton(opts.cancelUrl, "Löschung zurücknehmen") +
        mailNoticeBox(`Nach dem Stichtag sind die Daten unwiderruflich weg.`),
    }),
  };
}

// ---------------------------------------------------------------------------
// Billing-Archiv-Lifecycle
// ---------------------------------------------------------------------------

/** Mail beim Übergang Read-only → Archiv: Galerien sind jetzt offline,
 * Vorschauen werden entfernt, Originale bleiben. Reaktivierung jederzeit
 * möglich bis zum Lösch-Stichtag. */
export function tmplBillingArchived(opts: {
  displayName: string | null;
  studioName: string;
  purgeDate: Date;
  reactivateUrl: string;
}): { subject: string; text: string; html: string } {
  const greeting = opts.displayName ? `Hallo ${opts.displayName},` : "Hallo,";
  const dateStr = opts.purgeDate.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  return {
    subject: `Dein Studio „${opts.studioName}" wurde archiviert`,
    text:
      `${greeting}\n\n` +
      `dein Lumio-Studio „${opts.studioName}" war länger ohne aktives Abo ` +
      `und wurde jetzt archiviert.\n\n` +
      `Was das bedeutet:\n` +
      `  • Deine Kunden-Galerien sind vorübergehend offline.\n` +
      `  • Die Original-Dateien bleiben gespeichert — nur die Vorschauen ` +
      `werden entfernt und bei Reaktivierung neu erzeugt.\n` +
      `  • Mit einem neuen Abo ist alles wieder da.\n\n` +
      `Wichtig: Wenn du bis zum ${dateStr} kein Abo abschließt, werden ` +
      `alle Daten an diesem Tag endgültig gelöscht.\n\n` +
      `Studio reaktivieren:\n${opts.reactivateUrl}\n\n` +
      `— Lumio`,
    html: renderMailLayout({
      preheader: `Galerien offline — endgültige Löschung am ${dateStr}, bis dahin reaktivierbar`,
      bodyHtml:
        mailHeading(`Studio archiviert`) +
        mailParagraph(
          `${greeting.replace(",", "")} — dein Studio „${opts.studioName}" war länger ohne aktives Abo und wurde jetzt archiviert.`
        ) +
        mailBullets([
          "Deine Kunden-Galerien sind vorübergehend offline.",
          "Die Original-Dateien bleiben gespeichert — nur die Vorschauen werden entfernt und bei Reaktivierung neu erzeugt.",
          "Mit einem neuen Abo ist alles wieder da.",
        ]) +
        mailButton(opts.reactivateUrl, "Studio reaktivieren") +
        mailNoticeBox(
          `Ohne neues Abo werden am ${dateStr} alle Daten endgültig gelöscht.`
        ),
    }),
  };
}

/** Reminder ~30 Tage vor der endgültigen Löschung eines archivierten Studios. */
export function tmplBillingPurgeReminder(opts: {
  displayName: string | null;
  studioName: string;
  purgeDate: Date;
  reactivateUrl: string;
}): { subject: string; text: string; html: string } {
  const greeting = opts.displayName ? `Hallo ${opts.displayName},` : "Hallo,";
  const dateStr = opts.purgeDate.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  return {
    subject: `Letzte Erinnerung: „${opts.studioName}" wird am ${dateStr} gelöscht`,
    text:
      `${greeting}\n\n` +
      `dein archiviertes Lumio-Studio „${opts.studioName}" wird am ` +
      `${dateStr} endgültig gelöscht — inklusive aller Original-Dateien ` +
      `und Galerien.\n\n` +
      `Wenn du deine Daten behalten möchtest, schließe bis dahin ein Abo ` +
      `ab — dann wird alles wiederhergestellt:\n\n` +
      `${opts.reactivateUrl}\n\n` +
      `Nach dem Stichtag ist eine Wiederherstellung nicht mehr möglich.\n\n` +
      `— Lumio`,
    html: renderMailLayout({
      preheader: `Endgültige Löschung am ${dateStr} — jetzt noch reaktivierbar`,
      bodyHtml:
        mailHeading(`Letzte Erinnerung`) +
        mailParagraph(
          `${greeting.replace(",", "")} — dein archiviertes Studio „${opts.studioName}" wird am ${dateStr} endgültig gelöscht, inklusive aller Original-Dateien und Galerien.`
        ) +
        mailParagraph(
          `Wenn du deine Daten behalten möchtest, schließe bis dahin ein Abo ab — dann wird alles wiederhergestellt:`
        ) +
        mailButton(opts.reactivateUrl, "Studio reaktivieren") +
        mailNoticeBox(`Nach dem Stichtag ist keine Wiederherstellung mehr möglich.`),
    }),
  };
}

// =============================================================================
// Super-Admin / Plattform-Benachrichtigungen (ohne Tenant-Branding)
// =============================================================================

/** Empfaenger: Super-Admins -> Sprache der Instanz. */
const superNewTenantPhrases = {
  subject: { de: "Neuer Tenant: {name} ({plan})", en: "New tenant: {name} ({plan})" },
  preheader: { de: "Neuer Tenant: {name}", en: "New tenant: {name}" },
  heading: { de: "Neuer Tenant registriert", en: "New tenant registered" },
  intro: { de: "Neuer Tenant registriert:", en: "New tenant registered:" },
  fieldName: { de: "Name", en: "Name" },
  fieldSlug: { de: "Slug", en: "Slug" },
  fieldPlan: { de: "Plan", en: "Plan" },
  fieldOwner: { de: "Owner", en: "Owner" },
  superAdmin: { de: "Super-Admin", en: "Super admin" },
  button: { de: "Im Super-Admin öffnen", en: "Open in super admin" },
} satisfies Record<string, Phrase>;

export function tmplSuperNewTenant(opts: {
  tenantName: string;
  slug: string;
  plan: string;
  ownerEmail: string;
  superUrl: string;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = superNewTenantPhrases;
  const vars = { name: opts.tenantName, plan: opts.plan };
  const rows = [
    `${phrase(P.fieldName, l)}: ${opts.tenantName}`,
    `${phrase(P.fieldSlug, l)}: ${opts.slug}`,
    `${phrase(P.fieldPlan, l)}: ${opts.plan}`,
    `${phrase(P.fieldOwner, l)}: ${opts.ownerEmail}`,
  ];
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${phrase(P.intro, l)}\n\n` +
      rows.join("\n") +
      `\n\n${phrase(P.superAdmin, l)}: ${opts.superUrl}\n\n` +
      `${phrase(common.signature, l)}`,
    html: renderMailLayout({
      preheader: phrase(P.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(P.heading, l)) +
        mailBullets(rows) +
        mailButton(opts.superUrl, phrase(P.button, l)),
    }),
  };
}

export function tmplSuperDigest(opts: {
  dateLabel: string;
  newTenants: Array<{ name: string; plan: string }>;
  activeTenants: number;
  totalUsers: number;
  totalStorageGib: number;
  topStorage: Array<{ name: string; usedGib: number; percent: number }>;
  nearLimit: Array<{ name: string; percent: number }>;
  superUrl: string;
}): { subject: string; text: string; html: string } {
  const newCount = opts.newTenants.length;
  const newLines = opts.newTenants.map((t) => `${t.name} (${t.plan})`);
  const topLines = opts.topStorage.map(
    (t) => `${t.name}: ${t.usedGib} GB (${t.percent}%)`
  );
  const nearLines = opts.nearLimit.map((t) => `${t.name}: ${t.percent}%`);

  const textParts = [
    `Lumio Täglicher Report — ${opts.dateLabel}`,
    ``,
    `Neue Tenants (24h): ${newCount}`,
    ...newLines.map((l) => `  - ${l}`),
    ``,
    `Aktive Tenants: ${opts.activeTenants}`,
    `User gesamt: ${opts.totalUsers}`,
    `Speicher gesamt: ${opts.totalStorageGib} GB`,
    ``,
    `Top-Speicher:`,
    ...topLines.map((l) => `  - ${l}`),
    ``,
    `Nahe am Limit (>=90%): ${opts.nearLimit.length}`,
    ...nearLines.map((l) => `  - ${l}`),
    ``,
    `Super-Admin: ${opts.superUrl}`,
    `— Lumio`,
  ];

  let body =
    mailHeading(`Täglicher Report — ${opts.dateLabel}`) +
    mailHeading2sub(`Neue Tenants (24h): ${newCount}`);
  body +=
    newCount > 0
      ? mailBullets(newLines)
      : mailParagraph("Keine neuen Tenants in den letzten 24 Stunden.");
  body += mailDivider();
  body += mailBullets([
    `Aktive Tenants: ${opts.activeTenants}`,
    `User gesamt: ${opts.totalUsers}`,
    `Speicher gesamt: ${opts.totalStorageGib} GB`,
  ]);
  if (opts.topStorage.length > 0) {
    body += mailParagraph("Top-Speicher:") + mailBullets(topLines);
  }
  body += mailParagraph(`Nahe am Limit (>=90%): ${opts.nearLimit.length}`);
  if (opts.nearLimit.length > 0) body += mailBullets(nearLines);
  body += mailButton(opts.superUrl, "Super-Admin öffnen");

  return {
    subject: `Lumio Report ${opts.dateLabel} — ${newCount} neue Tenant(s)`,
    text: textParts.join("\n"),
    html: renderMailLayout({
      preheader: `${newCount} neue Tenants · ${opts.totalStorageGib} GB gesamt`,
      bodyHtml: body,
    }),
  };
}

// Kleiner Zwischen-Titel (mailHeading ist groß; hier eine dezentere Variante).
function mailHeading2sub(text: string): string {
  return mailParagraph(text);
}

// =============================================================================
// Weitere Studio-Benachrichtigungen (Phase 3)
// =============================================================================

const teamMemberJoinedPhrases = {
  subject: { de: "Neues Team-Mitglied: {who}", en: "New team member: {who}" },
  preheader: {
    de: "{who} ist deinem Team beigetreten",
    en: "{who} joined your team",
  },
  heading: { de: "Neues Team-Mitglied", en: "New team member" },
  bodyText: {
    de: "{who} ({email}, Rolle: {role}) hat das Konto eingerichtet und ist deinem Team beigetreten.",
    en: "{who} ({email}, role: {role}) set up their account and joined your team.",
  },
  bodyHtml: {
    de: "{who} ({email}) hat das Konto eingerichtet und ist deinem Team als „{role}“ beigetreten.",
    en: "{who} ({email}) set up their account and joined your team as “{role}”.",
  },
  button: { de: "Team verwalten", en: "Manage team" },
} satisfies Record<string, Phrase>;

export function tmplTeamMemberJoined(opts: {
  memberName: string;
  memberEmail: string;
  role: string;
  teamUrl: string;
  branding?: MailBranding;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = teamMemberJoinedPhrases;
  const who = opts.memberName || opts.memberEmail;
  const vars = { who, email: opts.memberEmail, role: opts.role };
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${phrase(P.bodyText, l, vars)}\n\n` +
      `${phrase(P.button, l)}: ${opts.teamUrl}\n\n` +
      `${phrase(common.signature, l)}`,
    html: renderMailLayout({
      branding: opts.branding,
      preheader: phrase(P.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(P.heading, l)) +
        mailParagraph(phrase(P.bodyHtml, l, vars)) +
        mailButton(opts.teamUrl, phrase(P.button, l), opts.branding?.accentColor),
    }),
  };
}

const galleryExpiringPhrases = {
  subject: {
    de: "Galerie läuft ab: „{title}“ (in {days})",
    en: "Gallery expiring: “{title}” (in {days})",
  },
  preheader: {
    de: "„{title}“ läuft in {days} ab",
    en: "“{title}” expires in {days}",
  },
  heading: { de: "Galerie läuft bald ab", en: "Gallery expiring soon" },
  body: {
    de: "Die Galerie „{title}“ läuft am {date} ab (in {days}). Danach ist sie für Kunden nicht mehr erreichbar.",
    en: "The gallery “{title}” expires on {date} (in {days}). After that your customers can no longer reach it.",
  },
  hint: {
    de: "Falls du sie länger online halten möchtest, kannst du das Ablaufdatum in den Galerie-Einstellungen anpassen.",
    en: "If you want to keep it online for longer, you can change the expiry date in the gallery settings.",
  },
  dayOne: { de: "1 Tag", en: "1 day" },
  dayMany: { de: "{n} Tagen", en: "{n} days" },
} satisfies Record<string, Phrase>;

export function tmplGalleryExpiring(opts: {
  galleryTitle: string;
  daysLeft: number;
  expiresAtLabel: string;
  galleryUrl: string;
  branding?: MailBranding;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = galleryExpiringPhrases;
  const days =
    opts.daysLeft === 1
      ? phrase(P.dayOne, l)
      : phrase(P.dayMany, l, { n: opts.daysLeft });
  const vars = { title: opts.galleryTitle, days, date: opts.expiresAtLabel };
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${phrase(P.body, l, vars)}\n\n` +
      `${phrase(common.openGallery, l)}: ${opts.galleryUrl}\n\n` +
      `${phrase(common.signature, l)}`,
    html: renderMailLayout({
      branding: opts.branding,
      preheader: phrase(P.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(P.heading, l)) +
        mailParagraph(phrase(P.body, l, vars)) +
        mailParagraph(phrase(P.hint, l)) +
        mailButton(
          opts.galleryUrl,
          phrase(common.openGallery, l),
          opts.branding?.accentColor
        ),
    }),
  };
}

const uploadReceivedPhrases = {
  subject: { de: "Neue Uploads: „{title}“", en: "New uploads: “{title}”" },
  preheader: {
    de: "Neue Uploads in „{title}“",
    en: "New uploads in “{title}”",
  },
  heading: { de: "Neue Uploads eingegangen", en: "New uploads received" },
  bodyText: {
    de: "Es sind neue Uploads über den Link „{link}“ in der Galerie „{title}“ eingegangen.",
    en: "New uploads arrived through the link “{link}” in the gallery “{title}”.",
  },
  bodyHtml: {
    de: "Über den Upload-Link „{link}“ sind neue Dateien in „{title}“ eingegangen.",
    en: "New files arrived in “{title}” through the upload link “{link}”.",
  },
} satisfies Record<string, Phrase>;

export function tmplUploadReceived(opts: {
  galleryTitle: string;
  linkLabel: string;
  galleryUrl: string;
  branding?: MailBranding;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = uploadReceivedPhrases;
  const vars = { title: opts.galleryTitle, link: opts.linkLabel };
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${phrase(P.bodyText, l, vars)}\n\n` +
      `${phrase(common.openGallery, l)}: ${opts.galleryUrl}\n\n` +
      `${phrase(common.signature, l)}`,
    html: renderMailLayout({
      branding: opts.branding,
      preheader: phrase(P.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(P.heading, l)) +
        mailParagraph(phrase(P.bodyHtml, l, vars)) +
        mailButton(
          opts.galleryUrl,
          phrase(common.openGallery, l),
          opts.branding?.accentColor
        ),
    }),
  };
}

// =============================================================================
// Marketing / Lifecycle-Templates
// =============================================================================

/**
 * Trial-Reminder — 3 Tage vor Ablauf.
 * Ton: hilfreich, kein Druck. Zeigt kurz was noch drin steckt, CTA Studio.
 */
export function tmplTrialReminder(opts: {
  displayName: string | null;
  studioName: string;
  studioUrl: string;
  planName: string;
  trialEndsAt: Date;
  unsubscribeUrl: string;
}): { subject: string; text: string; html: string } {
  const greeting = opts.displayName ? `Hallo ${opts.displayName},` : "Hallo,";
  const trialEnd = opts.trialEndsAt.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const daysLeft = Math.max(
    1,
    Math.ceil((opts.trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  );
  const daysLabel =
    daysLeft === 1 ? "morgen" : `in ${daysLeft} Tagen`;
  return {
    subject: `Dein Lumio-Trial endet ${daysLabel}`,
    text:
      `${greeting}\n\n` +
      `Dein kostenloser Trial im ${opts.planName}-Plan läuft am ${trialEnd} ab.\n\n` +
      `Falls du noch nicht alles ausprobiert hast — hier ein paar Dinge, ` +
      `die sich lohnen:\n\n` +
      `  • Galerie erstellen und mit einem Kunden teilen\n` +
      `  • Kundenauswahl aktivieren (dein Kunde markiert Favoriten)\n` +
      `  • Branding anpassen (Logo, Farben, eigene Domain)\n\n` +
      `Wenn du danach weiter bei Lumio bleibst, läuft dein Abo einfach weiter — ` +
      `ohne Unterbrechung, keine Daten gehen verloren.\n\n` +
      `Studio öffnen: ${opts.studioUrl}\n\n` +
      (supportHint() ? `${supportHint()}\n\n` : "") +
      `— Lumio\n\n` +
      `---\nDiese Mail abbestellen: ${opts.unsubscribeUrl}`,
    html: renderMailLayout({
      preheader: `Dein Trial endet am ${trialEnd} — hier ein kurzer Überblick.`,
      bodyHtml:
        mailHeading(greeting) +
        mailParagraph(
          `Dein kostenloser Trial im <strong>${opts.planName}</strong>-Plan läuft am <strong>${trialEnd}</strong> ab.`
        ) +
        mailParagraph(
          `Falls du noch nicht alles ausprobiert hast, lohnen sich besonders:`
        ) +
        `<ul style="margin:0 0 16px 0;padding-left:20px;color:#374151;font-size:15px;line-height:1.6;">` +
        `<li>Galerie erstellen und mit einem Kunden teilen</li>` +
        `<li>Kundenauswahl aktivieren (dein Kunde markiert Favoriten)</li>` +
        `<li>Branding anpassen (Logo, Farben, eigene Domain)</li>` +
        `</ul>` +
        mailParagraph(
          `Wenn du nach dem Trial weiter bei Lumio bleibst, läuft dein Abo einfach weiter — ohne Unterbrechung, keine Daten gehen verloren.`
        ) +
        mailButton(opts.studioUrl, "Studio öffnen") +
        (supportHint() ? mailParagraph(supportHint()!) : "") +
        `<p style="margin:24px 0 0 0;font-size:12px;color:#9ca3af;">` +
        `<a href="${opts.unsubscribeUrl}" style="color:#9ca3af;">Keine weiteren Produkt-Mails erhalten</a>` +
        `</p>`,
    }),
  };
}

/**
 * Trial läuft noch, Subscription aber schon gecancelt.
 * Ton: neugierig, kein Vorwurf. Einmal, kein Follow-up.
 */
export function tmplTrialCancelled(opts: {
  displayName: string | null;
  studioName: string;
  studioUrl: string;
  trialEndsAt: Date;
  unsubscribeUrl: string;
}): { subject: string; text: string; html: string } {
  const greeting = opts.displayName ? `Hallo ${opts.displayName},` : "Hallo,";
  const trialEnd = opts.trialEndsAt.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  return {
    subject: `Du hast abgebrochen — dein Studio ist noch bis ${trialEnd} offen`,
    text:
      `${greeting}\n\n` +
      `Du hast dein Lumio-Abo während des Trials storniert. ` +
      `Dein Studio bleibt noch bis zum ${trialEnd} voll zugänglich.\n\n` +
      `${feedbackInvite()}\n\n` +
      `Falls du es dir anders überlegt hast, kannst du dein Abo jederzeit ` +
      `im Studio reaktivieren:\n` +
      `${opts.studioUrl}/billing\n\n` +
      `— Lumio\n\n` +
      `---\nDiese Mail abbestellen: ${opts.unsubscribeUrl}`,
    html: renderMailLayout({
      preheader: `Dein Studio ist noch bis ${trialEnd} zugänglich.`,
      bodyHtml:
        mailHeading(greeting) +
        mailParagraph(
          `Du hast dein Lumio-Abo während des Trials storniert. Dein Studio bleibt noch bis zum <strong>${trialEnd}</strong> voll zugänglich.`
        ) +
        mailParagraph(feedbackInvite()) +
        mailParagraph(
          `Falls du es dir anders überlegt hast, kannst du dein Abo jederzeit reaktivieren.`
        ) +
        mailButton(`${opts.studioUrl}/billing`, "Abo reaktivieren") +
        `<p style="margin:24px 0 0 0;font-size:12px;color:#9ca3af;">` +
        `<a href="${opts.unsubscribeUrl}" style="color:#9ca3af;">Keine weiteren Mails von uns — versprochen.</a>` +
        `</p>`,
    }),
  };
}

/**
 * Winback — Trial abgelaufen ohne Upgrade ODER zahlender Kunde hat gekündigt.
 * Ton: 1 Mail, nie wieder. Kein Druck, aber ehrliches Angebot.
 */
export function tmplWinback(opts: {
  displayName: string | null;
  studioName: string;
  studioUrl: string;
  reason: "trial_expired" | "cancelled";
  unsubscribeUrl: string;
}): { subject: string; text: string; html: string } {
  const greeting = opts.displayName ? `Hallo ${opts.displayName},` : "Hallo,";
  const isChurn = opts.reason === "cancelled";
  const subject = isChurn
    ? `Schade, dass du gehst — Lumio wartet noch auf dich`
    : `Lumio wartet noch auf dich`;
  const intro = isChurn
    ? `Dein Lumio-Abo für „${opts.studioName}" ist ausgelaufen. Schade, dass du gegangen bist.`
    : `Dein Lumio-Trial für „${opts.studioName}" ist abgelaufen, ohne dass du ein Abo gestartet hast.`;
  return {
    subject,
    text:
      `${greeting}\n\n` +
      `${intro}\n\n` +
      `Wenn der Zeitpunkt gerade einfach nicht gepasst hat — kein Problem. ` +
      `Du kannst jederzeit wieder einsteigen; deine Daten sind noch da.\n\n` +
      `Studio öffnen: ${opts.studioUrl}/billing\n\n` +
      `Das ist die einzige Mail dieser Art, die du von uns bekommst.\n\n` +
      `— Lumio\n\n` +
      `---\nDiese Mail abbestellen: ${opts.unsubscribeUrl}`,
    html: renderMailLayout({
      preheader: isChurn
        ? "Deine Daten sind noch da — falls du doch zurückkommst."
        : "Dein Trial ist abgelaufen — du kannst jederzeit zurück.",
      bodyHtml:
        mailHeading(greeting) +
        mailParagraph(intro) +
        mailParagraph(
          `Wenn der Zeitpunkt gerade einfach nicht gepasst hat — kein Problem. Du kannst jederzeit wieder einsteigen, deine Daten sind noch da.`
        ) +
        mailButton(`${opts.studioUrl}/billing`, "Jetzt einsteigen") +
        mailNoticeBox(
          `Das ist die einzige Mail dieser Art, die du von uns bekommst.`
        ) +
        `<p style="margin:24px 0 0 0;font-size:12px;color:#9ca3af;">` +
        `<a href="${opts.unsubscribeUrl}" style="color:#9ca3af;">Keine weiteren Mails erhalten</a>` +
        `</p>`,
    }),
  };
}

// ---------------------------------------------------------------------------
// Support-Anfragen aus dem Studio
//
// Die Admin-Mail traegt bewusst viel Kontext: Tenant, Plan, Rolle, Version,
// Ursprungsseite. Das sind genau die Rueckfragen, die man sonst stellen
// muss, bevor man ueberhaupt anfangen kann zu helfen — und der Nutzer weiss
// die Antworten meist nicht ("welchen Plan hast du?").
// ---------------------------------------------------------------------------

export interface SupportRequestContext {
  message: string;
  userEmail: string;
  /** Abweichende Rueckrufadresse, falls angegeben. */
  replyEmail: string | null;
  userName: string | null;
  userRole: string;
  isImpersonated: boolean;
  tenantName: string | null;
  tenantSlug: string | null;
  tenantId: string;
  tenantStatus: string | null;
  planName: string | null;
  planSlug: string | null;
  planStatus: string | null;
  trialEndsAt: Date | null;
  fromPath: string | null;
  version: string;
}

export function tmplSupportRequest(
  ctx: SupportRequestContext
): { subject: string; text: string; html: string } {
  const who = ctx.userName ? `${ctx.userName} <${ctx.userEmail}>` : ctx.userEmail;
  const studio = ctx.tenantName ?? ctx.tenantSlug ?? ctx.tenantId;

  const facts: string[] = [
    `Von: ${who} (${ctx.userRole})`,
    `Studio: ${studio}${ctx.tenantSlug ? ` (${ctx.tenantSlug})` : ""}`,
  ];
  if (ctx.replyEmail && ctx.replyEmail !== ctx.userEmail) {
    facts.push(`Rückrufadresse: ${ctx.replyEmail}`);
  }
  if (ctx.planName) {
    const st = ctx.planStatus ? ` — ${ctx.planStatus}` : "";
    facts.push(`Plan: ${ctx.planName}${st}`);
  } else {
    facts.push(`Plan: keine Subscription`);
  }
  if (ctx.trialEndsAt) {
    facts.push(`Trial endet: ${ctx.trialEndsAt.toISOString().slice(0, 10)}`);
  }
  if (ctx.tenantStatus && ctx.tenantStatus !== "active") {
    facts.push(`⚠️ Tenant-Status: ${ctx.tenantStatus}`);
  }
  if (ctx.isImpersonated) {
    facts.push(`⚠️ Support-Session (Super-Admin eingeloggt als dieser User)`);
  }
  if (ctx.fromPath) facts.push(`Geschrieben von: ${ctx.fromPath}`);
  facts.push(`Version: ${ctx.version}`);
  facts.push(`Tenant-ID: ${ctx.tenantId}`);

  return {
    subject: `Support: ${studio}${ctx.planSlug ? ` [${ctx.planSlug}]` : ""}`,
    text:
      `Support-Anfrage aus dem Studio:\n\n` +
      facts.map((f) => `  ${f}`).join("\n") +
      `\n\nNachricht:\n${ctx.message}\n`,
    html: renderMailLayout({
      preheader: `${who} — ${ctx.message.slice(0, 80)}`,
      bodyHtml:
        mailHeading(`Support-Anfrage`) +
        mailBullets(facts) +
        mailHeading(`Nachricht`) +
        mailParagraph(ctx.message.replace(/\n/g, "<br>")) +
        mailNoticeBox(
          `Reply-To steht auf ${ctx.replyEmail ?? ctx.userEmail} — direkt antworten geht.`
        ),
    }),
  };
}

const supportConfirmPhrases = {
  subject: { de: "Deine Support-Anfrage ist angekommen", en: "We received your support request" },
  preheader: {
    de: "Wir haben deine Anfrage erhalten und melden uns innerhalb eines Werktags.",
    en: "We received your request and will reply within one working day.",
  },
  greetingNamed: { de: "Hallo {name},", en: "Hello {name}," },
  greetingPlain: { de: "Hallo,", en: "Hello," },
  heading: { de: "Anfrage angekommen", en: "Request received" },
  body: {
    de: "danke für deine Nachricht. Wir haben sie erhalten und melden uns innerhalb eines Werktags bei dir.",
    en: "thank you for your message. We received it and will get back to you within one working day.",
  },
  recap: {
    de: "Zur Sicherheit hier noch einmal, was du uns geschickt hast:",
    en: "For your records, here is what you sent us:",
  },
  yourMessage: { de: "Deine Nachricht", en: "Your message" },
  team: { de: "— Dein Lumio-Team", en: "— Your Lumio team" },
} satisfies Record<string, Phrase>;

export function tmplSupportRequestConfirmation(opts: {
  message: string;
  name: string | null;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = supportConfirmPhrases;
  const greeting = opts.name
    ? phrase(P.greetingNamed, l, { name: opts.name })
    : phrase(P.greetingPlain, l);
  return {
    subject: phrase(P.subject, l),
    text:
      `${greeting}\n\n` +
      `${phrase(P.body, l)}\n\n` +
      `${phrase(P.recap, l)}\n\n` +
      `${opts.message}\n\n` +
      `${phrase(P.team, l)}`,
    html: renderMailLayout({
      preheader: phrase(P.preheader, l),
      bodyHtml:
        mailHeading(phrase(P.heading, l)) +
        mailParagraph(`${greeting} ${phrase(P.body, l)}`) +
        mailHeading(phrase(P.yourMessage, l)) +
        mailParagraph(opts.message.replace(/\n/g, "<br>")),
    }),
  };
}
