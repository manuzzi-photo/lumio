# -*- coding: utf-8 -*-
"""OG-Bilder (1200x630) in der neuen Markenwelt."""
import json
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.boundsPen import BoundsPen

import pathlib
# Schriften liegen unter brand/fonts/ und werden mit ausgeliefert (SIL OFL,
# Lizenztexte daneben). Pfad relativ zum Skript, damit der Aufruf nicht vom
# Arbeitsverzeichnis abhaengt.
FONTS = pathlib.Path(__file__).resolve().parent.parent / "fonts"


INK, ACC, PAPER = "#12121A", "#FF4D2E", "#FAF8F5"
MUT = "#8B857D"
D = json.load(open("paths.json"))

_c = {}
def inter(w, opsz=32):
    k = (w, opsz)
    if k not in _c:
        f = instantiateVariableFont(TTFont(FONTS / "Inter.ttf"), {"wght": w, "opsz": opsz}, inplace=False)
        _c[k] = (f, f.getGlyphSet(), f.getBestCmap(), f["head"].unitsPerEm)
    return _c[k]

def text_path(s, weight, size, track=0):
    """-> (pathdata, breite) in Zielpixeln, Baseline bei y=0, y nach unten."""
    f, gs, cmap, upem = inter(weight)
    sc = size / upem
    r = lambda v: f"{v:.1f}"
    pen = SVGPathPen(gs, ntos=r)
    x = 0.0
    for ch in s:
        gn = cmap.get(ord(ch))
        if gn is None:
            x += 0.35 * upem; continue
        g = gs[gn]
        rec = DecomposingRecordingPen(gs); g.draw(rec)
        for op, args in rec.value:
            args = tuple(((a[0] + x, a[1]) if isinstance(a, tuple) and a and isinstance(a[0], (int, float)) else a)
                         for a in args)
            getattr(pen, op)(*args)
        x += g.width + track / sc
    return pen.getCommands(), x * sc, sc

def line(s, weight, size, xpos, ybase, fill, track=0, anchor="start"):
    d, w, sc = text_path(s, weight, size, track)
    dx = xpos - (w if anchor == "end" else 0)
    return (f'<g transform="translate({dx:.1f} {ybase:.1f}) scale({sc:.6f} {-sc:.6f})">'
            f'<path d="{d}" fill="{fill}"/></g>\n'), w

def lockup(x, y, h, ink=PAPER):
    s = h / D["vb_h"]
    return (f'<g transform="translate({x:.1f} {y:.1f}) scale({s:.6f})">'
            f'<g transform="translate(0 {D["mark_y"]:.1f}) scale({D["mark_size"]/100:.5f})" '
            f'clip-path="url(#ogcut)">'
            f'<rect x="0" y="0" width="46" height="46" rx="9" fill="{ACC}"/>'
            f'<rect x="54" y="0" width="46" height="46" rx="9" fill="{ink}"/>'
            f'<rect x="0" y="54" width="46" height="46" rx="9" fill="{ink}"/>'
            f'<rect x="54" y="54" width="46" height="46" rx="9" fill="{ink}"/></g>'
            f'<g transform="translate({D["word_dx"]:.1f} {D["word_base"]:.1f}) scale(1 -1)">'
            f'<path d="{D["word_ink"]}" fill="{ink}"/>'
            f'<path d="{D["word_acc"]}" fill="{ACC}"/></g></g>\n')

def og(name, headline, descriptor, footer):
    W, H, M = 1200, 630, 88
    body = f'<rect width="{W}" height="{H}" fill="{INK}"/>\n'
    # Akzentkante links
    body += f'<rect x="0" y="0" width="10" height="{H}" fill="{ACC}"/>\n'
    body += lockup(M, 74, 46)
    y = 250
    for i, ln in enumerate(headline):
        s, _ = line(ln, 680, 74, M, y, PAPER, track=-1.2)
        body += s
        y += 88
    y += 14
    s, w = line(descriptor, 620, 20, M, y, ACC, track=6.4)
    body += s
    body += f'<rect x="{M}" y="{y+16:.0f}" width="{w:.0f}" height="2" fill="{ACC}" opacity=".45"/>\n'
    body += line(footer, 450, 22, M, H - 62, MUT, track=.4)[0]
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">\n'
           f'<defs><clipPath id="ogcut" clip-rule="evenodd"><path d="{D["cut"]}"/></clipPath></defs>\n'
           f'{body}</svg>\n')
    open(name, "w").write(svg)
    return name

og("og-cloud-de.svg", ["Foto-Galerien", "für Profis."], "CLOUD",
   "DSGVO-konform · Server in Deutschland · ab 19 €/Monat")
og("og-app-de.svg", ["Deine Galerien.", "Dein Server."], "SELF-HOSTED",
   "Open Source · Docker Compose · FSL-1.1-ALv2")
og("og-com.svg", ["Photo galleries", "for professionals."], "CLOUD  ·  SELF-HOSTED",
   "Hosted in Germany, or run it entirely yourself.")
print("ok")
