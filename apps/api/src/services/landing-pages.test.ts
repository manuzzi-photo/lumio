import { describe, it, expect } from "vitest";

import {
  PAGE_ACCESS,
  canBeStartPage,
  galleryIneligibleReason,
  isGalleryProtected,
  isPageAccess,
  isPageIndexable,
  isPreviewVisible,
  truncateText,
} from "./landing-pages.js";

/**
 * The rules that decide what a visitor sees on a landing page. They are the
 * privacy boundary of the feature, so they are pinned down case by case.
 */

const NOW = new Date("2026-09-25T12:00:00Z");
const HOUR = 3_600_000;

const live = {
  status: "live",
  expiresAt: null,
  publicAccess: true,
} as const;

describe("galleryIneligibleReason", () => {
  it("renders a live, public, non-expiring gallery", () => {
    expect(galleryIneligibleReason(live, NOW)).toBeNull();
  });

  it("hides drafts and archived galleries", () => {
    expect(galleryIneligibleReason({ ...live, status: "draft" }, NOW)).toBe(
      "not_live"
    );
    expect(galleryIneligibleReason({ ...live, status: "archived" }, NOW)).toBe(
      "not_live"
    );
  });

  it("hides an expired gallery, keeps one that expires later", () => {
    expect(
      galleryIneligibleReason(
        { ...live, expiresAt: new Date(NOW.getTime() - HOUR) },
        NOW
      )
    ).toBe("expired");
    expect(
      galleryIneligibleReason(
        { ...live, expiresAt: new Date(NOW.getTime() + HOUR) },
        NOW
      )
    ).toBeNull();
  });

  it("treats the exact expiry instant as still valid, like the gallery itself", () => {
    // loadVisitor() rejects on `expiresAt < now`, so equality is not expired.
    expect(galleryIneligibleReason({ ...live, expiresAt: NOW }, NOW)).toBeNull();
  });

  it("never renders a gallery that needs a share link", () => {
    expect(
      galleryIneligibleReason({ ...live, publicAccess: false }, NOW)
    ).toBe("links_only");
  });

  it("reports the first reason when several apply (not live wins)", () => {
    expect(
      galleryIneligibleReason(
        {
          status: "archived",
          expiresAt: new Date(NOW.getTime() - HOUR),
          publicAccess: false,
        },
        NOW
      )
    ).toBe("not_live");
  });

  it("does not depend on a password: protected galleries are still listed", () => {
    // The password is not an input at all. A protected gallery is listed,
    // with a lock, and unlocks through its own flow.
    expect(galleryIneligibleReason(live, NOW)).toBeNull();
  });
});

describe("isGalleryProtected", () => {
  it("is true only when a password hash is set", () => {
    expect(isGalleryProtected({ passwordHash: "$argon2id$x" })).toBe(true);
    expect(isGalleryProtected({ passwordHash: null })).toBe(false);
    expect(isGalleryProtected({ passwordHash: "" })).toBe(false);
  });
});

describe("isPreviewVisible", () => {
  const open = { passwordHash: null };
  const protectedGallery = { passwordHash: "$argon2id$x" };

  it("always shows the preview of an open gallery", () => {
    expect(isPreviewVisible(open, false)).toBe(true);
    expect(isPreviewVisible(open, true)).toBe(true);
  });

  it("hides the preview of a protected gallery until the studio opts in", () => {
    expect(isPreviewVisible(protectedGallery, false)).toBe(false);
    expect(isPreviewVisible(protectedGallery, true)).toBe(true);
  });

  it("follows the gallery, not a stored value: a gallery protected later loses its preview", () => {
    // Same join row (previewOptIn = false), the gallery gets a password.
    const optIn = false;
    expect(isPreviewVisible(open, optIn)).toBe(true);
    expect(isPreviewVisible(protectedGallery, optIn)).toBe(false);
  });
});

describe("page access", () => {
  it("knows exactly three access modes", () => {
    expect([...PAGE_ACCESS]).toEqual(["public", "link_only", "password"]);
    expect(isPageAccess("public")).toBe(true);
    expect(isPageAccess("link_only")).toBe(true);
    expect(isPageAccess("password")).toBe(true);
    expect(isPageAccess("private")).toBe(false);
    expect(isPageAccess("")).toBe(false);
    expect(isPageAccess(undefined)).toBe(false);
    expect(isPageAccess(null)).toBe(false);
  });

  it("indexes only public pages", () => {
    expect(isPageIndexable("public")).toBe(true);
    expect(isPageIndexable("link_only")).toBe(false);
    expect(isPageIndexable("password")).toBe(false);
  });

  it("lets only a public page be the start page", () => {
    expect(canBeStartPage("public")).toBe(true);
    expect(canBeStartPage("link_only")).toBe(false);
    expect(canBeStartPage("password")).toBe(false);
  });
});

describe("truncateText", () => {
  it("returns short text unchanged, with whitespace collapsed", () => {
    expect(truncateText("Hello   world\n", 50)).toBe("Hello world");
  });

  it("cuts long text at a word boundary and adds an ellipsis", () => {
    const out = truncateText("The quick brown fox jumps over the lazy dog", 20);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out).toBe("The quick brown fox…");
  });

  it("does not add an ellipsis when nothing was cut", () => {
    expect(truncateText("exactly ten", 11)).toBe("exactly ten");
  });

  it("hard-cuts a single long word", () => {
    const out = truncateText("a".repeat(100), 10);
    expect(out).toBe("a".repeat(9) + "…");
  });
});
