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
 *   2. A key present in one dictionary but not the other, which silently
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

// --- 2. t() calls pointing at nothing -------------------------------------
const files = walk(SRC).filter((f) => !f.startsWith(I18N_DIR));
const broken = new Map();
const hardcodedLocale = new Map();

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const rel = relative(ROOT, file);

  for (const m of text.matchAll(/\bt\(\s*"([^"]+)"/g)) {
    const key = m[1];
    if (!enKeys.has(key) || !deKeys.has(key)) {
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

if (failures === 0) {
  console.log(
    `i18n check passed — ${enKeys.size} keys in both dictionaries, ` +
      `no dangling t() references, no hardcoded locales.`
  );
  process.exit(0);
}
console.error(`\ni18n check failed with ${failures} finding(s).`);
process.exit(1);
