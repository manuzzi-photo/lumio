/**
 * Tests for the mail locale helpers.
 *
 * The formatting assertions guard a class of bug the codebase was carrying:
 * dates and currency were formatted with `l === "de" ? "de-DE" : "en-GB"`,
 * repeated in twelve places. That works by accident for exactly two locales
 * and silently mis-formats every further one, since anything that is not
 * German falls through to British English. CONTRIBUTING.md forbids hardcoding
 * a locale identifier in Intl.*; these tests make the ban enforceable instead
 * of a convention.
 */
import { describe, it, expect } from "vitest";
import {
  localeTag,
  normalizeLocale,
  phrase,
  interpolate,
  type MailLocale,
  type Phrase,
} from "./mail-i18n.js";

// Kept in sync with MailLocale by the compiler: adding a locale to the type
// without adding it here makes this array fail to satisfy MailLocale[].
const LOCALES: MailLocale[] = ["de", "en"];

const LONG_DATE = {
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
} as const;

describe("localeTag", () => {
  it("returns a BCP-47 tag for every supported locale", () => {
    for (const l of LOCALES) {
      expect(localeTag(l)).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
    }
  });

  it("gives every locale its own tag", () => {
    expect(new Set(LOCALES.map(localeTag)).size).toBe(LOCALES.length);
  });

  it("formats a date in each locale's own convention", () => {
    const d = new Date(Date.UTC(2026, 8, 30));
    // German puts a dot after the day number, British English does not.
    expect(d.toLocaleDateString(localeTag("de"), LONG_DATE)).toContain("30.");
    expect(d.toLocaleDateString(localeTag("en"), LONG_DATE)).not.toContain(
      "30."
    );
  });

  it("formats currency in each locale's own convention", () => {
    const eur = { style: "currency", currency: "EUR" } as const;
    // German uses a decimal comma, English a decimal point.
    expect((1234.5).toLocaleString(localeTag("de"), eur)).toMatch(/1\D?234,50/);
    expect((1234.5).toLocaleString(localeTag("en"), eur)).toMatch(/1,234\.50/);
  });
});

describe("normalizeLocale", () => {
  it("accepts a bare locale", () => {
    for (const l of LOCALES) expect(normalizeLocale(l)).toBe(l);
  });

  it("accepts a regional variant and strips the region", () => {
    expect(normalizeLocale("de-AT")).toBe("de");
    expect(normalizeLocale("de_CH")).toBe("de");
    expect(normalizeLocale("EN-GB")).toBe("en");
  });

  it("falls back for unknown or missing values", () => {
    const fallback = normalizeLocale(null);
    expect(LOCALES).toContain(fallback);
    expect(normalizeLocale("xx")).toBe(fallback);
    expect(normalizeLocale("")).toBe(fallback);
    expect(normalizeLocale(undefined)).toBe(fallback);
  });
});

describe("phrase / interpolate", () => {
  const p: Phrase = {
    de: "Hallo {name}, {count} Bilder",
    en: "Hello {name}, {count} photos",
  };

  it("returns the text for the requested locale", () => {
    expect(phrase(p, "de", { name: "Anna", count: 3 })).toBe(
      "Hallo Anna, 3 Bilder"
    );
  });

  it("carries the same placeholders in every locale", () => {
    const names = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort();
    const ref = names(p.en);
    for (const l of LOCALES) expect(names(p[l])).toEqual(ref);
  });

  it("leaves an unknown placeholder untouched instead of printing undefined", () => {
    expect(interpolate("Hi {name}, {missing}", { name: "X" })).toBe(
      "Hi X, {missing}"
    );
  });

  it("returns the template unchanged when no vars are given", () => {
    expect(interpolate("no vars here")).toBe("no vars here");
  });
});
