/**
 * Tests for the locale helpers in mail-i18n.ts — localeTag() and
 * normalizeLocale() are pure functions, tested directly per the
 * project's convention (see tags.test.ts): DB-touching helpers
 * (tenantMailLocale, userMailLocale) are thin prisma wrappers around
 * normalizeLocale and are left to integration/manual testing.
 *
 * Added per Issue #12: these helpers broke twice in two days with no
 * test coverage at all — the maintainer's own words after fixing the
 * locale-drift and hardcoded-ternary bugs.
 */
import { describe, it, expect } from "vitest";
import { localeTag, normalizeLocale } from "./mail-i18n.js";

describe("localeTag", () => {
  it("maps de to de-DE", () => {
    expect(localeTag("de")).toBe("de-DE");
  });

  it("maps en to en-GB", () => {
    expect(localeTag("en")).toBe("en-GB");
  });
});

describe("normalizeLocale", () => {
  it("passes through a known locale unchanged", () => {
    expect(normalizeLocale("de")).toBe("de");
    expect(normalizeLocale("en")).toBe("en");
  });

  it("strips a region subtag (de-DE -> de, en-US -> en)", () => {
    expect(normalizeLocale("de-DE")).toBe("de");
    expect(normalizeLocale("en-US")).toBe("en");
  });

  it("accepts an underscore-separated tag (de_DE -> de)", () => {
    expect(normalizeLocale("de_DE")).toBe("de");
  });

  it("is case-insensitive", () => {
    expect(normalizeLocale("DE")).toBe("de");
    expect(normalizeLocale("En-GB")).toBe("en");
  });

  it("falls back to the instance default for an unsupported locale", () => {
    // "it" and "fi" are real UI/candidate locales that MAIL_LOCALES does
    // not (yet) cover — this is the exact gap Issue #12 flagged, so the
    // fallback path matters more here than for a nonsense string.
    expect(normalizeLocale("it")).toBe("de");
    expect(normalizeLocale("fi")).toBe("de");
  });

  it("falls back to the instance default for garbage input", () => {
    expect(normalizeLocale("xx-yy")).toBe("de");
  });

  it("falls back to the instance default for null", () => {
    expect(normalizeLocale(null)).toBe("de");
  });

  it("falls back to the instance default for undefined", () => {
    expect(normalizeLocale(undefined)).toBe("de");
  });

  it("falls back to the instance default for an empty string", () => {
    expect(normalizeLocale("")).toBe("de");
  });
});
