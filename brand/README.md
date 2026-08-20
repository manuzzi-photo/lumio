**English** · [Deutsch](README.de.md) · [Italiano](README.it.md)

# brand/

Every version of the Lumio mark, plus the scripts that generate them.

**The rules and the reasoning behind them are not here** — they live in
[`../docs/BRAND.md`](../docs/BRAND.md). This folder is the storage room, that
document is the rulebook.

Quickest overview: open [`preview.html`](preview.html) in a browser. The page
embeds the files from this folder directly, so it shows the actual state rather
than a redrawing — including real pixel sizes from 16 px up.

## Contents

| Folder | What's in it |
|---|---|
| `logo/` | symbol, wordmark and lockups as SVG, each regular and inverted |
| `favicon/` | favicon SVG, PNG fallbacks, touch icon, web manifest |
| `email/` | PNG versions for email headers |
| `readme/` | lockup PNGs for the README header, light and dark |
| `social/` | social preview card for GitHub — **has to be uploaded there manually**, see `social/README.md` |
| `fonts/` | Quicksand and Inter with their licence texts |
| `src/` | the Python scripts that generate everything above |

### Which file for what

| File | Use |
|---|---|
| `logo/mark.svg` | favicon, app icon, anywhere only the symbol fits |
| `logo/mark-inverse.svg` | the same on a dark background |
| `logo/mark-mono.svg` | single colour, for stamps and one-colour print |
| `logo/mark-thin.svg` | narrower cut — alternative if the slash feels too dominant |
| `logo/logo.svg` | horizontal lockup for headers and signatures |
| `logo/logo-mono-light.svg` | lockup on a coloured surface, where the orange tile would vanish |
| `logo/logo-cloud.svg`, `logo/logo-selfhosted.svg` | stacked, with the product descriptor |
| `logo/wordmark.svg` | just the wordmark, when the symbol already sits next to it |
| `email/logo-email*.png` | email headers. PNG, because Gmail and Outlook don't render SVG |
| `readme/logo-readme*.png` | README header, light and dark |

The shipped copies live under `apps/frontend/public/`. This folder is the
source, not the target — change things here, then copy.

## Regenerating

The SVGs are generated, not hand-drawn. The wordmark is **Quicksand SemiBold
converted to outlines**, so the logo files load no webfont.

```bash
pip install fonttools cairosvg
cd brand/src

python3 build.py            # symbol, wordmark, all lockups
python3 favicon-adaptive.py # favicon with prefers-color-scheme
python3 og.py               # Open Graph images, 1200x630
python3 github.py           # social preview + README logos
```

The scripts locate the fonts by a path relative to themselves, so the call
doesn't depend on the working directory. A run from a fresh copy reproduces all
fourteen SVGs **byte for byte identical** to the ones stored here — if a file
differs, that's a signal and not noise.

## Fonts

`fonts/` holds the two typefaces used, together with their licence texts:

| File | Use |
|---|---|
| `Quicksand.ttf` | wordmark (instance `wght 600`), descriptor (`wght 500`) |
| `Inter.ttf` | headlines of the Open Graph images |
| `Quicksand-OFL.txt`, `Inter-OFL.txt` | the corresponding licences |

Both are under the **SIL Open Font License 1.1**, which explicitly permits
redistribution but requires the licence text to travel along — hence the
`OFL.txt` files next to them. Both families carry a *Reserved Font Name*: a
modified version may not keep the name "Quicksand" or "Inter".

The wordmark in `logo/` is already converted to outlines and no longer needs the
font — these files are only required for regenerating.

## Colours

| Role | Hex | Use |
|---|---|---|
| Ink | `#12121A` | tiles, wordmark, dark surfaces |
| Accent | `#FF4D2E` | exactly one tile, the i-tittle, fills, type from 24 px |
| Accent strong | `#C93214` | links and small text on light backgrounds |
| Paper | `#FAF8F5` | light background, labels on orange fills |

## Using this elsewhere

The code is licensed under FSL-1.1-ALv2. **The name and the mark are not covered
by it.** If you self-host Lumio, leave the branding as it is — that's the point.
If you build something of your own on top and distribute it, please put your own
mark on it: otherwise it looks like official Lumio and the support requests land
in the wrong inbox. Everything is swappable: the files under
`apps/frontend/public/`, the `Logo` component, and `--logo-accent` in
`globals.css`.

For press, directories or newsletters, the files here can be used as they are.
`readme/logo-readme.png` (light) and `readme/logo-readme-dark.png` (dark) are the
usual choice, `favicon/icon-512.png` where a square tile is needed. No need to
ask — but do drop a note if something is missing in a format you need.
