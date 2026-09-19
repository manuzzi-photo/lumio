"""Druckfertige, zugeschnittene Datei pro Bestellzeile (#55, Stufe 2).

Ablauf:
    Order wird `paid`
    -> API enqueued render_print_item { orderId } (ein Job pro Bestellung)
    -> dieser Task iteriert die Zeilen der Bestellung mit crop != NULL,
       laedt je Zeile das Original, schneidet, schreibt JPEG nach S3 und
       den Key in print_order_items.printFileKey.

Warum EIN Job pro Bestellung statt pro Zeile: die API weiss beim Enqueue
nur die orderId, und ein Job ist beim Retry deutlich einfacher zu
verstehen als zwanzig. Innerhalb des Tasks werden Zeilen unabhaengig
behandelt — eine kaputte Datei bringt nicht die ganze Bestellung zu Fall,
sondern landet in printFileError, und das Studio bekommt fuer diese Zeile
weiter das Original plus die Crop-Werte aus der Bestellansicht.

Idempotent: Zeilen, die schon einen printFileKey haben, werden
uebersprungen. Ein erneuter Enqueue (z.B. Sweeper) ist damit harmlos.

Bewusst KEIN Downscale und volle Qualitaet: das Ergebnis ist die Datei,
die ans Lab geht oder die der Fotograf selbst druckt.
"""
from __future__ import annotations

import os
import tempfile

import structlog

from app import app
import db
import storage
from imaging import render_print_crop

log = structlog.get_logger("lumio.render_print_item")

JPEG_QUALITY = 95


def _print_key(tenant_id: str, order_id: str, item_id: str) -> str:
    return f"t/{tenant_id}/print/{order_id}/{item_id}.jpg"


@app.task(name="tasks.render_print_item.render_order", bind=True, max_retries=2)
def render_order(self, order_id: str) -> dict:
    with db.get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT i.id            AS item_id,
                   i.crop          AS crop,
                   i."printFileKey" AS existing_key,
                   f.id            AS file_id,
                   f."storageKey"  AS storage_key,
                   o."tenantId"    AS tenant_id
              FROM print_order_items i
              JOIN print_orders o ON o.id = i."printOrderId"
              JOIN files        f ON f.id = i."fileId"
             WHERE i."printOrderId" = %s
               AND i.crop IS NOT NULL
            """,
            (order_id,),
        )
        rows = cur.fetchall()

    if not rows:
        log.info("print_render.nothing_to_do", orderId=order_id)
        return {"ok": True, "rendered": 0, "skipped": 0, "failed": 0}

    rendered = skipped = failed = 0
    with tempfile.TemporaryDirectory(prefix="lumio-print-") as tmpdir:
        for row in rows:
            item_id = row["item_id"]
            if row["existing_key"]:
                skipped += 1
                continue

            crop = row["crop"]
            if not isinstance(crop, dict) or not all(k in crop for k in ("x", "y", "width", "height")):
                _mark_error(item_id, "crop_malformed")
                failed += 1
                continue

            src_path = os.path.join(tmpdir, f"{item_id}.src")
            out_path = os.path.join(tmpdir, f"{item_id}.jpg")
            try:
                storage.download_to_file(row["storage_key"], src_path)
                w, h = render_print_crop(
                    src_path=src_path, out_path=out_path, crop=crop, quality=JPEG_QUALITY
                )
                key = _print_key(row["tenant_id"], order_id, item_id)
                storage.upload_file(out_path, key, content_type="image/jpeg")
                with db.get_conn() as conn, conn.cursor() as cur:
                    cur.execute(
                        'UPDATE print_order_items SET "printFileKey" = %s, "printFileError" = NULL WHERE id = %s',
                        (key, item_id),
                    )
                    conn.commit()
                rendered += 1
                log.info("print_render.ok", orderId=order_id, itemId=item_id, width=w, height=h)
            except Exception as err:  # noqa: BLE001 — pro Zeile isolieren, siehe Modul-Docstring
                log.warning("print_render.failed", orderId=order_id, itemId=item_id, err=str(err))
                _mark_error(item_id, str(err)[:500])
                failed += 1
            finally:
                for p in (src_path, out_path):
                    try:
                        os.remove(p)
                    except OSError:
                        pass

    result = {"ok": failed == 0, "rendered": rendered, "skipped": skipped, "failed": failed}
    log.info("print_render.done", orderId=order_id, **result)
    return result


def _mark_error(item_id: str, message: str) -> None:
    try:
        with db.get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                'UPDATE print_order_items SET "printFileError" = %s WHERE id = %s',
                (message, item_id),
            )
            conn.commit()
    except Exception as err:  # noqa: BLE001
        log.warning("print_render.mark_error_failed", itemId=item_id, err=str(err))
