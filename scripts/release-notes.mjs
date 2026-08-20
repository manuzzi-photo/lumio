#!/usr/bin/env node
/**
 * Englischer Teil eines CHANGELOG-Abschnitts — fuer Release-Notes.
 *
 * Der CHANGELOG ist bewusst zweisprachig: er liegt im Repo und richtet sich
 * auch an deutsche Self-Hoster. Die Release-Seiten auf Forgejo und GitHub
 * haben ein anderes Publikum — Beitragende und Self-Hoster international —
 * und sind deshalb englisch.
 *
 * Erwartetes Format je Abschnitt:
 *
 *     ## [X.Y.Z] - JJJJ-MM-TT
 *
 *     <deutsche Einleitung>
 *
 *     *<englische Einleitung, kursiv>*
 *
 *     ### Fixed
 *
 *     - <deutsche Eintraege>
 *
 *     **🇬🇧 English**
 *
 *     - <englische Eintraege>
 *
 * Die Einleitung ist am Kursiv-Absatz erkennbar, die Rubriken am
 * Flaggen-Marker. Beides muss vorhanden sein; fehlt es, bricht der Script ab,
 * statt stillschweigend deutschen Text in die Release-Notes zu schreiben.
 *
 * Aufruf:  node scripts/release-notes.mjs 0.71.1
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const version = process.argv[2];
if (!version) {
  console.error("Usage: node scripts/release-notes.mjs <version>");
  process.exit(1);
}

const ROOT = new URL("..", import.meta.url).pathname;
const text = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
const lines = text.split("\n");

const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
if (start === -1) {
  console.error(`No section for ${version} in CHANGELOG.md`);
  process.exit(1);
}
let end = lines.findIndex((l, i) => i > start && l.startsWith("## ["));
if (end === -1) end = lines.length;

const section = lines.slice(start + 1, end);

const out = [];
const problems = [];

// --- Einleitung: der kursive Absatz -----------------------------------------
const intro = section.find((l) => /^\*[^*].*\*$/.test(l.trim()));
if (intro) {
  out.push(intro.trim().replace(/^\*|\*$/g, ""), "");
} else {
  problems.push("no italic English intro paragraph");
}

// --- Rubriken -------------------------------------------------------------
// Zwei Formate kommen vor:
//
//   (a) pro Rubrik ein eigener Flaggen-Block — dann bleibt die Zuordnung
//       erhalten, und "Security" bleibt "Security".
//   (b) ein einzelner Flaggen-Block am Ende, der alle Rubriken zusammenfasst
//       — so waren die frueheren Abschnitte geschrieben.
//
// Bei (b) laesst sich nicht rekonstruieren, welcher Eintrag zu welcher
// Rubrik gehoert. Dann werden die Eintraege ohne Ueberschrift ausgegeben,
// statt sie zu raten: einen Sicherheitsfix faelschlich als "Fixed" zu
// beschriften waere schlechter als gar keine Rubrik.
const headings = section.filter((l) => l.startsWith("### ")).length;
const flagBlocks = section.filter((l) => l.includes("🇬🇧")).length;
const perSection = headings > 0 && flagBlocks >= headings;

let heading = null;
let inEnglish = false;

for (const line of section) {
  if (line.startsWith("### ")) {
    heading = line;
    inEnglish = false;
    continue;
  }
  if (line.includes("🇬🇧")) {
    inEnglish = true;
    if (perSection && heading) {
      out.push("", heading, "");
      heading = null;
    }
    continue;
  }
  if (inEnglish && line.trim() !== "") out.push(line);
}

if (headings > 0 && !perSection) {
  process.stderr.write(
    `note: ${version} has ${headings} sections but one combined English ` +
      "block, so the release notes are an unlabelled list. Give each " +
      "section its own English block to keep the labels.\n"
  );
}

if (headings > 0 && !out.some((l) => l.startsWith("- "))) {
  problems.push("sections present but no English entries found");
}

if (problems.length) {
  console.error(`Cannot build English release notes for ${version}:`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    "\nThe changelog section is missing its English half, or uses a " +
      "different format than expected. Fix the changelog rather than " +
      "shipping German release notes."
  );
  process.exit(1);
}

console.log(out.join("\n").replace(/\n{3,}/g, "\n\n").trim());
