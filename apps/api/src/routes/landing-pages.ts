/**
 * Lumio API — landing pages, studio side
 *
 * A landing page ("Page" in the studio) is a curated, ordered list of
 * galleries with its own link. What a visitor may see of one is decided in
 * services/landing-pages.ts; the public endpoints are in
 * landing-pages-public.ts.
 *
 *   GET    /pages                              — list
 *   POST   /pages                              — create (link_only), optionally with a first gallery
 *   GET    /pages/:id                          — page + its galleries
 *   PATCH  /pages/:id                          — title, intro, slug, access, password, branding, start page
 *   DELETE /pages/:id
 *
 *   POST   /pages/:id/galleries                — put a gallery on the page
 *   PATCH  /pages/:id/galleries/:galleryId     — per-page title, preview opt-in
 *   DELETE /pages/:id/galleries/:galleryId
 *   POST   /pages/:id/galleries/reorder        — manual order
 *
 *   GET    /galleries/:id/pages                — every page, and whether it holds this gallery
 *
 * Owner and admin only (same rule as a gallery's custom slug): a page is
 * public content of the studio, a member must not be able to publish a
 * gallery on one. All of it sits behind the landing_pages feature flag.
 *
 * Reach: an admin may put on a page only galleries they can access
 * (galleryAccessWhere, the owner reaches every gallery of the studio). What is
 * already on a page is visible to every owner/admin, since it is public anyway,
 * and can be reordered or removed by them.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "../db.js";
import { generateGallerySlug } from "../services/ids.js";
import {
  validateGallerySlugFormat,
  GALLERY_SLUG_MAX_LENGTH,
} from "../services/slugs.js";
import { hashPassword, type SessionContext } from "../services/auth.js";
import { isFeatureEnabled } from "../services/feature-flags.js";
import { logEvent } from "../services/audit.js";
import { presignGet } from "../services/storage.js";
import { resolveCoverThumbs } from "../services/gallery-covers.js";
import { galleryAccessWhere } from "../lib/gallery-access.js";
import { isPageSlugTaken } from "../services/landing-page-lookup.js";
import {
  PAGE_ACCESS,
  PAGE_GALLERY_LIMIT,
  PAGE_GALLERY_TITLE_MAX_LENGTH,
  PAGE_INTRO_MAX_LENGTH,
  PAGE_TITLE_MAX_LENGTH,
  galleryIneligibleReason,
  isGalleryProtected,
  resolvePageAccessChange,
  type PageAccess,
} from "../services/landing-pages.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const idParams = z.object({ id: z.string().uuid() });
const itemParams = z.object({
  id: z.string().uuid(),
  galleryId: z.string().uuid(),
});

const createSchema = z.object({
  title: z.string().trim().min(1).max(PAGE_TITLE_MAX_LENGTH),
  /** Put this gallery on the new page in the same step ("New page..." in a
   *  gallery's Share tab). */
  galleryId: z.string().uuid().optional(),
});

const updateSchema = z.object({
  title: z.string().trim().min(1).max(PAGE_TITLE_MAX_LENGTH).optional(),
  introMarkdown: z.string().max(PAGE_INTRO_MAX_LENGTH).nullable().optional(),
  slug: z.string().max(GALLERY_SLUG_MAX_LENGTH).optional(),
  access: z.enum(PAGE_ACCESS).optional(),
  password: z.string().min(1).max(200).nullable().optional(),
  brandingId: z.string().uuid().nullable().optional(),
  isStudioDefault: z.boolean().optional(),
});

const addGallerySchema = z.object({ galleryId: z.string().uuid() });

const updateItemSchema = z.object({
  titleOverride: z
    .string()
    .max(PAGE_GALLERY_TITLE_MAX_LENGTH)
    .nullable()
    .optional(),
  previewOptIn: z.boolean().optional(),
});

const reorderSchema = z.object({
  order: z.array(z.string().uuid()).max(PAGE_GALLERY_LIMIT),
});

// ---------------------------------------------------------------------------
// Selects and DTOs
// ---------------------------------------------------------------------------

const PAGE_SELECT = {
  id: true,
  slug: true,
  title: true,
  introMarkdown: true,
  access: true,
  passwordHash: true,
  isStudioDefault: true,
  brandingId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.LandingPageSelect;

type PageRow = Prisma.LandingPageGetPayload<{ select: typeof PAGE_SELECT }>;

const ITEM_SELECT = {
  galleryId: true,
  sortOrder: true,
  titleOverride: true,
  previewOptIn: true,
  gallery: {
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      status: true,
      publicAccess: true,
      expiresAt: true,
      passwordHash: true,
      heroFileId: true,
      _count: { select: { files: true } },
    },
  },
} satisfies Prisma.LandingPageGallerySelect;

type ItemRow = Prisma.LandingPageGalleryGetPayload<{
  select: typeof ITEM_SELECT;
}>;

const ITEM_ORDER: Prisma.LandingPageGalleryOrderByWithRelationInput[] = [
  { sortOrder: "asc" },
  { createdAt: "asc" },
];

/** The page as the studio sees it. The password hash never leaves the API. */
function pageDto(p: PageRow) {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    introMarkdown: p.introMarkdown,
    access: p.access as PageAccess,
    hasPassword: p.passwordHash !== null,
    isStudioDefault: p.isStudioDefault,
    brandingId: p.brandingId,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/**
 * A gallery on a page, as the studio sees it. Unlike the public view this
 * carries everything, including why a gallery is not rendered right now, so
 * the editor can say "not visible: draft / expired / needs a share link".
 */
async function itemDtos(rows: ItemRow[]) {
  const covers = await resolveCoverThumbs(rows.map((r) => r.gallery));
  const coverUrls = new Map<string, string>();
  await Promise.all(
    [...covers.entries()].map(async ([galleryId, cover]) => {
      coverUrls.set(galleryId, await presignGet({ key: cover.storageKey }));
    })
  );
  const now = new Date();
  return rows.map((r) => ({
    galleryId: r.galleryId,
    sortOrder: r.sortOrder,
    titleOverride: r.titleOverride,
    previewOptIn: r.previewOptIn,
    gallery: {
      slug: r.gallery.slug,
      title: r.gallery.title,
      description: r.gallery.description,
      status: r.gallery.status,
      publicAccess: r.gallery.publicAccess,
      expiresAt: r.gallery.expiresAt,
      protected: isGalleryProtected(r.gallery),
      fileCount: r.gallery._count.files,
      coverThumbUrl: coverUrls.get(r.galleryId) ?? null,
    },
    ineligibleReason: galleryIneligibleReason(r.gallery, now),
  }));
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

/** Logged in, owner or admin, feature enabled. Sends the error itself and
 *  returns null when the request must stop. */
async function guard(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<SessionContext | null> {
  const s = req.requireAuth();
  if (s.user.role !== "owner" && s.user.role !== "admin") {
    reply.status(403).send({ error: "forbidden" });
    return null;
  }
  if (!(await isFeatureEnabled(s.user.tenantId, "landing_pages"))) {
    reply.status(404).send({ error: "not_found" });
    return null;
  }
  return s;
}

async function loadPage(tenantId: string, id: string) {
  return prisma.landingPage.findFirst({
    where: { id, tenantId },
    select: PAGE_SELECT,
  });
}

export async function registerLandingPageRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // GET /pages
  // -------------------------------------------------------------------------
  app.get("/pages", async (req, reply) => {
    const s = await guard(req, reply);
    if (!s) return;

    const pages = await prisma.landingPage.findMany({
      where: { tenantId: s.user.tenantId },
      orderBy: [{ isStudioDefault: "desc" }, { createdAt: "desc" }],
      select: {
        ...PAGE_SELECT,
        galleries: {
          select: {
            gallery: {
              select: { status: true, expiresAt: true, publicAccess: true },
            },
          },
        },
      },
    });

    const now = new Date();
    return {
      pages: pages.map(({ galleries, ...page }) => ({
        ...pageDto(page),
        galleryCount: galleries.length,
        // How many a visitor actually sees right now.
        visibleCount: galleries.filter(
          (g) => galleryIneligibleReason(g.gallery, now) === null
        ).length,
      })),
    };
  });

  // -------------------------------------------------------------------------
  // POST /pages
  // -------------------------------------------------------------------------
  app.post("/pages", async (req, reply) => {
    const s = await guard(req, reply);
    if (!s) return;
    const tenantId = s.user.tenantId;
    const body = createSchema.parse(req.body);

    if (body.galleryId) {
      const gallery = await prisma.gallery.findFirst({
        where: { id: body.galleryId, tenantId, ...galleryAccessWhere(s) },
        select: { id: true },
      });
      if (!gallery) return reply.status(404).send({ error: "gallery_not_found" });
    }

    // Random slug; collisions are astronomically unlikely, but a retry costs
    // nothing. In single mode the check is instance-wide (isPageSlugTaken).
    let page: PageRow | null = null;
    for (let attempt = 0; attempt < 5 && !page; attempt++) {
      const slug = generateGallerySlug();
      if (await isPageSlugTaken({ tenantId, slug })) continue;
      try {
        page = await prisma.landingPage.create({
          data: {
            tenantId,
            slug,
            title: body.title,
            // access defaults to link_only: nothing is public by accident.
            ...(body.galleryId
              ? { galleries: { create: { galleryId: body.galleryId, sortOrder: 0 } } }
              : {}),
          },
          select: PAGE_SELECT,
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    if (!page) {
      return reply
        .status(500)
        .send({ error: "slug_collision", message: "could not generate slug" });
    }

    await logEvent({
      tenantId,
      actorType: "user",
      actorId: s.user.id,
      action: "page.create",
      targetType: "page",
      targetId: page.id,
      payload: {
        slug: page.slug,
        title: page.title,
        ...(body.galleryId ? { galleryId: body.galleryId } : {}),
      },
      ipAddress: req.ip,
    });

    return reply.status(201).send({ page: pageDto(page) });
  });

  // -------------------------------------------------------------------------
  // GET /pages/:id
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>("/pages/:id", async (req, reply) => {
    const s = await guard(req, reply);
    if (!s) return;
    const { id } = idParams.parse(req.params);

    const page = await loadPage(s.user.tenantId, id);
    if (!page) return reply.status(404).send({ error: "not_found" });

    const rows = await prisma.landingPageGallery.findMany({
      where: { landingPageId: page.id },
      orderBy: ITEM_ORDER,
      select: ITEM_SELECT,
    });

    return { page: pageDto(page), galleries: await itemDtos(rows) };
  });

  // -------------------------------------------------------------------------
  // PATCH /pages/:id
  // -------------------------------------------------------------------------
  app.patch<{ Params: { id: string } }>("/pages/:id", async (req, reply) => {
    const s = await guard(req, reply);
    if (!s) return;
    const tenantId = s.user.tenantId;
    const { id } = idParams.parse(req.params);
    const body = updateSchema.parse(req.body);

    const existing = await loadPage(tenantId, id);
    if (!existing) return reply.status(404).send({ error: "not_found" });

    // --- slug --------------------------------------------------------------
    // Changing it breaks a link already shared with a client, same tradeoff as
    // a gallery's custom slug.
    let newSlug: string | undefined;
    if (body.slug !== undefined) {
      const candidate = body.slug.trim().toLowerCase();
      const fmt = validateGallerySlugFormat(candidate);
      if (!fmt.ok) {
        return reply.status(400).send({
          error: "invalid_page_slug",
          message: fmt.message ?? "Invalid page URL.",
        });
      }
      if (
        candidate !== existing.slug &&
        (await isPageSlugTaken({ tenantId, slug: candidate, excludePageId: id }))
      ) {
        return reply
          .status(409)
          .send({ error: "page_slug_taken", message: "This page URL is already taken." });
      }
      newSlug = candidate;
    }

    // --- branding ----------------------------------------------------------
    if (body.brandingId) {
      const branding = await prisma.branding.findFirst({
        where: { id: body.brandingId, tenantId },
        select: { id: true },
      });
      if (!branding) return reply.status(400).send({ error: "invalid_branding" });
    }

    // --- access, password and start page ------------------------------------
    const change = resolvePageAccessChange(
      {
        access: existing.access as PageAccess,
        hasPassword: existing.passwordHash !== null,
        isStudioDefault: existing.isStudioDefault,
      },
      {
        access: body.access,
        password: body.password,
        isStudioDefault: body.isStudioDefault,
      }
    );
    if (!change.ok) {
      return reply
        .status(change.error === "password_required" ? 400 : 409)
        .send({ error: change.error });
    }
    const { access, isStudioDefault, startPageChanged } = change;
    const passwordHash: string | null | undefined =
      change.passwordAction === "set"
        ? await hashPassword(body.password as string)
        : change.passwordAction === "clear"
          ? null
          : undefined; // leave as is

    const changed: string[] = [];
    if (body.title !== undefined && body.title !== existing.title) changed.push("title");
    if (body.introMarkdown !== undefined) changed.push("introMarkdown");
    if (newSlug !== undefined && newSlug !== existing.slug) changed.push("slug");
    if (access !== existing.access) changed.push("access");
    if (body.password) changed.push("password");
    if (body.brandingId !== undefined && body.brandingId !== existing.brandingId) {
      changed.push("brandingId");
    }

    let page: PageRow;
    let displacedStartPage: { id: string; slug: string } | null = null;
    try {
      page = await prisma.$transaction(async (tx) => {
        // The partial unique index allows one start page per tenant, so the
        // old one has to go first.
        if (isStudioDefault && startPageChanged) {
          displacedStartPage = await tx.landingPage.findFirst({
            where: { tenantId, isStudioDefault: true, NOT: { id } },
            select: { id: true, slug: true },
          });
          if (displacedStartPage) {
            await tx.landingPage.update({
              where: { id: displacedStartPage.id },
              data: { isStudioDefault: false },
            });
          }
        }
        return tx.landingPage.update({
          where: { id },
          data: {
            ...(body.title !== undefined ? { title: body.title } : {}),
            ...(body.introMarkdown !== undefined
              ? { introMarkdown: body.introMarkdown?.trim() ? body.introMarkdown : null }
              : {}),
            ...(newSlug !== undefined ? { slug: newSlug } : {}),
            access,
            ...(passwordHash !== undefined ? { passwordHash } : {}),
            ...(body.brandingId !== undefined ? { brandingId: body.brandingId } : {}),
            isStudioDefault,
          },
          select: PAGE_SELECT,
        });
      });
    } catch (err) {
      // Two PATCHes can both pass the availability check above and race to the
      // unique index.
      if (isUniqueViolation(err)) {
        return reply
          .status(409)
          .send({ error: "page_slug_taken", message: "This page URL is already taken." });
      }
      throw err;
    }

    if (changed.length > 0) {
      await logEvent({
        tenantId,
        actorType: "user",
        actorId: s.user.id,
        action: "page.update",
        targetType: "page",
        targetId: id,
        // Never the password itself, nor the intro text: what changed, and the
        // access mode because it decides who can see the page.
        payload: { slug: page.slug, fields: changed, access: page.access },
        ipAddress: req.ip,
      });
    }
    if (startPageChanged) {
      await logEvent({
        tenantId,
        actorType: "user",
        actorId: s.user.id,
        action: isStudioDefault ? "page.set_default" : "page.unset_default",
        targetType: "page",
        targetId: id,
        payload: { slug: page.slug },
        ipAddress: req.ip,
      });
    }
    // The page that lost the flag to this one: what "/" shows changed, so the
    // audit trail says so for both pages.
    const displaced = displacedStartPage as { id: string; slug: string } | null;
    if (displaced) {
      await logEvent({
        tenantId,
        actorType: "user",
        actorId: s.user.id,
        action: "page.unset_default",
        targetType: "page",
        targetId: displaced.id,
        payload: { slug: displaced.slug, replacedBy: page.slug },
        ipAddress: req.ip,
      });
    }

    return {
      page: pageDto(page),
      // The UI tells the studio that "/" is back to the login redirect.
      startPageRemoved: existing.isStudioDefault && !isStudioDefault,
    };
  });

  // -------------------------------------------------------------------------
  // DELETE /pages/:id
  // -------------------------------------------------------------------------
  app.delete<{ Params: { id: string } }>("/pages/:id", async (req, reply) => {
    const s = await guard(req, reply);
    if (!s) return;
    const { id } = idParams.parse(req.params);

    const existing = await loadPage(s.user.tenantId, id);
    if (!existing) return reply.status(404).send({ error: "not_found" });

    // The links to its galleries cascade, the galleries themselves stay.
    await prisma.landingPage.delete({ where: { id } });

    await logEvent({
      tenantId: s.user.tenantId,
      actorType: "user",
      actorId: s.user.id,
      action: "page.delete",
      targetType: "page",
      targetId: id,
      payload: {
        slug: existing.slug,
        title: existing.title,
        wasStartPage: existing.isStudioDefault,
      },
      ipAddress: req.ip,
    });

    return reply.status(204).send();
  });

  // -------------------------------------------------------------------------
  // POST /pages/:id/galleries
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/pages/:id/galleries",
    async (req, reply) => {
      const s = await guard(req, reply);
      if (!s) return;
      const tenantId = s.user.tenantId;
      const { id } = idParams.parse(req.params);
      const { galleryId } = addGallerySchema.parse(req.body);

      const page = await loadPage(tenantId, id);
      if (!page) return reply.status(404).send({ error: "not_found" });

      // Only a gallery the caller can access, and only of this tenant.
      const gallery = await prisma.gallery.findFirst({
        where: { id: galleryId, tenantId, ...galleryAccessWhere(s) },
        select: { id: true },
      });
      if (!gallery) return reply.status(404).send({ error: "gallery_not_found" });

      const current = await prisma.landingPageGallery.aggregate({
        where: { landingPageId: id },
        _count: { _all: true },
        _max: { sortOrder: true },
      });
      if (current._count._all >= PAGE_GALLERY_LIMIT) {
        return reply.status(409).send({ error: "page_full" });
      }

      try {
        await prisma.landingPageGallery.create({
          data: {
            landingPageId: id,
            galleryId,
            sortOrder: (current._max.sortOrder ?? -1) + 1,
          },
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          return reply.status(409).send({ error: "already_on_page" });
        }
        throw err;
      }

      await logEvent({
        tenantId,
        actorType: "user",
        actorId: s.user.id,
        action: "page.gallery_add",
        targetType: "page",
        targetId: id,
        payload: { slug: page.slug, galleryId },
        ipAddress: req.ip,
      });

      const row = await prisma.landingPageGallery.findUniqueOrThrow({
        where: { landingPageId_galleryId: { landingPageId: id, galleryId } },
        select: ITEM_SELECT,
      });
      return reply.status(201).send({ gallery: (await itemDtos([row]))[0] });
    }
  );

  // -------------------------------------------------------------------------
  // PATCH /pages/:id/galleries/:galleryId
  // -------------------------------------------------------------------------
  app.patch<{ Params: { id: string; galleryId: string } }>(
    "/pages/:id/galleries/:galleryId",
    async (req, reply) => {
      const s = await guard(req, reply);
      if (!s) return;
      const tenantId = s.user.tenantId;
      const { id, galleryId } = itemParams.parse(req.params);
      const body = updateItemSchema.parse(req.body);

      const page = await loadPage(tenantId, id);
      if (!page) return reply.status(404).send({ error: "not_found" });

      const existing = await prisma.landingPageGallery.findUnique({
        where: { landingPageId_galleryId: { landingPageId: id, galleryId } },
        select: { galleryId: true, previewOptIn: true },
      });
      if (!existing) return reply.status(404).send({ error: "not_found" });

      const titleOverride =
        body.titleOverride === undefined
          ? undefined
          : body.titleOverride?.trim() || null;

      const row = await prisma.landingPageGallery.update({
        where: { landingPageId_galleryId: { landingPageId: id, galleryId } },
        data: {
          ...(titleOverride !== undefined ? { titleOverride } : {}),
          ...(body.previewOptIn !== undefined
            ? { previewOptIn: body.previewOptIn }
            : {}),
        },
        select: ITEM_SELECT,
      });

      // The preview opt-in decides whether a protected gallery's cover,
      // description and photo count are public, so that is what gets logged.
      if (
        body.previewOptIn !== undefined &&
        body.previewOptIn !== existing.previewOptIn
      ) {
        await logEvent({
          tenantId,
          actorType: "user",
          actorId: s.user.id,
          action: "page.gallery_update",
          targetType: "page",
          targetId: id,
          payload: {
            slug: page.slug,
            galleryId,
            previewOptIn: body.previewOptIn,
          },
          ipAddress: req.ip,
        });
      }

      return { gallery: (await itemDtos([row]))[0] };
    }
  );

  // -------------------------------------------------------------------------
  // DELETE /pages/:id/galleries/:galleryId
  // -------------------------------------------------------------------------
  app.delete<{ Params: { id: string; galleryId: string } }>(
    "/pages/:id/galleries/:galleryId",
    async (req, reply) => {
      const s = await guard(req, reply);
      if (!s) return;
      const tenantId = s.user.tenantId;
      const { id, galleryId } = itemParams.parse(req.params);

      const page = await loadPage(tenantId, id);
      if (!page) return reply.status(404).send({ error: "not_found" });

      // deleteMany: a gallery that is not on the page is not an error, the
      // outcome is what the caller asked for.
      const { count } = await prisma.landingPageGallery.deleteMany({
        where: { landingPageId: id, galleryId },
      });

      if (count > 0) {
        await logEvent({
          tenantId,
          actorType: "user",
          actorId: s.user.id,
          action: "page.gallery_remove",
          targetType: "page",
          targetId: id,
          payload: { slug: page.slug, galleryId },
          ipAddress: req.ip,
        });
      }

      return reply.status(204).send();
    }
  );

  // -------------------------------------------------------------------------
  // POST /pages/:id/galleries/reorder
  // -------------------------------------------------------------------------
  // `order` lists gallery ids in the wanted order. Ids that are not listed keep
  // their relative order after the listed ones, so a concurrent edit by
  // someone else (a gallery added meanwhile) does not fail the request.
  app.post<{ Params: { id: string } }>(
    "/pages/:id/galleries/reorder",
    async (req, reply) => {
      const s = await guard(req, reply);
      if (!s) return;
      const { id } = idParams.parse(req.params);
      const { order } = reorderSchema.parse(req.body);

      const page = await loadPage(s.user.tenantId, id);
      if (!page) return reply.status(404).send({ error: "not_found" });

      if (new Set(order).size !== order.length) {
        return reply.status(400).send({ error: "duplicate_gallery" });
      }
      const current = await prisma.landingPageGallery.findMany({
        where: { landingPageId: id },
        orderBy: ITEM_ORDER,
        select: { galleryId: true },
      });
      const onPage = new Set(current.map((c) => c.galleryId));
      if (!order.every((galleryId) => onPage.has(galleryId))) {
        return reply.status(400).send({ error: "unknown_gallery" });
      }

      const listed = new Set(order);
      const finalOrder = [
        ...order,
        ...current.map((c) => c.galleryId).filter((g) => !listed.has(g)),
      ];
      await prisma.$transaction(
        finalOrder.map((galleryId, index) =>
          prisma.landingPageGallery.update({
            where: {
              landingPageId_galleryId: { landingPageId: id, galleryId },
            },
            data: { sortOrder: index },
          })
        )
      );

      return { ok: true };
    }
  );

  // -------------------------------------------------------------------------
  // GET /galleries/:id/pages
  // -------------------------------------------------------------------------
  // For a gallery's Share tab and for the archive/delete dialogs: every page of
  // the studio, and whether it holds this gallery.
  app.get<{ Params: { id: string } }>(
    "/galleries/:id/pages",
    async (req, reply) => {
      const s = await guard(req, reply);
      if (!s) return;
      const tenantId = s.user.tenantId;
      const { id } = idParams.parse(req.params);

      const gallery = await prisma.gallery.findFirst({
        where: { id, tenantId, ...galleryAccessWhere(s) },
        select: { id: true },
      });
      if (!gallery) return reply.status(404).send({ error: "not_found" });

      const pages = await prisma.landingPage.findMany({
        where: { tenantId },
        orderBy: [{ isStudioDefault: "desc" }, { title: "asc" }],
        select: {
          id: true,
          slug: true,
          title: true,
          access: true,
          isStudioDefault: true,
          galleries: { where: { galleryId: id }, select: { galleryId: true } },
        },
      });

      return {
        pages: pages.map((p) => ({
          id: p.id,
          slug: p.slug,
          title: p.title,
          access: p.access as PageAccess,
          isStudioDefault: p.isStudioDefault,
          contains: p.galleries.length > 0,
        })),
      };
    }
  );
}
