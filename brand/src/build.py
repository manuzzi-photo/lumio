# -*- coding: utf-8 -*-
"""Erzeugt alle Lumio-Logo-Assets. Wortmarke = Quicksand, in Pfade gewandelt."""
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.boundsPen import BoundsPen

INK, ACC, PAPER = "#12121A", "#FF4D2E", "#FAF8F5"
MARK_CUT = "M-40,-40 H150 V150 H-40 Z M-40,145.73 L150,-44.27 L150,-57 L-40,133 Z"

_cache = {}
def face(w):
    if w not in _cache:
        f = instantiateVariableFont(TTFont("Quicksand.ttf"), {"wght": w}, inplace=False)
        _cache[w] = (f, f.getGlyphSet(), f.getBestCmap())
    return _cache[w]

def shift(args, dx):
    out = []
    for a in args:
        if isinstance(a, tuple) and a and isinstance(a[0], (int, float)):
            out.append((a[0] + dx, a[1]))
        else:
            out.append(a)
    return tuple(out)

def typeset(text, weight, track, kern=None):
    """-> (ink_path, accent_path, visual_left, visual_right, top, bottom)"""
    f, gs, cmap = face(weight)
    kern = kern or {}
    r = lambda v: str(int(round(v)))
    ink, acc = SVGPathPen(gs, ntos=r), SVGPathPen(gs, ntos=r)
    x, prev = 0, None
    L = R = T = B = None
    for ch in text:
        if prev:
            x += kern.get((prev, ch), 0)
        g = gs[cmap[ord(ch)]]
        rec = DecomposingRecordingPen(gs); g.draw(rec)
        cs, cur = [], []
        for op, a in rec.value:
            cur.append((op, a))
            if op == "closePath":
                cs.append(cur); cur = []
        if cur: cs.append(cur)
        boxed = []
        for c in cs:
            bp = BoundsPen(gs)
            for op, a in c: getattr(bp, op)(*a)
            boxed.append((c, bp.bounds))
        tittle = None
        if ch == "i" and len(boxed) > 1:
            boxed.sort(key=lambda t: -(t[1][3] if t[1] else 0))
            tittle = boxed[0]; boxed = boxed[1:]
        for c, b in boxed + ([tittle] if tittle else []):
            pen = acc if (tittle and c is tittle[0]) else ink
            for op, a in c: getattr(pen, op)(*shift(a, x))
            if b:
                x0, y0, x1, y1 = b[0] + x, b[1], b[2] + x, b[3]
                L = x0 if L is None else min(L, x0); R = x1 if R is None else max(R, x1)
                B = y0 if B is None else min(B, y0); T = y1 if T is None else max(T, y1)
        x += g.width + track
        prev = ch
    return ink.getCommands(), acc.getCommands(), L, R, T, B

WORD = dict(text="Lumio", weight=600, track=45, kern={("L", "u"): -18})

def mark(x, y, size, ink, acc, uid):
    s = size / 100.0
    return (f'  <g transform="translate({x:.2f} {y:.2f}) scale({s:.5f})" clip-path="url(#{uid})">\n'
            f'    <rect x="0" y="0" width="46" height="46" rx="9" fill="{acc}"/>\n'
            f'    <rect x="54" y="0" width="46" height="46" rx="9" fill="{ink}"/>\n'
            f'    <rect x="0" y="54" width="46" height="46" rx="9" fill="{ink}"/>\n'
            f'    <rect x="54" y="54" width="46" height="46" rx="9" fill="{ink}"/>\n'
            f'  </g>\n')

def wrap(w, h, body, defs, title):
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '
            f'{w:.0f} {h:.0f}" width="{w:.0f}" height="{h:.0f}" role="img" '
            f'aria-label="{title}">\n{defs}{body}</svg>\n')

def clipdef(uid):
    return (f'  <defs><clipPath id="{uid}" clip-rule="evenodd">'
            f'<path d="{MARK_CUT}"/></clipPath></defs>\n')

def horizontal(name, ink, acc, uid):
    wi, wa, L, R, T, B = typeset(**WORD)
    M, G = 880, 250
    cy = (T + B) / 2.0
    top, bot = max(cy + M / 2, T), min(cy - M / 2, B)
    H, W = top - bot, M + G + (R - L)
    body = mark(0, top - (cy + M / 2), M, ink, acc, uid)
    tx, ty = M + G - L, top
    body += (f'  <g transform="translate({tx:.2f} {ty:.2f}) scale(1 -1)">\n'
             f'    <path d="{wi}" fill="{ink}"/>\n    <path d="{wa}" fill="{acc}"/>\n  </g>\n')
    open(name, "w").write(wrap(W, H, body, clipdef(uid), "Lumio"))
    return W, H

def stacked(name, desc, ink, acc, uid, dcol=None):
    wi, wa, L, R, T, B = typeset(**WORD)
    di, _, dL, dR, dT, dB = typeset(desc, 500, 340)
    ds = 0.29
    M, G1, G2 = 1000, 260, 250
    ww, dw = R - L, (dR - dL) * ds
    W = max(M, ww, dw)
    y = 0
    body = mark((W - M) / 2, y, M, ink, acc, uid)
    y += M + G1
    base = y + T
    body += (f'  <g transform="translate({(W-ww)/2 - L:.2f} {base:.2f}) scale(1 -1)">\n'
             f'    <path d="{wi}" fill="{ink}"/>\n    <path d="{wa}" fill="{acc}"/>\n  </g>\n')
    y = base - B + G2
    dbase = y + dT * ds
    body += (f'  <g transform="translate({(W-dw)/2 - dL*ds:.2f} {dbase:.2f}) '
             f'scale({ds} {-ds})">\n    <path d="{di}" fill="{dcol or acc}"/>\n  </g>\n')
    H = dbase - dB * ds
    open(name, "w").write(wrap(W, H, body, clipdef(uid), f"Lumio {desc.title()}"))
    return W, H

def wordmark_only(name, ink, acc):
    wi, wa, L, R, T, B = typeset(**WORD)
    body = (f'  <g transform="translate({-L:.2f} {T:.2f}) scale(1 -1)">\n'
            f'    <path d="{wi}" fill="{ink}"/>\n    <path d="{wa}" fill="{acc}"/>\n  </g>\n')
    open(name, "w").write(wrap(R - L, T - B, body, "", "Lumio"))

wordmark_only("lumio-wordmark.svg", INK, ACC)
wordmark_only("lumio-wordmark-inverse.svg", PAPER, ACC)
print("horizontal", horizontal("lumio-logo-horizontal.svg", INK, ACC, "cut"))
horizontal("lumio-logo-horizontal-inverse.svg", PAPER, ACC, "cut")
print("cloud     ", stacked("lumio-logo-cloud.svg", "CLOUD", INK, ACC, "cut"))
stacked("lumio-logo-cloud-inverse.svg", "CLOUD", PAPER, ACC, "cut")
print("selfhosted", stacked("lumio-logo-selfhosted.svg", "SELF-HOSTED", INK, ACC, "cut"))
stacked("lumio-logo-selfhosted-inverse.svg", "SELF-HOSTED", PAPER, ACC, "cut")

# --- Pfaddaten fuer die Inline-Komponenten exportieren ---
import json
wi, wa, L, R, T, B = typeset(**WORD)
M, G = 880, 250
cy = (T + B) / 2.0
top, bot = max(cy + M / 2, T), min(cy - M / 2, B)
json.dump({
    "cut": MARK_CUT,
    "word_ink": wi, "word_acc": wa,
    "word_dx": M + G - L, "word_base": top,
    "mark_y": top - (cy + M / 2), "mark_size": M,
    "vb_w": M + G + (R - L), "vb_h": top - bot,
    "word_only_w": R - L, "word_only_h": T - B, "word_only_dx": -L, "word_only_base": T,
}, open("paths.json", "w"))
print("paths.json geschrieben")

# Einfarbig hell: fuer Mail-Koepfe, die auf der Akzentflaeche liegen. Dort
# wuerde die orange Kachel im Untergrund verschwinden und der Marke fehlte
# eine Ecke.
horizontal("lumio-logo-mono-light.svg", PAPER, PAPER, "cut")
print("mono-light erzeugt")
