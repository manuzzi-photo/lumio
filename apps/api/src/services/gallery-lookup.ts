/**
 * Lumio API — public gallery lookup by slug
 *
 * Gallery slugs are unique per tenant, not per instance
 * (@@unique([tenantId, slug])). Every public route that receives a slug in
 * its path resolves the gallery through resolveGalleryBySlug(), so the
 * tenant rule lives in one place.
 *
 * A visitor has no session and sends no X-Lumio-Tenant header, so the tenant
 * comes from the request host (custom domain or subdomain) via resolveTenant().
 */
import type { Prisma } from "@prisma/client";

import { config } from "../config.js";
import { prisma } from "../db.js";

/**
 * Resolves a gallery by its public slug.
 *
 * - Multi mode and the request host maps to a tenant: exact lookup on
 *   (tenantId, slug). A miss is final. A gallery of another tenant is never
 *   served under this tenant's host.
 * - Otherwise a slug-only lookup that serves the gallery only if exactly one
 *   matches, and refuses to guess (null) if several tenants use that slug.
 *   This covers a multi-tenant self-host without per-tenant subdomains or
 *   custom domains (tenantId is ""), where every gallery link used to work
 *   because the lookup was global.
 * - Single mode always takes the slug-only path. It has one tenant, so a slug
 *   is unique instance-wide and the result is identical to the old global
 *   lookup. This also keeps working if a second tenant was added to a
 *   single-mode install: getDefaultTenantId() pins every visitor to the oldest
 *   tenant, which would otherwise 404 the other tenant's galleries.
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
