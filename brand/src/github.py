# -*- coding: utf-8 -*-
"""Repo-Assets: Social-Preview-Karte und die Logos fuer den README-Kopf.

Die Social-Preview ist das Bild, das GitHub, Slack, Mastodon und Co. zeigen,
wenn jemand den Repo-Link teilt. GitHub liest es NICHT aus dem Repo — es muss
einmalig unter Settings -> Social preview hochgeladen werden. Deshalb liegt es
hier unter brand/social/ und nicht in einem ausgelieferten Ordner.

Aufruf:  python3 github.py
"""
import json
import pathlib

import cairosvg
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

HERE = pathlib.Path(__file__).resolve().parent
FONTS = HERE.parent / "fonts"
OUT_SOCIAL = HERE.parent / "social"
OUT_README = HERE.parent / "readme"

INK, ACC, PAPER, MUT = "#12121A", "#FF4D2E", "#FAF8F5", "#8B857D"
D = json.loads((HERE / "paths.json").read_text())

_cache = {}


def inter(weight, opsz=32):
    if weight not in _cache:
        f = instantiateVariableFont(
            TTFont(FONTS / "Inter.ttf"), {"wght": weight, "opsz": opsz}, inplace=False
        )
        _cache[weight] = (f, f.getGlyphSet(), f.getBestCmap(), f["head"].unitsPerEm)
    return _cache[weight]


def text_path(s, weight, size, track=0.0):
    """-> (Pfaddaten, Breite in Zielpixeln, Skalierungsfaktor)."""
    _, gs, cmap, upem = inter(weight)
    sc = size / upem
    pen = SVGPathPen(gs, ntos=lambda v: f"{v:.1f}")
    x = 0.0
    for ch in s:
        gn = cmap.get(ord(ch))
        if gn is None:
            x += 0.35 * upem
            continue
        rec = DecomposingRecordingPen(gs)
        gs[gn].draw(rec)
        for op, args in rec.value:
            args = tuple(
                ((a[0] + x, a[1]) if isinstance(a, tuple) and a and isinstance(a[0], (int, float)) else a)
                for a in args
            )
            getattr(pen, op)(*args)
        x += gs[gn].width + track / sc
    return pen.getCommands(), x * sc, sc


def line(s, weight, size, xpos, ybase, fill, track=0.0):
    d, w, sc = text_path(s, weight, size, track)
    return (
        f'<g transform="translate({xpos:.1f} {ybase:.1f}) scale({sc:.6f} {-sc:.6f})">'
        f'<path d="{d}" fill="{fill}"/></g>\n',
        w,
    )


def lockup(x, y, h, ink):
    """Marke + Wortmarke, aus den in build.py erzeugten Pfaddaten."""
    s = h / D["vb_h"]
    return (
        f'<g transform="translate({x:.1f} {y:.1f}) scale({s:.6f})">'
        f'<g transform="translate(0 {D["mark_y"]:.1f}) scale({D["mark_size"] / 100:.5f})" '
        f'clip-path="url(#ghcut)">'
        f'<rect x="0" y="0" width="46" height="46" rx="9" fill="{ACC}"/>'
        f'<rect x="54" y="0" width="46" height="46" rx="9" fill="{ink}"/>'
        f'<rect x="0" y="54" width="46" height="46" rx="9" fill="{ink}"/>'
        f'<rect x="54" y="54" width="46" height="46" rx="9" fill="{ink}"/></g>'
        f'<g transform="translate({D["word_dx"]:.1f} {D["word_base"]:.1f}) scale(1 -1)">'
        f'<path d="{D["word_ink"]}" fill="{ink}"/>'
        f'<path d="{D["word_acc"]}" fill="{ACC}"/></g></g>\n'
    )


def wrap(w, h, body):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
        f'width="{w}" height="{h}">\n'
        f'<defs><clipPath id="ghcut" clip-rule="evenodd">'
        f'<path d="{D["cut"]}"/></clipPath></defs>\n{body}</svg>\n'
    )


def social():
    """1280x640 — GitHub schneidet mittig, deshalb reichlich Rand."""
    W, H, M = 1280, 640, 96
    body = f'<rect width="{W}" height="{H}" fill="{INK}"/>\n'
    body += f'<rect x="0" y="0" width="10" height="{H}" fill="{ACC}"/>\n'
    body += lockup(M, 132, 62, PAPER)
    # Englisch: der README ist englisch gefuehrt und GitHub ist das
    # internationale Schaufenster. Die deutschen Fassungen der Marke liegen
    # bei den Marketing-Sites unter deren brand/og-default.svg.
    body += line("Photo galleries that stay yours.", 680, 54, M, 310, PAPER, -0.8)[0]
    body += line(
        "Self-hosted photo and video galleries for photographers and studios.",
        450, 25, M, 366, MUT, 0.2,
    )[0]
    s, w = line("SELF-HOSTED  ·  FSL-1.1-ALv2  ·  DOCKER COMPOSE", 620, 18, M, 470, ACC, 5.6)
    body += s
    body += f'<rect x="{M}" y="{482}" width="{w:.0f}" height="2" fill="{ACC}" opacity=".45"/>\n'
    body += line("github.com/markusthiel/lumio", 450, 21, M, H - 74, MUT, 0.2)[0]

    OUT_SOCIAL.mkdir(exist_ok=True)
    (OUT_SOCIAL / "github-social.svg").write_text(wrap(W, H, body))
    cairosvg.svg2png(
        url=str(OUT_SOCIAL / "github-social.svg"),
        write_to=str(OUT_SOCIAL / "github-social.png"),
        output_width=W, output_height=H,
    )
    print(f"social: {W}x{H}")


def readme_logos():
    """Lockup als PNG fuer den README-Kopf. PNG statt SVG, weil GitHubs
    Markdown-Pipeline SVGs durch einen Proxy schickt und die Groessenangabe
    dabei je nach Client unterschiedlich interpretiert wird."""
    OUT_README.mkdir(exist_ok=True)
    display_w = 260
    for name, ink in [("logo-readme.png", INK), ("logo-readme-dark.png", PAPER)]:
        svg = wrap(D["vb_w"], D["vb_h"], lockup(0, 0, D["vb_h"], ink))
        tmp = OUT_README / (name + ".svg")
        tmp.write_text(svg)
        cairosvg.svg2png(
            url=str(tmp), write_to=str(OUT_README / name),
            output_width=display_w * 2,
            output_height=round(display_w * 2 * D["vb_h"] / D["vb_w"]),
        )
        tmp.unlink()
        print(f"readme: {name} ({display_w}px Anzeigebreite)")


if __name__ == "__main__":
    social()
    readme_logos()
