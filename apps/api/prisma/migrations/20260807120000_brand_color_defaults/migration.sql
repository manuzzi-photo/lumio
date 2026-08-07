-- Farb-Defaults der Lumio-Marke: Amber -> Vermillion.
--
-- Reine DEFAULT-Aenderung, keine Datenaenderung: bestehende Brandings
-- behalten ihre gesetzten Farben, der neue Wert gilt nur fuer Zeilen, die
-- ab jetzt angelegt werden. Wer sein Branding nie angepasst hat, steht in
-- der DB trotzdem auf dem alten Default und bleibt deshalb bei Amber, bis
-- er im Studio unter Gestaltung eine Farbe waehlt.
--
-- Der Studio-UI-Akzent ist davon unabhaengig: tenants.studioAccentColor ist
-- nullable ohne Default und faellt bei NULL auf die CSS-Variablen zurueck.
-- Der Wechsel dort greift also ohne Migration.

ALTER TABLE "brandings" ALTER COLUMN "primaryColor" SET DEFAULT '#12121A';
ALTER TABLE "brandings" ALTER COLUMN "accentColor" SET DEFAULT '#FF4D2E';
