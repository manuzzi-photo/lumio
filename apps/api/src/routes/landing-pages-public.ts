/**
 * Lumio API — landing pages, public side
 *
 * No login. The tenant comes from the request host, exactly as for /g/:slug
 * (session, header, custom domain, subdomain, single-mode default).
 *
 *   GET  /p                          — the studio's start page (served on "/"), 404 if none
 *   GET  /p/:slug                    — a page and the galleries visible on it
 *   POST /p/:slug/unlock             — password for a password page
 *   GET  /p/:slug/covers/:gallerySlug — redirect to a short-lived cover image
 *
 * What a visitor may see is decided in services/landing-pages.ts. In short: a
 * page lists, it never grants access. A gallery card links to /g/<slug> and
 * goes through that gallery's own rules there.
 *
 * Covers are not handed out as presigned URLs in the JSON (they would live for
 * an hour, and a revoked preview opt-in would stay reachable that long).
 * They go through a stable same-origin URL that re-checks the rules on every
 * request and redirects to a link that lives for minutes, the same pattern as
 * /g/:slug/assets/:kind. The bucket stays private (docs/STORAGE.md).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { z } from "zod";

import { config } from "../config.js";
import { prisma } from "../db.js";
import { verifyPassword } from "../services/auth.js";
import { isFeatureEnabled } from "../services/feature-flags.js";
import { logEvent } from "../services/audit.js";
import { presignGet } from "../services/storage.js";
import { isTenantPubliclyVisible } from "../services/tenant.js";
import { resolveFaviconUrl, resolveGalleryBranding } from "../services/branding.js";
import { resolveCoverThumbs } from "../services/gallery-covers.js";
import {
  resolveDefaultPage,
  resolvePageBySlug,
} from "../services/landing-page-lookup.js";
import {
  PAGE_GALLERY_LIMIT,
  galleryIneligibleReason,
  isGalleryProtected,
  isPageIndexable,
  isPreviewVisible,
  type PageAccess,
} from "../services/landing-pages.js";
import {
  createPageVisitorToken,
  pageVisitorCookieName,
  passwordFingerprint,
  verifyPageVisitorToken,
} from "../services/visitor.js";

const PUBLIC_PAGE_SELECT = {
  id: true,
  tenantId: true,
  slug: true,
  title: true,
  introMarkdown: true,
  access: true,
  passwordHash: true,
  isStudioDefault: true,
  brandingId: true,
  tenant: { select: { status: true, displayName: true, name: true } },
} satisfies Prisma.LandingPageSelect;

type PublicPage = Prisma.LandingPageGetPayload<{
  select: typeof PUBLIC_PAGE_SELECT;
}>;

const unlockSchema = z.object({ password: z.string().min(1).max(200) });

/** Lifetime of the link a cover request redirects to. */
const COVER_URL_TTL_SECONDS = 300;

/**
 * Why a page cannot be served at all, or null. The feature flag, the tenant
 * (suspended, archived, pending deletion) and a billing-archived studio all
 * take every page offline, like they do for galleries.
 */
async function offlineReason(
  page: PublicPage
): Promise<{ status: number; error: string } | null> {
  if (!(await isFeatureEnabled(page.tenantId, "landing_pages"))) {
    return { status: 404, error: "not_found" };
  }
  if (!isTenantPubliclyVisible(page.tenant.status)) {
    return { status: 503, error: "tenant_unavailable" };
  }
  if (config.BILLING_ENABLED) {
    const sub = await prisma.billingSubscription.findUnique({
      where: { tenantId: page.tenantId },
      select: { archivedSince: true },
    });
    if (sub?.archivedSince) return { status: 503, error: "page_archived" };
  }
  return null;
}

/**
 * Whether this visitor may see the content of the page. Only a password page
 * can be locked. A password page without a stored hash (never created by the
 * API, and the database would not stop it) fails closed: nobody unlocks it.
 */
function isUnlocked(req: FastifyRequest, page: PublicPage): boolean {
  if (page.access !== "password") return true;
  if (!page.passwordHash) return false;
  const cookie = req.cookies?.[pageVisitorCookieName(page.id)];
  const claims = cookie ? verifyPageVisitorToken(cookie) : null;
  return (
    !!claims &&
    claims.pid === page.id &&
    claims.pwfp === passwordFingerprint(page.passwordHash)
  );
}

/** Short hash of a storage key, appended to the cover URL: a new cover means a
 *  new URL, so a browser does not keep showing the old one. */
function cacheBust(key: string): string {
  return "?v=" + createHash("sha1").update(key).digest("hex").slice(0, 8);
}

/**
 * The galleries of a page as a visitor sees them: only those that are
 * rendered at all (live, not expired, publicAccess), in the studio's order.
 * Cover, description and photo count only where the preview rule allows.
 */
async function visibleGalleries(page: PublicPage) {
  const rows = await prisma.landingPageGallery.findMany({
    where: { landingPageId: page.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    take: PAGE_GALLERY_LIMIT,
    select: {
      titleOverride: true,
      previewOptIn: true,
      gallery: {
        select: {
          id: true,
          tenantId: true,
          slug: true,
          title: true,
          description: true,
          createdAt: true,
          status: true,
          publicAccess: true,
          expiresAt: true,
          passwordHash: true,
          heroFileId: true,
        },
      },
    },
  });

  const now = new Date();
  const shown = rows.filter(
    (r) =>
      // Links across tenants cannot be created through the API. Checked anyway,
      // this is the boundary between two studios.
      r.gallery.tenantId === page.tenantId &&
      galleryIneligibleReason(r.gallery, now) === null
  );
  const withPreview = shown.filter((r) =>
    isPreviewVisible(r.gallery, r.previewOptIn)
  );

  const covers = await resolveCoverThumbs(
    withPreview.map((r) => r.gallery),
    { publicOnly: true }
  );
  const counts = new Map<string, number>();
  if (withPreview.length > 0) {
    const grouped = await prisma.file.groupBy({
      by: ["galleryId"],
      where: {
        galleryId: { in: withPreview.map((r) => r.gallery.id) },
        status: "ready",
        publicVisibility: "visible",
      },
      _count: { _all: true },
    });
    for (const g of grouped) counts.set(g.galleryId, g._count._all);
  }
  const previewIds = new Set(withPreview.map((r) => r.gallery.id));

  return shown.map((r) => {
    const g = r.gallery;
    const preview = previewIds.has(g.id);
    const cover = preview ? covers.get(g.id) : undefined;
    return {
      slug: g.slug,
      title: r.titleOverride ?? g.title,
      createdAt: g.createdAt,
      protected: isGalleryProtected(g),
      // False = the card shows a placeholder instead of cover, description and count.
      previewVisible: preview,
      description: preview ? g.description : null,
      fileCount: preview ? (counts.get(g.id) ?? 0) : null,
      cover: cover
        ? {
            url: `/api/v1/p/${page.slug}/covers/${g.slug}${cacheBust(cover.storageKey)}`,
            width: cover.width,
            height: cover.height,
          }
        : null,
    };
  });
}

/** The response for a page, locked or not. */
async function pageResponse(page: PublicPage, unlocked: boolean) {
  const branding = await resolveGalleryBranding({
    galleryBrandingId: page.brandingId,
    tenantId: page.tenantId,
  });
  const faviconUrl = await resolveFaviconUrl(
    page.tenantId,
    branding?.faviconUrl ?? null
  );
  const access = page.access as PageAccess;
  return {
    page: {
      slug: page.slug,
      title: page.title,
      // A locked page tells the visitor nothing beyond its title.
      introMarkdown: unlocked ? page.introMarkdown : null,
      access,
      isDefault: page.isStudioDefault,
      indexable: isPageIndexable(access),
      locked: !unlocked,
      studioName: page.tenant.displayName ?? page.tenant.name,
      branding,
      faviconUrl,
    },
    galleries: unlocked ? await visibleGalleries(page) : [],
  };
}

export async function registerLandingPagePublicRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // GET /p — the start page of the resolved tenant
  // -------------------------------------------------------------------------
  // The root route asks this before it falls back to the /login redirect, so
  // every reason not to serve a page (none set, flag off, studio offline) is a
  // plain error status for it.
  app.get("/p", async (req, reply) => {
    const page = await resolveDefaultPage(req, { select: PUBLIC_PAGE_SELECT });
    if (!page) return reply.status(404).send({ error: "not_found" });
    const offline = await offlineReason(page);
    if (offline) return reply.status(offline.status).send({ error: offline.error });
    // The database only lets a public page be the start page, so this is
    // always unlocked. Asking anyway keeps "/" from ever showing a locked
    // page's content if that ever stopped being true.
    return pageResponse(page, isUnlocked(req, page));
  });

  // -------------------------------------------------------------------------
  // GET /p/:slug
  // -------------------------------------------------------------------------
  app.get<{ Params: { slug: string } }>("/p/:slug", async (req, reply) => {
    const page = await resolvePageBySlug(req, req.params.slug, {
      select: PUBLIC_PAGE_SELECT,
    });
    if (!page) return reply.status(404).send({ error: "not_found" });
    const offline = await offlineReason(page);
    if (offline) return reply.status(offline.status).send({ error: offline.error });
    return pageResponse(page, isUnlocked(req, page));
  });

  // -------------------------------------------------------------------------
  // POST /p/:slug/unlock
  // -------------------------------------------------------------------------
  // Same protection as the gallery unlock: rate limited per IP, argon2, failed
  // attempts audited. The cookie is separate from the gallery cookies and
  // unlocks the page only, never a gallery on it.
  app.post<{ Params: { slug: string }; Body: { password?: string } }>(
    "/p/:slug/unlock",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { password } = unlockSchema.parse(req.body);
      const page = await resolvePageBySlug(req, req.params.slug, {
        select: PUBLIC_PAGE_SELECT,
      });
      if (!page) return reply.status(404).send({ error: "not_found" });
      const offline = await offlineReason(page);
      if (offline) return reply.status(offline.status).send({ error: offline.error });

      // Nothing to unlock. Not an error: a stale client after the studio
      // removed the password simply reloads into the open page.
      if (page.access !== "password") return { ok: true };
      // Fail closed: a password page without a hash cannot be unlocked.
      if (!page.passwordHash) {
        return reply.status(401).send({ error: "invalid_password" });
      }

      if (!(await verifyPassword(page.passwordHash, password))) {
        await logEvent({
          tenantId: page.tenantId,
          actorType: "system",
          action: "page.unlock.failed",
          targetType: "page",
          targetId: page.id,
          payload: { reason: "bad_password" },
          ipAddress: req.ip,
        });
        return reply.status(401).send({ error: "invalid_password" });
      }

      // pwfp: fingerprint of the password that was entered, so changing the
      // password invalidates every cookie issued against the old one.
      reply.setCookie(
        pageVisitorCookieName(page.id),
        createPageVisitorToken({
          pid: page.id,
          pwfp: passwordFingerprint(page.passwordHash),
        }),
        {
          path: "/",
          httpOnly: true,
          sameSite: "lax",
          secure: req.protocol === "https",
          maxAge: 8 * 60 * 60, // 8h, like the gallery cookie
        }
      );

      await logEvent({
        tenantId: page.tenantId,
        actorType: "system",
        action: "page.unlock",
        targetType: "page",
        targetId: page.id,
        ipAddress: req.ip,
      });

      return { ok: true };
    }
  );

  // -------------------------------------------------------------------------
  // GET /p/:slug/covers/:gallerySlug
  // -------------------------------------------------------------------------
  // Addressed by the gallery's public slug, not its id: the slug is on the
  // card anyway, the id is internal.
  app.get<{ Params: { slug: string; gallerySlug: string } }>(
    "/p/:slug/covers/:gallerySlug",
    async (req, reply) => {
      const page = await resolvePageBySlug(req, req.params.slug, {
        select: PUBLIC_PAGE_SELECT,
      });
      if (!page) return reply.status(404).send({ error: "not_found" });
      const offline = await offlineReason(page);
      if (offline) return reply.status(offline.status).send({ error: offline.error });
      if (!isUnlocked(req, page)) {
        return reply.status(401).send({ error: "unlock_required" });
      }

      const link = await prisma.landingPageGallery.findFirst({
        where: {
          landingPageId: page.id,
          gallery: { slug: req.params.gallerySlug, tenantId: page.tenantId },
        },
        select: {
          previewOptIn: true,
          gallery: {
            select: {
              id: true,
              status: true,
              publicAccess: true,
              expiresAt: true,
              passwordHash: true,
              heroFileId: true,
            },
          },
        },
      });
      // The same rules as the card: a cover the card does not show is not
      // served here either, whatever URL somebody types.
      if (
        !link ||
        galleryIneligibleReason(link.gallery) !== null ||
        !isPreviewVisible(link.gallery, link.previewOptIn)
      ) {
        return reply.status(404).send({ error: "not_found" });
      }

      const cover = (
        await resolveCoverThumbs([link.gallery], { publicOnly: true })
      ).get(link.gallery.id);
      if (!cover) return reply.status(404).send({ error: "not_set" });

      const url = await presignGet({
        key: cover.storageKey,
        ttlSeconds: COVER_URL_TTL_SECONDS,
      });
      // Private: on a password page the response depends on the cookie. Short,
      // so that turning a preview off takes effect within minutes.
      reply.header("Cache-Control", "private, max-age=120");
      return reply.redirect(url);
    }
  );
}
