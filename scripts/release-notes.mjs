#!/usr/bin/env node
/**
 * Englische Release-Notes aus einem CHANGELOG-Abschnitt.
 *
 * Ab v0.72.0 ist der Changelog einsprachig englisch. Zweisprachig zu
 * schreiben skaliert nicht: bei drei unterstuetzten Oberflaechen-Sprachen
 * muessten es drei sein, bei vier vier — und die Haelfte veraltet.
 *
 * Die Historie bleibt unangetastet. 93 aeltere Abschnitte sind zweisprachig,
 * 30 (v0.43.2 bis v0.55.1) rein deutsch. Sie betreffen Versionen, die
 * niemand mehr installiert; sie nachtraeglich zu uebersetzen waere Aufwand
 * ohne Leser, und maschinell uebersetzt waere schlechter als so.
 *
 * Deshalb versteht der Script drei Faelle:
 *
 *   1. Einsprachig englisch (neu)  -> unveraendert durchreichen.
 *   2. Zweisprachig (alt)          -> englische Einleitung ist der kursive
 *                                     Absatz, englische Eintraege stehen
 *                                     hinter dem Flaggen-Marker.
 *   3. Rein deutsch (alt)          -> Abbruch. Der Fall soll auffallen,
 *                                     nicht stillschweigend deutschen Text
 *                                     in englische Release-Notes schreiben.
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
const lines = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8").split("\n");

const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
if (start === -1) {
  console.error(`No section for ${version} in CHANGELOG.md`);
  process.exit(1);
}
let end = lines.findIndex((l, i) => i > start && l.startsWith("## ["));
if (end === -1) end = lines.length;
const section = lines.slice(start + 1, end);

/** Grobe Heuristik, nur um Fall 3 zu erkennen — keine Sprachanalyse. */
const GERMAN =
  /\b(genügt|Betroffen|keine Änderungen|wurde|nicht mehr|Galerie|deutsch|werden|können)\b/;

const FLAG = "\u{1F1EC}\u{1F1E7}";
const hasFlag = section.some((l) => l.includes(FLAG));
const italicIntro = section.find((l) => /^\*[^*].*\*$/.test(l.trim()));
const bilingual = hasFlag || Boolean(italicIntro);

const out = [];
const problems = [];

if (!bilingual) {
  const germanLines = section.filter((l) => GERMAN.test(l)).length;
  if (germanLines > 0) {
    problems.push(
      `looks German-only (${germanLines} line(s) matched) — sections before ` +
        "v0.56.0 predate the English changelog"
    );
  } else {
    out.push(...section);
  }
} else {
  if (italicIntro) {
    out.push(italicIntro.trim().replace(/^\*|\*$/g, ""), "");
  } else {
    problems.push("no italic English intro paragraph");
  }

  // Zwei Auspraegungen: ein Flaggen-Block je Rubrik (Zuordnung bleibt), oder
  // ein gemeinsamer Block am Ende (Zuordnung nicht rekonstruierbar). Im
  // zweiten Fall werden die Ueberschriften weggelassen statt geraten — einen
  // Sicherheitsfix faelschlich als "Fixed" zu labeln waere schlechter.
  const headings = section.filter((l) => l.startsWith("### ")).length;
  const flagBlocks = section.filter((l) => l.includes(FLAG)).length;
  const perSection = headings > 0 && flagBlocks >= headings;

  let heading = null;
  let inEnglish = false;
  for (const line of section) {
    if (line.startsWith("### ")) {
      heading = line;
      inEnglish = false;
      continue;
    }
    if (line.includes(FLAG)) {
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
        "block, so headings are omitted rather than guessed\n"
    );
  }
  if (headings > 0 && !out.some((l) => l.startsWith("- "))) {
    problems.push("sections present but no English entries found");
  }
}

if (problems.length) {
  console.error(`Cannot build English release notes for ${version}:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(out.join("\n").replace(/\n{3,}/g, "\n\n").trim());
