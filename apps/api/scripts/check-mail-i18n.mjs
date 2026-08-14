#!/usr/bin/env node
/**
 * Mail i18n consistency checks for the API.
 *
 * The frontend has apps/frontend/scripts/check-i18n.mjs; this is the
 * equivalent for the mail layer, where nothing was checking anything. Three
 * findings prompted it, all of which had shipped:
 *
 *   1. Five hardcoded "de-DE" locale identifiers inside mail templates, so
 *      an English mail carried German dates and currency.
 *   2. A date formatted as German *before* being handed to a template that
 *      does resolve the recipient's locale correctly — the template is
 *      right, the string arrives pre-broken (sweeper.ts, tmplGalleryExpiring).
 *   3. Mails assembled inline at the sendMail call site instead of going
 *      through a tmpl* function, which means they never appeared in any
 *      template inventory and stayed German (auth.ts impersonation notice,
 *      sweeper.ts and super-tenants.ts pre-archive warnings).
 *
 * Run: node scripts/check-mail-i18n.mjs
 * Exits non-zero on any finding, so it can gate a release.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");

/**
 * Files that legitimately build a mail without a tmpl* function, because
 * their content is authored by a human at runtime rather than by us:
 * broadcasts are written in the super admin, and sendMail itself is the
 * transport.
 */
const INLINE_ALLOWED = new Set([
  "src/services/mail.ts",
  "src/services/broadcast.ts",
  "src/routes/broadcasts.ts",
  // Super admin types the subject and body for a single tenant by hand.
  "src/routes/super-tenants.ts:contactTenant",
]);

/**
 * Locale identifiers are legitimate here: mail-i18n maps our locales onto
 * BCP 47 tags, and the templates pick between them based on the recipient.
 */
const LOCALE_ALLOWED = [
  // Any "<something> === "de" ? "de-DE" : "en-GB"" is the intended shape —
  // the variable name varies (l, locale, ownerLocale, digestLocale …), so
  // match the pattern rather than a fixed list of names.
  /\w+ === "de" \? "de-DE" : "en-GB"/,
  /de: "de-DE"/,
  /^\s*\*/, // comment lines
];

/**
 * Files exempt from the locale check on purpose. The data processing
 * agreement is a contract under Art. 28 GDPR between two German legal
 * entities; the German version is the binding one, so its dates are
 * German by design. See the language policy in CONTRIBUTING.md.
 */
const LOCALE_EXEMPT_FILES = new Set(["src/services/dpa.ts"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue;
      walk(full, out);
    } else if (/\.ts$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(SRC);
let failures = 0;
const report = (title, items) => {
  if (items.length === 0) return;
  failures += items.length;
  console.error(`\n${title} (${items.length}):`);
  for (const item of items) console.error(`  ${item}`);
};

const hardcodedLocale = [];
const inlineMails = [];
const preFormattedDates = [];

for (const file of files) {
  const rel = relative(ROOT, file);
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");

  // --- 1. hardcoded locale identifiers ------------------------------------
  lines.forEach((line, i) => {
    if (
      !/toLocale\w*\(\s*"[a-z]{2}-[A-Z]{2}"|Intl\.\w+\(\s*"[a-z]{2}-[A-Z]{2}"/.test(
        line
      )
    ) {
      return;
    }
    if (LOCALE_ALLOWED.some((re) => re.test(lines.slice(i, i + 3).join("\n"))))
      return;
    if (LOCALE_EXEMPT_FILES.has(rel)) return;
    hardcodedLocale.push(`${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
  });

  // --- 2. mails assembled without a template ------------------------------
  // A sendMail call carrying its own subject has no tmpl* behind it, so no
  // amount of locale plumbing will ever translate it.
  for (const m of text.matchAll(/sendMail\(\s*\{([\s\S]{0,1200}?)\n\s*\}\)/g)) {
    const block = m[1];
    if (!/subject\s*:/.test(block)) continue;
    if (/tmpl\w+\(|\.\.\.tpl\b/.test(block)) continue;
    if (INLINE_ALLOWED.has(rel)) continue;
    const line = text.slice(0, m.index).split("\n").length;
    inlineMails.push(`${rel}:${line}  builds subject/text inline`);
  }

  // --- 3. dates formatted before reaching a template ----------------------
  // The template may resolve the locale perfectly and still receive a string
  // that was already rendered in German.
  lines.forEach((line, i) => {
    if (!/Label\s*:|Label\s*=/.test(line)) return;
    if (!/toLocale\w*\(/.test(line)) return;
    // The locale argument is often on the following line when the call is
    // wrapped, so judge the whole call, not the line the name sits on.
    const window = lines.slice(i, i + 3).join("\n");
    if (LOCALE_ALLOWED.some((re) => re.test(window))) return;
    preFormattedDates.push(`${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
  });
}

report(
  "Hardcoded locale identifiers (thread the recipient's locale instead)",
  hardcodedLocale
);
report(
  "Mails built inline instead of through a tmpl* function (cannot be translated)",
  inlineMails
);
report(
  "Dates formatted before being passed to a template (template locale is then moot)",
  preFormattedDates
);

if (failures === 0) {
  console.log(
    "mail i18n check passed — no hardcoded locales, no untemplated mails."
  );
  process.exit(0);
}
console.error(`\nmail i18n check failed with ${failures} finding(s).`);
process.exit(1);
