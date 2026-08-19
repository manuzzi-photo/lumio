#!/usr/bin/env node
/**
 * Dictionary consistency checks for the frontend i18n dictionaries.
 *
 * Three failure modes this catches, all of which shipped to production at
 * some point because nothing was checking for them:
 *
 *   1. A t("some.key") call pointing at a key that exists in neither
 *      dictionary. React renders the key name itself, so the button reads
 *      "studio.cancel" — in every language. tsc cannot see this because the
 *      dictionary type is Record<string, string | Dict>.
 *   2. A key present in one dictionary but not the others, which silently
 *      falls back to English for the locale that is missing it.
 *   3. Hardcoded locale identifiers in Intl / toLocale* calls, which render
 *      German dates inside an English interface.
 *
 * Run: node scripts/check-i18n.mjs
 * Exits non-zero on any finding, so it can gate a release.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");
const I18N_DIR = join(SRC, "lib", "i18n");

/** Every .tsx/.ts file under src, excluding the dictionaries themselves. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Extract dotted key paths from a dictionary file.
 *
 * Note the quote handling: values appear with double, single AND backtick
 * quoting in these files. An earlier version of this check only matched
 * double quotes and therefore reported two existing keys as missing, which
 * led to duplicates being added. Match all three.
 */
function extractKeys(file) {
  const lines = readFileSync(file, "utf8")
    .replace(/^import.*$/gm, "")
    .split("\n");
  const keys = new Set();
  const stack = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const open = line.match(/^(\w+):\s*\{$/);
    if (open) {
      stack.push(open[1]);
      continue;
    }
    if (line.startsWith("}")) {
      stack.pop();
      continue;
    }
    // key: "value"  |  key: 'value'  |  key: `value`  |  key:\n  "value"
    const leaf = line.match(/^(\w+):\s*["'`]/) || line.match(/^(\w+):$/);
    if (leaf) keys.add([...stack, leaf[1]].join("."));
  }
  return keys;
}

const enKeys = extractKeys(join(I18N_DIR, "en.ts"));
const deKeys = extractKeys(join(I18N_DIR, "de.ts"));
const itKeys = extractKeys(join(I18N_DIR, "it.ts"));

let failures = 0;
const report = (title, items, format = (x) => x) => {
  if (items.length === 0) return;
  failures += items.length;
  console.error(`\n${title} (${items.length}):`);
  for (const item of items) console.error(`  ${format(item)}`);
};

// --- 1. keys missing from one dictionary -----------------------------------
report(
  "Keys in en.ts but not de.ts",
  [...enKeys].filter((k) => !deKeys.has(k)).sort()
);
report(
  "Keys in de.ts but not en.ts",
  [...deKeys].filter((k) => !enKeys.has(k)).sort()
);
report(
  "Keys in en.ts but not it.ts",
  [...enKeys].filter((k) => !itKeys.has(k)).sort()
);
report(
  "Keys in it.ts but not en.ts",
  [...itKeys].filter((k) => !enKeys.has(k)).sort()
);

// --- 2. t() calls pointing at nothing -------------------------------------
const files = walk(SRC).filter((f) => !f.startsWith(I18N_DIR));
const broken = new Map();
const hardcodedLocale = new Map();

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const rel = relative(ROOT, file);

  for (const m of text.matchAll(/\bt\(\s*"([^"]+)"/g)) {
    const key = m[1];
    if (!enKeys.has(key) || !deKeys.has(key) || !itKeys.has(key)) {
      if (!broken.has(key)) broken.set(key, new Set());
      broken.get(key).add(rel);
    }
  }

  // --- 3. hardcoded locale identifiers ------------------------------------
  for (const m of text.matchAll(
    /(?:toLocale\w*|Intl\.\w+|localeCompare)\s*\(\s*"([a-z]{2}-[A-Z]{2})"/g
  )) {
    const tag = m[1];
    if (!hardcodedLocale.has(rel)) hardcodedLocale.set(rel, new Set());
    hardcodedLocale.get(rel).add(tag);
  }
}

report(
  "t() references with no matching dictionary key",
  [...broken.entries()].sort(),
  ([key, where]) => `${key}  <- ${[...where].join(", ")}`
);

report(
  "Hardcoded locale identifiers (use useFormat() instead)",
  [...hardcodedLocale.entries()].sort(),
  ([file, tags]) => `${file}  ${[...tags].join(", ")}`
);

// --- 4. catalogue strings the API supplies ---------------------------------
// Some display text is defined in the API (plan descriptions, feature flags,
// print providers, notification toggles) and rendered as-is. Nothing above
// can see those: there is no t() call in the frontend to dangle. Without this
// check they stay German in every language, which is exactly how the
// notification toggles shipped.
const API_SRC = join(ROOT, "..", "api", "src");
const CATALOGUES = [
  {
    file: join(API_SRC, "services", "plans.ts"),
    // PLANS is keyed by slug: `trial: {`
    pattern: /^\s{2}(\w+): \{$/gm,
    kind: "Plan",
    suffixes: ["Desc"],
  },
  {
    file: join(API_SRC, "services", "feature-flags.ts"),
    pattern: /key: "(\w+)"/g,
    kind: "Flag",
    suffixes: ["Name", "Desc"],
  },
  {
    file: join(API_SRC, "services", "notifications.ts"),
    pattern: /key: "(\w+)"/g,
    kind: "NotifEvent",
    suffixes: ["Label", "Desc"],
  },
  {
    file: join(API_SRC, "services", "print", "providers.ts"),
    // Top-level provider definitions sit at two-space indent.
    pattern: /^\s{2}key: "(\w+)",\n\s{2}label:/gm,
    kind: "Provider",
    suffixes: ["Tagline"],
  },
];

const pascal = (k) =>
  k
    .split(/[_-]/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join("");

const missingCatalogue = [];
for (const cat of CATALOGUES) {
  let source;
  try {
    source = readFileSync(cat.file, "utf8");
  } catch {
    // API not checked out next to the frontend — skip rather than fail.
    continue;
  }
  for (const m of source.matchAll(cat.pattern)) {
    const apiKey = m[1];
    for (const suffix of cat.suffixes) {
      const prefix = cat.kind === "NotifEvent" ? "notifEvent" : `catalog${cat.kind}`;
      const key = `settings.${prefix}${pascal(apiKey)}${suffix}`;
      if (!enKeys.has(key)) {
        missingCatalogue.push(`${key}  (from ${cat.kind} "${apiKey}")`);
      }
    }
  }
}

report(
  "API catalogue entries with no dictionary key (will render German in every language)",
  missingCatalogue
);

// --- 5. API error codes ----------------------------------------------------
// Error responses carry a stable code plus a German message, and the frontend
// translates by code (lib/error-i18n.ts). A code with no key falls back to
// that German message — readable, but German in every language.
const missingErrorCodes = [];
try {
  const apiFiles = [];
  const walkApi = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walkApi(full);
      else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry))
        apiFiles.push(full);
    }
  };
  walkApi(API_SRC);
  const seen = new Set();
  for (const file of apiFiles) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(
      /\.send\(\s*\{[^}]{0,400}?error:\s*["'](\w+)["'][^}]{0,400}?message:\s*["']([^"']{4,})["']/gs
    )) {
      const [, code, message] = m;
      // Only codes that actually ship a German sentence need a translation.
      if (!/[äöüßÄÖÜ]|\b(nicht|kein|keine|Bitte|wurde|ist|hat|Du|dich)\b/.test(message))
        continue;
      if (seen.has(code)) continue;
      seen.add(code);
      const camelCode = code
        .split(/[_-]/)
        .filter(Boolean)
        .map((p, i) => (i === 0 ? p : p[0].toUpperCase() + p.slice(1)))
        .join("");
      if (!enKeys.has(`apiError.${camelCode}`)) {
        missingErrorCodes.push(`apiError.${camelCode}  (error code "${code}")`);
      }
    }
  }
} catch {
  // API not available next to the frontend — skip.
}

report(
  "API error codes with a German message and no dictionary key",
  missingErrorCodes
);

// --- 6. German text a quote-scan cannot see -------------------------------
// Two categories my earlier scans missed entirely, both pointed out by
// canja006 in issue #12 along with a working scanner:
//
//   1. JSX text nodes. <p>Angemeldet als</p> is not a string literal — the
//      text sits between the tags, so grepping for quotes skips it.
//   2. German without umlauts. A "contains ä/ö/ü/ß" heuristic misses
//      nicht, oder, Galerie, Auswahl, Dateien, Abmelden.
//
// This errs toward recall: expect the occasional false positive (a German
// word inside an English sentence). It is triage, not a gate on style — but
// it is the check that would have caught the 26 strings still live at
// v0.66.3 after I had twice declared the frontend done.
const GERMAN_WORDS =
  /\b(der|die|das|und|oder|nicht|kein|keine|wird|wurde|werden|sind|ist|dein|deine|deinen|sich|noch|schon|bitte|kann|kannst|muss|darf|Datei|Dateien|Galerie|Galerien|Bild|Bilder|Kunde|Kunden|Auswahl|Einstellung|Einstellungen|Speicher|Speichern|abbrechen|erstellen|zurueck|weiter|erfolgreich|verfuegbar|Anzahl|Angemeldet|Benachrichtigung|Vorschau|hochladen|herunterladen|loeschen|Verbindung|Freigabe|Anmelden|Abmelden)\b/;
const UMLAUT = /[äöüßÄÖÜ]/;
const looksGerman = (t) => GERMAN_WORDS.test(t) || UMLAUT.test(t);

/** Blanks comments while keeping offsets, so their German is not flagged. */
function blankComments(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i++;
      while (i < src.length) {
        if (src[i] === "\\") {
          out += src.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      const end = nl < 0 ? src.length : nl;
      out += " ".repeat(end - i);
      i = end;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i);
      const end = close < 0 ? src.length : close + 2;
      out += src.slice(i, end).replace(/[^\n]/g, " ");
      i = end;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * app/page.tsx is the tenant picker on the apex domain: a Server Component
 * that awaits headers(), so useT() is unavailable there. Documented in the
 * file itself; localising it needs the locale resolved server-side from the
 * cookie, which is its own change.
 */
const GERMAN_TEXT_EXEMPT = new Set(["src/app/page.tsx"]);

const germanText = [];
for (const file of files) {
  const rel = relative(ROOT, file);
  if (GERMAN_TEXT_EXEMPT.has(rel)) continue;
  const src = blankComments(readFileSync(file, "utf8"));
  const lineAt = (idx) => src.slice(0, idx).split("\n").length;
  for (const m of src.matchAll(/>\s*([^<>{}\n][^<>{}]*?)\s*</g)) {
    const text = m[1].trim();
    if (!/[A-Za-zÀ-ÿ]/.test(text) || !looksGerman(text)) continue;
    germanText.push(`${rel}:${lineAt(m.index)}  ${text.slice(0, 60)}`);
  }
  for (const m of src.matchAll(/`([^`]*)`/g)) {
    if (!looksGerman(m[1])) continue;
    germanText.push(`${rel}:${lineAt(m.index)}  \`${m[1].slice(0, 55)}\``);
  }
}

report("German text in JSX or template literals", germanText);

if (failures === 0) {
  console.log(
    `i18n check passed — ${enKeys.size} keys in all three dictionaries, ` +
      `no dangling t() references, no hardcoded locales.`
  );
  process.exit(0);
}
console.error(`\ni18n check failed with ${failures} finding(s).`);
process.exit(1);
