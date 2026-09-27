/**
 * Lumio API — public landing page lookup by slug
 *
 * Same rule as gallery slugs (see gallery-lookup.ts): page slugs are unique per
 * tenant, not per instance (@@unique([tenantId, slug])), and req.tenantId is
 * whatever resolveTenant() returned for the request host.
 */
import type { Prisma } from "@prisma/client";

import { config } from "../config.js";
import { prisma } from "../db.js";

/**
 * Resolves a landing page by its public slug.
 *
 * - Multi mode and a tenant was resolved: exact lookup on (tenantId, slug). A
 *   miss is final, a page of another tenant is never served.
 * - Otherwise a slug-only lookup that serves the page only if exactly one
 *   matches and refuses to guess (null) if several tenants use that slug.
 *   This covers a multi-tenant self-host without per-tenant subdomains and
 *   single mode, where one tenant makes a slug unique instance-wide.
 */
export async function resolvePageBySlug<const S extends Prisma.LandingPageSelect>(
  req: { tenantId: string },
  slug: string,
  { select }: { select: S }
): Promise<Prisma.LandingPageGetPayload<{ select: S }> | null> {
  if (config.DEPLOYMENT_MODE === "multi" && req.tenantId) {
    return (await prisma.landingPage.findUnique({
      where: { tenantId_slug: { tenantId: req.tenantId, slug } },
      select,
    })) as Prisma.LandingPageGetPayload<{ select: S }> | null;
  }

  // take: 2 is enough to tell "unique" from "ambiguous" without loading more.
  const matches = (await prisma.landingPage.findMany({
    where: { slug },
    select,
    take: 2,
  })) as Prisma.LandingPageGetPayload<{ select: S }>[];
  return matches.length === 1 ? matches[0] : null;
}

/**
 * The studio's start page (the one served on "/"), or null. Needs a resolved
 * tenant: on the apex of a multi-tenant instance there is none, and "/" keeps
 * showing the tenant picker.
 */
export async function resolveDefaultPage<
  const S extends Prisma.LandingPageSelect,
>(
  req: { tenantId: string },
  { select }: { select: S }
): Promise<Prisma.LandingPageGetPayload<{ select: S }> | null> {
  if (!req.tenantId) return null;
  return (await prisma.landingPage.findFirst({
    where: { tenantId: req.tenantId, isStudioDefault: true },
    select,
  })) as Prisma.LandingPageGetPayload<{ select: S }> | null;
}

/**
 * Whether a slug is already taken by another page. Tenant-scoped, except in
 * single mode: there resolvePageBySlug() always takes the slug-only path and
 * returns null as soon as two tenants share a slug, so a second tenant taking
 * a slug the first already uses would silently break the first one's links.
 * Same reasoning, and the same exception, as for gallery slugs.
 */
export async function isPageSlugTaken(opts: {
  tenantId: string;
  slug: string;
  excludePageId?: string;
}): Promise<boolean> {
  const taken = await prisma.landingPage.findFirst({
    where: {
      ...(config.DEPLOYMENT_MODE === "single" ? {} : { tenantId: opts.tenantId }),
      slug: opts.slug,
      ...(opts.excludePageId ? { NOT: { id: opts.excludePageId } } : {}),
    },
    select: { id: true },
  });
  return taken !== null;
}
