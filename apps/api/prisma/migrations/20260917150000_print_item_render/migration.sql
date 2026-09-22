-- Druckfertige, zugeschnittene Datei pro Bestellzeile (#55, Stufe 2).
--
-- Der vom Kunden gewaehlte Crop war bisher reine Metadaten: gespeichert,
-- nirgends angewendet. Ab jetzt rendert der Worker beim Uebergang nach
-- `paid` fuer jede Zeile mit Crop eine geschnittene JPEG-Datei und legt
-- den S3-Key hier ab. export-zip und die Lab-Adapter nutzen sie statt
-- des Originals.
--
-- An der Bestellzeile, nicht als Rendition: eine Rendition haengt an der
-- Datei, ein Crop an der Zeile — dieselbe Datei kann in zwei Bestellungen
-- zwei Ausschnitte haben.
--
-- Nullable, kein Default, kein Backfill: bestehende Bestellungen bleiben
-- wie sie sind (Original + Crop-Werte in der Ansicht). Kein Table-Rewrite.
-- Spaltennamen camelCase, nur die Tabelle ist per @@map snake_case.
ALTER TABLE "print_order_items"
  ADD COLUMN "printFileKey"   TEXT,
  ADD COLUMN "printFileError" TEXT;
