"""
Lumio Worker — Imaging Helpers

Gemeinsame pyvips-Routinen für die Rendition-Pipelines (process_file,
process_video, process_raw, process_watermark).

Hintergrund: pyvips mit ``access="sequential"`` streamt das Bild durch
die Pipeline und ist daher sparsam mit RAM, kann das Quell-Image aber
nur EINMAL durchlesen. Das heißt: schon ein zweiter ``.resize()`` oder
zweiter ``.write_to_file()`` aus demselben Image-Handle wirft ::

    VipsJpeg: out of order read at line N

Die korrekte Praxis ist deshalb: für jeden Output ein FRISCHES Handle
laden. JPEG-/PNG-Decode ist günstig genug, dass das pro Rendition
keinen messbaren Aufwand bedeutet (~50 ms bei einem typischen Foto).
"""
from __future__ import annotations

from pathlib import Path
from typing import Iterable, Tuple, Callable


def _pyvips():
    """Lazy import — pyvips ist eine schwere native Abhängigkeit; in CI
    laufen logic-Tests auch ohne libvips am System."""
    import pyvips  # type: ignore
    return pyvips


def probe_dimensions(src_path: str | Path, autorotate: bool = True) -> Tuple[int, int]:
    """Liest nur die Maße aus dem Bild (keine Pixel-Operation).

    Wir öffnen mit sequential-Access und verwerfen sofort wieder — das
    bedeutet keinen Decode, libvips liest nur den JPEG/PNG-Header.
    """
    pyvips = _pyvips()
    img = pyvips.Image.new_from_file(str(src_path), access="sequential")
    if autorotate:
        img = img.autorot()
    return img.width, img.height


def render_image_sizes(
    *,
    src_path: str | Path,
    specs: Iterable[Tuple[str, int, int, str]],
    out_dir: str | Path,
    on_rendition: Callable[[str, str, int, int, str], None] | None = None,
    autorotate: bool = True,
) -> Tuple[int, int]:
    """Erzeugt Renditions aus einer Quelldatei.

    Für JEDE Rendition wird das Quell-Image NEU geladen — siehe
    Modul-Docstring. Das ist die robuste Variante; andere Workarounds
    (``access="random"`` oder ``.copy_memory()`` mit single-load) kosten
    bei großen Originalen substantiell RAM.

    :param specs: Sequenz aus ``(kind, max_edge_pixels, quality, format)``,
        wobei ``format`` einer von ``"webp"`` oder ``"jpg"`` ist. Die
        File-Extension richtet sich danach.
    :param on_rendition: Optional. Wird pro fertig geschriebener Datei
        aufgerufen mit ``(kind, out_path, width, height, format)``.
    :returns: ``(orig_width, orig_height)`` des Quell-Bilds.
    """
    pyvips = _pyvips()
    src_path = Path(src_path)
    out_dir = Path(out_dir)

    src_w, src_h = probe_dimensions(src_path, autorotate=autorotate)
    long_edge = max(src_w, src_h)

    for kind, max_edge, quality, fmt in specs:
        if fmt not in ("webp", "jpg"):
            raise ValueError(f"unsupported rendition format: {fmt!r}")
        scale = min(1.0, max_edge / long_edge) if long_edge > 0 else 1.0
        out_path = out_dir / f"{kind}.{fmt}"

        # Frisches Handle pro Rendition — sequential-Access ist single-pass.
        img = pyvips.Image.new_from_file(str(src_path), access="sequential")
        if autorotate:
            img = img.autorot()
        resized = img.resize(scale) if scale < 1.0 else img

        if fmt == "webp":
            resized.write_to_file(
                f"{out_path}[Q={quality},effort=4,strip=true]"
            )
        else:
            # JPG: Quality + Subsampling 4:2:0 ist Standard für Web-Bilder.
            # interlace=true ergibt progressive JPEGs, was beim Anzeigen
            # im Browser hübscher wirkt; für reine Datei-Downloads
            # neutral. strip=true entfernt EXIF/ICC — wir liefern hier
            # eine 2560px-Web-Version, kein Print-File.
            resized.write_to_file(
                f"{out_path}[Q={quality},interlace=true,strip=true,optimize_coding=true]"
            )

        if on_rendition is not None:
            on_rendition(kind, str(out_path), resized.width, resized.height, fmt)

    return src_w, src_h


# Backwards compat: Aufrufer, die die alte signature ohne format-Tuple
# verwenden, bekommen weiter webp ausgeliefert.
def render_webp_sizes(
    *,
    src_path: str | Path,
    specs: Iterable[Tuple[str, int, int]],
    out_dir: str | Path,
    on_rendition: Callable[[str, str, int, int], None] | None = None,
    autorotate: bool = True,
) -> Tuple[int, int]:
    """Deprecated — neue Aufrufer sollten render_image_sizes nutzen, das
    JPEG- und WebP-Renditions mischen kann."""
    spec4 = [(kind, edge, q, "webp") for kind, edge, q in specs]

    def wrapped(kind: str, path: str, w: int, h: int, _fmt: str) -> None:
        if on_rendition is not None:
            on_rendition(kind, path, w, h)

    return render_image_sizes(
        src_path=src_path, specs=spec4, out_dir=out_dir,
        on_rendition=wrapped, autorotate=autorotate,
    )


def render_print_crop(
    *,
    src_path: str | Path,
    out_path: str | Path,
    crop: dict,
    quality: int = 95,
) -> Tuple[int, int]:
    """Schneidet ``crop`` aus dem Original und schreibt ein druckfertiges
    JPEG in voller Aufloesung (#55).

    ``crop`` ist ``{x, y, width, height}`` normiert auf [0..1], bezogen
    auf das AUTOROTIERTE Bild — so hat der Kunde es im Crop-Editor
    gesehen, und so stehen die Masse auch in ``files.width/height``.
    Darum hier ebenfalls ``autorot()`` VOR dem Zuschnitt, sonst laege der
    Ausschnitt bei hochkant fotografierten Bildern an der falschen Stelle.

    Farbraum: nach sRGB, wenn ein ICC-Profil eingebettet ist. Labore
    erwarten sRGB; Fotografen liefern oft AdobeRGB, und ein unbehandeltes
    AdobeRGB-JPEG wird beim Druck flau. Ohne eingebettetes Profil bleibt
    das Bild wie es ist — dann ist sRGB die uebliche Annahme ohnehin.

    Kein Downscale: das Lab soll die maximale Aufloesung bekommen und
    selbst auf das Format rechnen. ``strip=true`` entfernt EXIF/ICC; da
    das Ergebnis sRGB ist, ist das Tag verzichtbar, und Aufnahmedaten
    haben in einer Druckdatei nichts verloren.

    :returns: ``(width, height)`` der geschriebenen Datei.
    """
    pyvips = _pyvips()
    img = pyvips.Image.new_from_file(str(src_path), access="sequential")
    img = img.autorot()

    w, h = img.width, img.height
    # In Pixel, geclampt — ein Crop knapp ueber 1.0 durch Rundung im
    # Frontend darf keinen libvips-Fehler ausloesen.
    left = max(0, min(w - 1, round(float(crop["x"]) * w)))
    top = max(0, min(h - 1, round(float(crop["y"]) * h)))
    cw = max(1, min(w - left, round(float(crop["width"]) * w)))
    ch = max(1, min(h - top, round(float(crop["height"]) * h)))

    region = img.extract_area(left, top, cw, ch)

    # sRGB nur bei eingebettetem Profil; icc_transform wirft sonst.
    if region.get_typeof("icc-profile-data") != 0:
        try:
            region = region.icc_transform("srgb", embedded=True, intent="perceptual")
        except Exception:  # noqa: BLE001 — Profil defekt: lieber ungewandelt als gar nicht
            pass
    # Alpha (PNG/TIFF mit Transparenz) auf Weiss legen — JPEG kann keins.
    if region.hasalpha():
        region = region.flatten(background=[255, 255, 255])

    region.write_to_file(
        f"{out_path}[Q={quality},strip=true,optimize_coding=true,interlace=false]"
    )
    return cw, ch
