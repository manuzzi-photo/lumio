[English](README.md) · **Deutsch** · [Italiano](README.it.md)

# brand/

Alle Fassungen der Lumio-Marke, dazu die Skripte, aus denen sie entstehen.

**Die Regeln und ihre Begründungen stehen nicht hier, sondern in
[`../docs/BRAND.md`](../docs/BRAND.md)** (deutsch:
[`../docs/BRAND.de.md`](../docs/BRAND.de.md)). Dieser Ordner ist das Lager,
die Doku ist das Regelwerk.

Schnellster Überblick: [`preview.html`](preview.html) im Browser öffnen. Die
Seite bettet die Dateien aus diesem Ordner direkt ein, zeigt also den
tatsächlichen Stand und keine Nachzeichnung — auch in echten Pixelgrößen ab
16 px.

## Inhalt

| Ordner | Was drin ist |
|---|---|
| `logo/` | Bildmarke, Wortmarke und Lockups als SVG, jeweils normal und invers |
| `favicon/` | Favicon-SVG, PNG-Fallbacks, Touch-Icon, Webmanifest |
| `email/` | PNG-Fassungen für Mail-Köpfe |
| `src/` | die Python-Skripte, die alles oben erzeugen |
| `fonts/` | Quicksand und Inter samt Lizenztexten |
| `readme/` | Lockup-PNGs für den README-Kopf, hell und dunkel |
| `social/` | Social-Preview-Karte für GitHub — **muss dort manuell hochgeladen werden**, siehe `social/README.md` |

### Welche Datei wofür

| Datei | Anwendung |
|---|---|
| `logo/mark.svg` | Favicon, App-Icon, überall wo nur das Zeichen passt |
| `logo/mark-inverse.svg` | dasselbe auf dunklem Grund |
| `logo/mark-mono.svg` | einfarbig, für Stempel und Einfarbdruck |
| `logo/mark-thin.svg` | schmalerer Schnitt — Alternative, falls der Cut zu dominant wirkt |
| `logo/logo.svg` | horizontales Lockup für Kopfzeilen und Signaturen |
| `logo/logo-mono-light.svg` | Lockup auf farbigem Grund; dort verschwände die orange Kachel |
| `logo/logo-cloud.svg`, `logo/logo-selfhosted.svg` | gestapelt mit Produkt-Descriptor |
| `logo/wordmark.svg` | nur der Schriftzug, wenn die Bildmarke schon daneben steht |
| `email/logo-email*.png` | Mail-Köpfe. PNG, weil Gmail und Outlook kein SVG rendern |

Die ausgelieferten Kopien liegen unter `apps/frontend/public/`. Dieser Ordner
ist die Quelle, nicht das Ziel — wer etwas ändert, ändert es hier und kopiert
danach.

## Neu erzeugen

Die SVGs sind generiert, nicht von Hand gezeichnet. Die Wortmarke ist
**Quicksand SemiBold in Pfade gewandelt**, damit die Logodateien keinen
Webfont laden.

```bash
pip install fonttools cairosvg
cd brand/src

python3 build.py            # Bildmarke, Wortmarke, alle Lockups
python3 favicon-adaptive.py # Favicon mit prefers-color-scheme
python3 og.py               # Open-Graph-Bilder 1200x630
python3 github.py           # Social-Preview + README-Logos
```

Die Skripte finden die Schriften über einen Pfad relativ zu sich selbst, der
Aufruf hängt also nicht vom Arbeitsverzeichnis ab. Ein Lauf aus einer frischen
Kopie erzeugt alle vierzehn SVGs **bitgenau identisch** zu den hier abgelegten
— wenn eine Datei abweicht, ist das ein Hinweis und kein Rauschen.

## Schriften

Unter `fonts/` liegen die beiden verwendeten Schriften mit ihren Lizenztexten:

| Datei | Verwendung |
|---|---|
| `Quicksand.ttf` | Wortmarke (Instanz `wght 600`), Descriptor (`wght 500`) |
| `Inter.ttf` | Überschriften der OG-Bilder |
| `Quicksand-OFL.txt`, `Inter-OFL.txt` | die zugehörigen Lizenzen |

Beide stehen unter der **SIL Open Font License 1.1**. Die erlaubt Weitergabe
ausdrücklich, verlangt aber, dass der Lizenztext mitgeht — deshalb liegen die
`OFL.txt` daneben. Beide Familien tragen einen *Reserved Font Name*: eine
veränderte Fassung darf nicht weiter „Quicksand" beziehungsweise „Inter"
heißen.

Die Wortmarke in `logo/` ist ohnehin in Pfade gewandelt und braucht die
Schrift nicht mehr — die Dateien hier werden nur zum Neu-Erzeugen gebraucht.

`build.py` schreibt nebenbei `paths.json` — daraus beziehen die Inline-
Komponenten (`apps/frontend/src/components/ui/Logo.tsx` und die
`Logo.astro`-Fassungen der Marketing-Sites) ihre Pfaddaten.

## Farben

| Rolle | Hex | Verwendung |
|---|---|---|
| Tinte | `#12121A` | Kacheln, Wortmarke, dunkle Flächen |
| Akzent | `#FF4D2E` | genau eine Kachel, der i-Punkt, Flächen, Schrift ab 24 px |
| Akzent kräftig | `#C93214` | Links und kleiner Text auf hellem Grund |
| Papier | `#FAF8F5` | heller Grund, Labels auf orangen Flächen |

## Zur Weiterverwendung

Der Code steht unter FSL-1.1-ALv2. **Name und Bildmarke sind davon nicht
erfasst.** Wer Lumio selbst hostet, darf die Marke selbstverständlich
unverändert stehen lassen. Wer daraus etwas Eigenes macht und es weitergibt,
sollte eine eigene Marke setzen — sonst sieht es nach offiziellem Lumio aus,
und der Support landet an der falschen Stelle. Alle Stellen sind
austauschbar: die Dateien unter `apps/frontend/public/`, die
`Logo`-Komponente und `--logo-accent` in `globals.css`.

Für Presse, Verzeichnisse oder Newsletter dürfen die Dateien hier unverändert
verwendet werden. Üblich sind `readme/logo-readme.png` (hell) und
`readme/logo-readme-dark.png` (dunkel), dazu `favicon/icon-512.png`, wo eine
quadratische Kachel gebraucht wird. Nachfragen ist nicht nötig — aber sag
Bescheid, wenn ein Format fehlt.
