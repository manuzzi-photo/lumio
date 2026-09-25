/**
 * Lumio API — Gallery Visitor Session
 *
 * Wenn ein Kunde eine Galerie freigeschaltet hat (über Token in URL und
 * ggf. Passwort), setzen wir ein kurzlebiges signiertes Cookie. Damit
 * muss der Browser den Token nicht bei jedem Request mitschicken (was
 * im Referrer-Header leaken könnte) und das Passwort wird nur einmal
 * geprüft.
 *
 * Cookie-Payload (HMAC-signiert über SESSION_SECRET):
 *   {
 *     gid: <gallery-id>,
 *     aid: <access-id | null>,    // null wenn kein Token verwendet (z.B. nur Passwort)
 *     pw:  boolean,                // wurde das Galerie-Passwort eingegeben?
 *     exp: <unix-ms>
 *   }
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

const VISITOR_TTL_MS = 8 * 60 * 60 * 1000; // 8h

export const VISITOR_COOKIE_PREFIX = "lumio_v_"; // ein Cookie pro Galerie

export interface VisitorClaims {
  gid: string;
  aid: string | null;
  pw: boolean;
  /** Fingerabdruck des Passworts, gegen das freigeschaltet wurde
   *  (Galerie- oder Link-Passwort). Ändert/entfernt der Studio das
   *  Passwort, passt der Fingerabdruck nicht mehr → neue Eingabe nötig.
   *  null/fehlt = es war kein Passwort nötig. */
  pwfp?: string | null;
  exp: number;
}

function sign(payload: string): string {
  return createHmac("sha256", config.SESSION_SECRET)
    .update(payload)
    .digest("base64url");
}

export function createVisitorToken(claims: Omit<VisitorClaims, "exp">): string {
  const full: VisitorClaims = {
    ...claims,
    exp: Date.now() + VISITOR_TTL_MS,
  };
  const payload = Buffer.from(JSON.stringify(full)).toString("base64url");
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

/**
 * Checks the signature and parses the payload. Shared by the gallery and the
 * landing page tokens, which differ only in their claims. Expiry is checked
 * by the callers.
 */
function readSigned(token: string): Record<string, unknown> | null {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;

  const expected = sign(payload);
  if (
    expected.length !== sig.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
  ) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    );
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function verifyVisitorToken(token: string): VisitorClaims | null {
  const claims = readSigned(token) as VisitorClaims | null;
  if (!claims) return null;
  // A landing page token carries "k". Never accept one as a gallery token,
  // even though the cookie names already keep the two apart.
  if ("k" in claims) return null;
  if (typeof claims.exp !== "number" || claims.exp < Date.now()) return null;
  return claims;
}

/**
 * Short fingerprint of a password hash, stored in the visitor cookie. The
 * hash changes whenever the password does, so changing or removing a
 * password invalidates every cookie issued against the old one.
 */
export function passwordFingerprint(hash: string): string {
  return createHash("sha256").update(hash).digest("hex").slice(0, 16);
}

/** Cookie-Name für eine bestimmte Galerie. */
export function visitorCookieName(galleryId: string): string {
  // gallery-id mit base32-Suffix wäre sauberer, aber UUID hat schon nur
  // Hex+Dash und ist cookie-safe.
  return `${VISITOR_COOKIE_PREFIX}${galleryId.replace(/-/g, "")}`;
}

// ---------------------------------------------------------------------------
// Landing pages
// ---------------------------------------------------------------------------
// A password-protected landing page is unlocked with its own cookie. It is
// kept apart from the gallery cookies on purpose: unlocking a page never
// unlocks the galleries on it (a page lists, it does not grant access), and
// unlocking a gallery says nothing about a page.

export const PAGE_VISITOR_COOKIE_PREFIX = "lumio_p_"; // one cookie per page

export interface PageVisitorClaims {
  /** Marks the token as a page token, see verifyVisitorToken(). */
  k: "page";
  pid: string;
  /** Fingerprint of the page password the visitor unlocked with. */
  pwfp: string;
  exp: number;
}

export function createPageVisitorToken(
  claims: Pick<PageVisitorClaims, "pid" | "pwfp">
): string {
  const full: PageVisitorClaims = {
    k: "page",
    ...claims,
    exp: Date.now() + VISITOR_TTL_MS,
  };
  const payload = Buffer.from(JSON.stringify(full)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyPageVisitorToken(
  token: string
): PageVisitorClaims | null {
  const claims = readSigned(token) as PageVisitorClaims | null;
  if (!claims) return null;
  if (
    claims.k !== "page" ||
    typeof claims.pid !== "string" ||
    typeof claims.pwfp !== "string"
  ) {
    return null;
  }
  if (typeof claims.exp !== "number" || claims.exp < Date.now()) return null;
  return claims;
}

/** Cookie name for a landing page (the UUID is cookie-safe, dashes removed). */
export function pageVisitorCookieName(pageId: string): string {
  return `${PAGE_VISITOR_COOKIE_PREFIX}${pageId.replace(/-/g, "")}`;
}
