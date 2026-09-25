-- =============================================================================
-- Landing pages: curated, ordered lists of galleries with their own link
-- =============================================================================
-- A page (landing_pages) lists galleries (landing_page_galleries). A gallery can
-- sit on any number of pages. Purely additive: nothing changes for a studio
-- until it creates a page, and a page is link_only until someone makes it public.
--
-- Prisma emitted everything below except the last two statements, which it
-- cannot express (partial unique index, CHECK constraint).

CREATE TABLE "landing_pages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "brandingId" UUID,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "introMarkdown" TEXT,
    "access" TEXT NOT NULL DEFAULT 'link_only',
    "passwordHash" TEXT,
    "isStudioDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "landing_pages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "landing_page_galleries" (
    "landingPageId" UUID NOT NULL,
    "galleryId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "titleOverride" TEXT,
    "previewOptIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "landing_page_galleries_pkey" PRIMARY KEY ("landingPageId","galleryId")
);

CREATE INDEX "landing_pages_tenantId_idx" ON "landing_pages"("tenantId");

-- Serves the slug-only fallback in resolvePageBySlug() (no tenant resolvable
-- from the request host), same as "galleries_slug_idx".
CREATE INDEX "landing_pages_slug_idx" ON "landing_pages"("slug");

CREATE UNIQUE INDEX "landing_pages_tenantId_slug_key" ON "landing_pages"("tenantId", "slug");

CREATE INDEX "landing_page_galleries_galleryId_idx" ON "landing_page_galleries"("galleryId");

CREATE INDEX "landing_page_galleries_landingPageId_sortOrder_idx" ON "landing_page_galleries"("landingPageId", "sortOrder");

ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_brandingId_fkey" FOREIGN KEY ("brandingId") REFERENCES "brandings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "landing_page_galleries" ADD CONSTRAINT "landing_page_galleries_landingPageId_fkey" FOREIGN KEY ("landingPageId") REFERENCES "landing_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "landing_page_galleries" ADD CONSTRAINT "landing_page_galleries_galleryId_fkey" FOREIGN KEY ("galleryId") REFERENCES "galleries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one start page per studio. A partial unique index: only rows with
-- isStudioDefault = true take part, so any number of pages may be non-default.
CREATE UNIQUE INDEX "landing_pages_one_default_per_tenant"
  ON "landing_pages"("tenantId")
  WHERE "isStudioDefault";

-- Only a public page may be the start page (it is served on "/"). Enforced here
-- as well as in the API so a bug there cannot expose a link_only or password
-- page on the studio's front door.
ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_default_is_public"
  CHECK (NOT "isStudioDefault" OR "access" = 'public');
