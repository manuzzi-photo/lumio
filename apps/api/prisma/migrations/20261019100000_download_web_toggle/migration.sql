-- =============================================================================
-- Downloads: web version can be switched off (#70)
-- =============================================================================
-- A gallery could offer "web only" or "web and originals", never "originals
-- only". downloadWebEnabled adds the missing case. Templates get both switches
-- so new galleries inherit them. Defaults keep every existing gallery and
-- template exactly as it was.

ALTER TABLE "galleries"
    ADD COLUMN "downloadWebEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "gallery_templates"
    ADD COLUMN "downloadOriginalsEnabled" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "downloadWebEnabled" BOOLEAN NOT NULL DEFAULT true;
