[English](BRAND.md) · **Deutsch**

# Lumio — Marke

## Die Bildmarke

Vier gleich große Kacheln auf einem strengen 2×2-Raster, quer durchschnitten
von einer Gerade in 45°. Ein Kontaktbogen mit Auswahlschnitt: die orange
Kachel liegt frei, zwei sind angeschnitten, eine bleibt unberührt.

Eine Gerade kann in diesem Raster höchstens zwei Kacheln anschneiden — die
Aufteilung ist also nicht willkürlich, sondern die einzige, bei der die
orange Kachel ganz bleibt.

## Farben

| Rolle  | Hex       | Verwendung                                  |
|--------|-----------|---------------------------------------------|
| Tinte  | `#12121A` | Kacheln, Wortmarke, dunkle Flächen          |
| Akzent | `#FF4D2E` | genau eine Kachel, der i-Punkt, Descriptor  |
| Papier | `#FAF8F5` | heller Grund, Kacheln auf dunklem Grund     |

Kein Blau, kein Violett, kein Blau-Violett-Verlauf — das ist die Uniform
der übrigen Selfhost-Foto-Apps und war der Grund, den ersten Entwurf zu
verwerfen.

## Schrift

- **Wortmarke: Quicksand SemiBold**, in Pfade gewandelt. Die Logodateien
  laden deshalb keinen Webfont. Quicksand wird *nur* für die Wortmarke
  benutzt, nirgends für Fließtext.
- **UI und Text: Inter.** Unverändert, in allen Repos schon im Einsatz.

## Dateien

`apps/frontend/public/`

| Datei                  | Zweck                                        |
|------------------------|----------------------------------------------|
| `favicon.svg`          | Bildmarke, feste Farben                      |
| `favicon-16/32.png`    | Fallback für ältere Browser                  |
| `apple-touch-icon.png` | 180×180, deckender Grund (iOS mag kein Alpha) |
| `icon-512.png`         | Webmanifest, PWA                             |
| `mark.svg`             | Bildmarke allein                             |
| `logo.svg`             | Marke + Wortmarke, horizontal                |
| `logo-inverse.svg`     | dasselbe für dunkle Flächen                  |
| `wordmark.svg`         | Wortmarke allein                             |
| `og-default.jpg`       | Open-Graph-Bild, 1200×630                    |

`brand/` — Quellen, nicht ausgeliefert

| Datei                  | Zweck                                        |
|------------------------|----------------------------------------------|
| `og-default.svg`       | Quelle des OG-Bilds, Text als Pfade          |
| `logo-cloud.svg`       | gestapeltes Lockup mit `CLOUD`                |
| `logo-selfhosted.svg`  | gestapeltes Lockup mit `SELF-HOSTED`          |
| `mark-mono.svg`        | einfarbig, für Stempel und Fax-Fälle          |
| `mark-inverse.svg`     | helle Kacheln                                 |

## Im Code

`Logo` aus `@/components/ui`, Varianten `mark` und `full`:

```tsx
<Logo variant="full" className="h-6 w-auto" />
```

Die Tinte läuft auf `currentColor`, der Akzent auf `--logo-accent` — das
hängt an `--brand-accent`. Wo die Marke als Ersatz für ein fehlendes
Studio-Logo einspringt, trägt sie also die Akzentfarbe dieses Studios. Auf
dunklem Grund einfach die Textfarbe hell setzen — keine zweite Datei nötig.

Die statischen Dateien unter `public/` (`favicon.svg`, `logo.svg`, die
OG-Bilder) behalten das feste Vermillion. Das ist Lumio als Produkt, da
hat der Tenant nichts zu bestimmen.

## Regeln

- Genau **eine** Kachel trägt den Akzent. Nie zwei, nie alle vier.
- Der Schnitt bleibt eine durchgehende Gerade. Nicht knicken, nicht
  spiegeln, nicht zentrieren.
- Der Innenraum der Kacheln bleibt leer. Kein Symbol, kein Buchstabe darin.
- Mindestgröße 16 px. Darunter nicht mehr verwenden.
- Um das Logo herum mindestens die Breite einer Kachel Luft lassen.
- Auf unruhigem Grund (Foto) die Marke in einen deckenden Chip setzen,
  sonst läuft der Schnitt voll.
