/**
 * Lumio API — public gallery lookup by slug
 *
 * Gallery slugs are unique per tenant, not per instance
 * (@@unique([tenantId, slug])). Every public route that receives a slug in
 * its path resolves the gallery through resolveGalleryBySlug(), so the
 * tenant rule lives in one place.
 *
 * req.tenantId is whatever resolveTenant() returned for the request: a session,
 * an X-Lumio-Tenant header, a custom domain, a subdomain or the single-mode
 * default, in that order. For an anonymous visitor, i.e. a studio's client, it
 * is derived from the request host.
 */
import type { Prisma } from "@prisma/client";

import { config } from "../config.js";
import { prisma } from "../db.js";

/**
 * Resolves a gallery by its public slug.
 *
 * - Multi mode and a tenant was resolved (tenantId is set): exact lookup on
 *   (tenantId, slug). A miss is final. A gallery of another tenant is never
 *   served for this tenant.
 * - Otherwise a slug-only lookup that serves the gallery only if exactly one
 *   matches, and refuses to guess (null) if several tenants use that slug.
 *   This covers a multi-tenant self-host without per-tenant subdomains or
 *   custom domains (tenantId is ""), where every gallery link used to work
 *   because the lookup was global.
 * - Single mode always takes the slug-only path. With its one tenant a slug is
 *   unique instance-wide, so the result is identical to the old global lookup.
 *   It also keeps working if a second tenant was added to a single-mode
 *   install: getDefaultTenantId() pins every visitor to the oldest tenant,
 *   which would otherwise 404 the other tenant's galleries. Only if two
 *   tenants use the same slug does the lookup return null, as in the case
 *   above.
 *
 * One query in every case: this runs on every file, ZIP and HLS request.
 */
export async function resolveGalleryBySlug<
  const S extends Prisma.GallerySelect,
>(
  req: { tenantId: string },
  slug: string,
  { select }: { select: S }
): Promise<Prisma.GalleryGetPayload<{ select: S }> | null> {
  if (config.DEPLOYMENT_MODE === "multi" && req.tenantId) {
    return (await prisma.gallery.findUnique({
      where: { tenantId_slug: { tenantId: req.tenantId, slug } },
      select,
    })) as Prisma.GalleryGetPayload<{ select: S }> | null;
  }

  // take: 2 is enough to tell "unique" from "ambiguous" without loading more.
  const matches = (await prisma.gallery.findMany({
    where: { slug },
    select,
    take: 2,
  })) as Prisma.GalleryGetPayload<{ select: S }>[];
  return matches.length === 1 ? matches[0] : null;
}
