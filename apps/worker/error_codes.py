"""Stabile Fehler-Codes fuer Zustaende, die im Frontend sichtbar werden.

Hintergrund: Tasks schrieben bisher ``str(err)`` in Spalten wie
``zip_downloads.errorMessage``. Die API reicht diese Spalte unveraendert
weiter, und das Frontend zeigt sie an — im Fall des ZIP-Downloads sogar den
KUNDEN eines Studios, nicht nur dem Betreiber.

Das sind zwei Probleme in einem:

1. Eine rohe Exception ist nicht uebersetzbar. Sie ist auf Englisch, oft
   auf Bibliotheks-Englisch, und aendert ihren Wortlaut mit jedem
   Dependency-Update.
2. Sie plaudert. Ein botocore-Fehler nennt Bucket und Endpoint, ein OSError
   Serverpfade. Nichts davon geht Galerie-Besucher etwas an.

Deshalb: der Task schreibt einen Code, das Frontend uebersetzt ihn (Sektion
``apiError`` in den Dictionaries), und die Exception selbst geht nur ins
Log — dort steht sie vollstaendig und mit Stacktrace, wo sie hingehoert.

Neuen Code ergaenzen: hier eine Konstante anlegen, in ``classify()``
einordnen falls automatisch erkennbar, und ``apiError.<camelCase>`` in
en/de/it ergaenzen. Die i18n-Pruefung im Frontend meldet fehlende Keys.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Codes. Bewusst grob: der Nutzer soll erfahren, ob er etwas tun kann —
# nicht, welche Bibliothek intern gestolpert ist.
# ---------------------------------------------------------------------------

#: Keine Dateien zum Verpacken (leere Auswahl, alles zwischenzeitlich weg).
ZIP_NO_FILES = "zip_no_files"

#: Speicher-Backend nicht erreichbar oder lehnt ab (S3/MinIO).
STORAGE_UNAVAILABLE = "storage_unavailable"

#: Kein Platz mehr auf dem Arbeits-Volume des Workers.
WORKER_DISK_FULL = "worker_disk_full"

#: Alles andere. Details stehen im Log.
ZIP_BUILD_FAILED = "zip_build_failed"

#: Export eines einzelnen Galerie-Archivs fehlgeschlagen.
EXPORT_BUILD_FAILED = "export_build_failed"


def classify(err: BaseException, default: str) -> str:
    """Ordnet eine Exception einem Code zu.

    Absichtlich konservativ: im Zweifel ``default``. Ein zu grober Code ist
    harmlos, ein falscher fuehrt den Nutzer in die Irre.
    """
    name = type(err).__name__
    text = str(err).lower()

    if isinstance(err, ValueError) and "no files" in text:
        return ZIP_NO_FILES

    # Speicher: botocore/boto3 werfen ClientError, EndpointConnectionError
    # usw. Wir wollen den Worker nicht an boto koppeln, nur um den Typ zu
    # pruefen — der Name reicht.
    if name in {
        "ClientError",
        "EndpointConnectionError",
        "ConnectTimeoutError",
        "ReadTimeoutError",
        "NoCredentialsError",
        "S3UploadFailedError",
    }:
        return STORAGE_UNAVAILABLE

    if isinstance(err, OSError) and getattr(err, "errno", None) == 28:
        # ENOSPC
        return WORKER_DISK_FULL

    return default
