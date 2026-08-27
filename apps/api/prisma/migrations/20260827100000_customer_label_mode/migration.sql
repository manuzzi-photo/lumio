-- Bild-Bezeichnung in der Kundengalerie: aus / Dateiname / neutrale Nummer.
--
-- galleries.customerLabelMode  (Prisma: Gallery.customerLabelMode)
--   'hidden'   -> keine Bezeichnung. Default, weil Kundengalerien bis
--                 v0.73.x nie einen Dateinamen angezeigt haben. Bestehende
--                 Galerien sehen dadurch unveraendert aus.
--   'filename' -> echter Dateiname.
--   'index'    -> neutrale Nummer ("Bild 12 von 84"), berechnet aus der
--                 Galerie-Reihenfolge. Zitierbar fuer Rueckfragen, ohne
--                 ueber die Nummernfolge zu verraten wie viel aussortiert
--                 wurde.
--
-- galleries.customerLabelToggleEnabled
--   Darf der Kunde die Bezeichnung selbst ein-/ausblenden? Er wechselt
--   dabei nur zwischen customerLabelMode und 'aus', nie den Modus selbst.
--   Default true: solange der Modus 'hidden' ist, hat das Flag keine
--   Wirkung, und sobald ein Studio bewusst auf 'filename'/'index' stellt,
--   ist "Kunde darf ausblenden" die freundlichere Vorgabe.
--
-- Gleiche zwei Spalten auf gallery_templates, damit ein Studio das als
-- Vorgabe fuer neue Galerien setzen kann.
--
-- Kein Backfill, keine NOT NULL ohne Default -> laeuft auf laufender DB
-- ohne Table-Rewrite durch (Postgres 11+ schreibt Defaults nicht in
-- bestehende Zeilen zurueck).
--
-- NB zu den Namen: TABELLEN sind per @@map snake_case ('galleries',
-- 'gallery_templates'), SPALTEN aber nicht — das Schema nutzt kein
-- @map auf Feldebene, also heissen die Spalten genau wie die Prisma-
-- Felder in camelCase und muessen hier gequotet werden.
ALTER TABLE "galleries"
  ADD COLUMN "customerLabelMode" TEXT NOT NULL DEFAULT 'hidden',
  ADD COLUMN "customerLabelToggleEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "gallery_templates"
  ADD COLUMN "customerLabelMode" TEXT NOT NULL DEFAULT 'hidden',
  ADD COLUMN "customerLabelToggleEnabled" BOOLEAN NOT NULL DEFAULT true;
