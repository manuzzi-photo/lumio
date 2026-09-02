"""
Lumio Worker — Database Access

Schlanke DB-Anbindung über psycopg + raw SQL. Kein ORM-Overkill auf
Worker-Seite — die Logik ist begrenzt: File-Status updaten, Rendition
einfügen, Job-Stream konsumieren.
"""
from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator, Any

import psycopg
from psycopg.rows import dict_row


DATABASE_URL = os.environ["DATABASE_URL"]


@contextmanager
def get_conn() -> Iterator[psycopg.Connection]:
    """Eine Connection pro Job — keep it simple. Bei steigender Last
    auf einen Connection-Pool umstellen (psycopg_pool)."""
    conn = psycopg.connect(DATABASE_URL, row_factory=dict_row)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def fetch_file(file_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        return conn.execute(
            """
            SELECT f.id, f."originalFilename" AS original_filename,
                   f."storageKey" AS storage_key, f."mimeType" AS mime_type,
                   f."sizeBytes" AS size_bytes, f.kind, f.status,
                   f.width, f.height, f."galleryId" AS gallery_id,
                   g."tenantId" AS tenant_id
            FROM files f
            JOIN galleries g ON g.id = f."galleryId"
            WHERE f.id = %s
            """,
            (file_id,),
        ).fetchone()


def mark_file_ready(
    file_id: str,
    width: int | None,
    height: int | None,
    sha256: str | None = None,
    original_md5: str | None = None,
) -> None:
    """Setzt status='ready' + finale Maße. Wenn sha256/original_md5
    mitgegeben werden, werden sie in derselben Transaktion geschrieben —
    vermeidet eine Zwischen-Zeile mit ready=true aber Hash=NULL (fuer
    sha256 wuerde das faelschlich als 'ungehashed' in die Dup-Detection
    einfliessen).

    original_md5 bekommt KEINE eigene Spalte, sondern landet unter
    exif->'lumio'->'originalMd5'. Die exif-Spalte existiert bereits
    (aktuell von nirgendwo beschrieben, nur von auto_tag.py defensiv
    gelesen) -- kein Schema-Change noetig.

    Die exif-Klausel laeuft NUR wenn original_md5 tatsaechlich gesetzt
    ist. Bei jedem anderen File (die grosse Mehrheit -- alles ausser
    ueber das Lightroom-Plugin veroeffentlichte Files) bleibt exif
    komplett unangetastet, insbesondere bleibt ein bestehendes NULL NULL
    statt bei jedem Aufruf auf {} zu wechseln.

    jsonb_set setzt gezielt nur den 'lumio'-Key innerhalb von exif (Pfad
    {lumio}), der neue Wert dafuer wird vorher separat aus dem
    BESTEHENDEN 'lumio'-Objekt gemergt (COALESCE(exif->'lumio', '{}') ||
    jsonb_build_object(...)) -- ein kuenftiges zweites Feld unter 'lumio'
    (z.B. exif.lumio.irgendwas) uebersteht einen originalMd5-Write also
    unversehrt, und umgekehrt. Der Umweg ueber den einstufigen Pfad
    {lumio} statt direkt {lumio,originalMd5} ist noetig, weil jsonb_set
    keine mehrstufig FEHLENDEN Zwischenebenen anlegen kann -- ein
    zweistufiger Pfad auf leerem exif waere ein stiller No-Op."""
    with get_conn() as conn:
        if original_md5 is not None:
            conn.execute(
                """
                UPDATE files
                SET status = 'ready', width = %s, height = %s,
                    sha256 = COALESCE(%s, sha256),
                    exif = jsonb_set(
                        COALESCE(exif, '{}'::jsonb),
                        '{lumio}',
                        COALESCE(exif->'lumio', '{}'::jsonb) || jsonb_build_object('originalMd5', %s::text),
                        true
                    ),
                    "updatedAt" = NOW()
                WHERE id = %s
                """,
                (width, height, sha256, original_md5, file_id),
            )
        else:
            conn.execute(
                """
                UPDATE files
                SET status = 'ready', width = %s, height = %s,
                    sha256 = COALESCE(%s, sha256),
                    "updatedAt" = NOW()
                WHERE id = %s
                """,
                (width, height, sha256, file_id),
            )


def reconcile_original_size(file_id: str, size_bytes: int) -> None:
    """Schreibt die TATSAECHLICHE Groesse des hochgeladenen Originals in
    files.sizeBytes zurueck.

    Hintergrund: Beim /uploads/init meldet der Client die Groesse selbst;
    dieser Wert landet ungeprueft in files.sizeBytes. Fuer Single-Part-
    Uploads pinnt die Presigned-URL zwar die Content-Length, aber bei
    Multipart-Uploads sind die Part-URLs nicht groessengebunden — ein
    Client koennte also eine kleine Groesse melden und real mehr hochladen.
    Da die Storage-/Quota-Abrechnung (computeStorageBytes) files.sizeBytes
    aufsummiert, waere das ein Weg, das Speicherlimit zu unterlaufen.

    Der Worker kennt nach dem Download die echte Groesse (os.path.getsize)
    und korrigiert den Wert hier — die einzige Quelle der Wahrheit ist das
    tatsaechlich in S3 liegende Objekt. Idempotent; ueberschreibt immer mit
    dem gemessenen Wert."""
    if size_bytes is None or size_bytes < 0:
        return
    with get_conn() as conn:
        conn.execute(
            'UPDATE files SET "sizeBytes" = %s, "updatedAt" = NOW() WHERE id = %s',
            (size_bytes, file_id),
        )


def update_file_sha256(file_id: str, sha256: str) -> None:
    """Setzt nur den sha256 (für Backfill bestehender Files)."""
    with get_conn() as conn:
        conn.execute(
            'UPDATE files SET sha256 = %s, "updatedAt" = NOW() WHERE id = %s',
            (sha256, file_id),
        )


def set_taken_at(file_id: str, taken_at) -> None:
    """Setzt den Aufnahmezeitpunkt aus EXIF. taken_at ist ein (naiver)
    datetime oder None. Bei None passiert NICHTS — wir überschreiben ein
    evtl. schon gesetztes Datum nicht mit NULL."""
    if taken_at is None:
        return
    with get_conn() as conn:
        conn.execute(
            'UPDATE files SET "takenAt" = %s, "updatedAt" = NOW() WHERE id = %s',
            (taken_at, file_id),
        )


def mark_file_failed(file_id: str, message: str) -> None:
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE files
            SET status = 'failed', "errorMessage" = %s, "updatedAt" = NOW()
            WHERE id = %s
            """,
            (message[:500], file_id),
        )


def upsert_rendition(
    file_id: str,
    kind: str,
    storage_key: str,
    fmt: str,
    width: int | None,
    height: int | None,
    size_bytes: int,
    metadata: dict | None = None,
    page: int = 0,
) -> None:
    """Insert oder Update (auf fileId+kind+page unique)."""
    import json
    meta_json = json.dumps(metadata) if metadata is not None else None
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO renditions
                (id, "fileId", kind, page, "storageKey", format, width, height,
                 "sizeBytes", metadata, "createdAt")
            VALUES
                (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, NOW())
            ON CONFLICT ("fileId", kind, page) DO UPDATE
                SET "storageKey" = EXCLUDED."storageKey",
                    format = EXCLUDED.format,
                    width = EXCLUDED.width,
                    height = EXCLUDED.height,
                    "sizeBytes" = EXCLUDED."sizeBytes",
                    metadata = EXCLUDED.metadata
            """,
            (file_id, kind, page, storage_key, fmt, width, height,
             size_bytes, meta_json),
        )


def set_page_count(file_id: str, page_count: int) -> None:
    """Setzt die Seitenzahl eines mehrseitigen Dokuments (PDF)."""
    with get_conn() as conn:
        conn.execute(
            'UPDATE files SET "pageCount" = %s, "updatedAt" = NOW() WHERE id = %s',
            (page_count, file_id),
        )
