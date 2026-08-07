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
cd brand/src
pip install fonttools cairosvg
curl -sL -o Quicksand.ttf \
  "https://github.com/google/fonts/raw/main/ofl/quicksand/Quicksand%5Bwght%5D.ttf"
curl -sL -o Inter.ttf \
  "https://github.com/google/fonts/raw/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf"

python3 build.py            # Bildmarke, Wortmarke, alle Lockups
python3 favicon-adaptive.py # Favicon mit prefers-color-scheme
python3 og.py               # Open-Graph-Bilder 1200x630
```

Die Schriften werden bewusst **nicht** mitgeliefert, sondern beim Bauen
geladen. Beide stehen unter der SIL Open Font License; wer sie weitergibt,
muss den Lizenztext beilegen.

`build.py` schreibt nebenbei `paths.json` — daraus beziehen die Inline-
Komponenten (`apps/frontend/src/components/ui/Logo.tsx` und die
`Logo.astro`-Fassungen der Marketing-Sites) ihre Pfaddaten.

## Zur Weiterverwendung

Der Code steht unter FSL-1.1-ALv2. **Name und Bildmarke sind davon nicht
erfasst.** Wer Lumio selbst hostet, darf die Marke selbstverständlich
unverändert stehen lassen. Wer daraus etwas Eigenes macht und es weitergibt,
sollte eine eigene Marke setzen — sonst sieht es nach offiziellem Lumio aus,
und der Support landet an der falschen Stelle. Alle Stellen sind
austauschbar: die Dateien unter `apps/frontend/public/`, die
`Logo`-Komponente und `--logo-accent` in `globals.css`.
