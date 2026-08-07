"""favicon.svg mit prefers-color-scheme: die Kacheln kippen auf Papier,
sobald die Browserleiste dunkel ist. Ohne Query waeren es dort 1.16."""
INK, ACC, PAPER, CUT = "#12121A", "#FF4D2E", "#FAF8F5", (
    "M-40,-40 H150 V150 H-40 Z M-40,145.73 L150,-44.27 L150,-57 L-40,133 Z")
POS = [(0, 0), (54, 0), (0, 54), (54, 54)]

rects = "".join(
    f'      <rect x="{x}" y="{y}" width="46" height="46" rx="9" '
    f'fill="{ACC if i == 0 else "currentColor"}"/>\n'
    for i, (x, y) in enumerate(POS))

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100" role="img" aria-label="Lumio">
  <style>
    /* Die Tinte laeuft ueber currentColor, damit eine einzige Datei beide
       Browser-Themes bedient. Auf dunkler Leiste haette #12121A nur 1.16
       Kontrast und die Marke waere praktisch unsichtbar. */
    :root {{ color: {INK}; }}
    @media (prefers-color-scheme: dark) {{
      :root {{ color: {PAPER}; }}
    }}
  </style>
  <defs>
    <clipPath id="cut" clip-rule="evenodd"><path d="{CUT}"/></clipPath>
  </defs>
  <g clip-path="url(#cut)">
{rects}  </g>
</svg>
'''
open("favicon.svg", "w").write(svg)
print("favicon.svg geschrieben,", len(svg), "Bytes")
