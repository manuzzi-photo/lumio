/**
 * Lumio API — landing page rules
 *
 * A landing page ("Page" in the studio) is a curated, ordered list of
 * galleries with its own link. Everything that decides what a visitor may see
 * lives here, so the studio (badges), the public endpoints and the cover
 * endpoint cannot drift apart.
 *
 * Two principles:
 *
 *   - A page LISTS galleries, it never GRANTS access to them. Unlocking a page
 *     does not unlock a gallery on it; a click on a card goes through the
 *     gallery's own rules (password, expiry, ...).
 *   - Nothing becomes public by accident. A page starts link_only, a gallery
 *     is on a page only by explicit assignment, and a protected gallery shows
 *     only title, date and a lock until the studio opts in to more.
 */

export const PAGE_ACCESS = ["public", "link_only", "password"] as const;
export type PageAccess = (typeof PAGE_ACCESS)[number];

export function isPageAccess(value: unknown): value is PageAccess {
  return (
    typeof value === "string" && (PAGE_ACCESS as readonly string[]).includes(value)
  );
}

/**
 * Upper bound of galleries on one page. There is no pagination in v1: the
 * public endpoint loads a page in one go, so the size has to be bounded.
 */
export const PAGE_GALLERY_LIMIT = 200;

export const PAGE_TITLE_MAX_LENGTH = 120;
export const PAGE_INTRO_MAX_LENGTH = 5000;
export const PAGE_GALLERY_TITLE_MAX_LENGTH = 120;

/** Why a gallery is currently NOT rendered on a page. */
export type GalleryIneligibleReason =
  | "not_live" // draft or archived
  | "expired"
  | "links_only"; // publicAccess = false: only reachable through a share link

/** The gallery fields the rules need. */
export interface EligibilityInput {
  status: string;
  expiresAt: Date | null;
  publicAccess: boolean;
}

/**
 * Null when the gallery is rendered on the page, otherwise the reason it is
 * not. The assignment itself is kept either way: archiving a gallery hides it
 * from its pages but it comes back, in the same place, when it is live again.
 *
 * links_only galleries are never rendered, on any page: a click would end at a
 * dead end, because a page does not grant access. The studio shows them with a
 * badge in the editor.
 *
 * Whether the tenant itself is online (active, not archived by billing) is a
 * property of the request, not of a gallery, and is checked by the caller.
 */
export function galleryIneligibleReason(
  gallery: EligibilityInput,
  now: Date = new Date()
): GalleryIneligibleReason | null {
  if (gallery.status !== "live") return "not_live";
  if (gallery.expiresAt && gallery.expiresAt < now) return "expired";
  if (!gallery.publicAccess) return "links_only";
  return null;
}

/** A gallery with a password: shown with a lock and a limited preview. */
export function isGalleryProtected(gallery: {
  passwordHash: string | null;
}): boolean {
  return gallery.passwordHash !== null && gallery.passwordHash !== "";
}

/**
 * Whether cover, description and photo count of a gallery are shown on a page.
 *
 * An open gallery is public anyway, so there is nothing to hide. A protected
 * gallery reveals them only if the studio opted in for this gallery on this
 * page. Evaluated on every render and every cover request, never stored: a
 * gallery that gets a password later loses its preview on its own.
 */
export function isPreviewVisible(
  gallery: { passwordHash: string | null },
  previewOptIn: boolean
): boolean {
  return !isGalleryProtected(gallery) || previewOptIn;
}

/** Only public pages are indexable; link_only and password are noindex. */
export function isPageIndexable(access: PageAccess): boolean {
  return access === "public";
}

/** Only a public page may be the studio's start page (served on "/"). */
export function canBeStartPage(access: PageAccess): boolean {
  return access === "public";
}

/**
 * Truncates plain text for an Open Graph description or a card. Cuts at a word
 * boundary where there is one and adds an ellipsis only when something was cut.
 */
export function truncateText(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  // Already ends on a word boundary when the next character is a space.
  const lastSpace = clean[max - 1] === " " ? -1 : cut.lastIndexOf(" ");
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return base.replace(/[\s.,;:!?-]+$/, "") + "…";
}
