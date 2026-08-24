"""
Smoke-Tests für tasks.build_zip.

Wir testen das, was sich ohne lebenden S3/DB testen lässt:
- _dedupe_name verhindert Namens-Kollisionen
- Eine ZIP-Datei mit dem Worker-Pattern (ZipFile auf Disk-Datei,
  ZIP_STORED, allowZip64) lässt sich tatsächlich wieder entpacken
  und enthält die richtigen Daten. Das ist die Regression, gegen
  die der frühere Buffer-Truncate-Bug schützt.

Echte S3-Round-Trips laufen über die integration/-Tests (mit
LUMIO_TEST_S3_ENDPOINT in conftest gated).
"""
from __future__ import annotations

import os
import sys
import tempfile
import zipfile

# damit `from tasks...` aufgeht
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("DATABASE_URL", "postgres://test:test@localhost/test")

from tasks.build_zip import _dedupe_name  # noqa: E402
from ziputil import (  # noqa: E402
    ZIP64_FORCE_THRESHOLD_BYTES,
    prepare_entry,
)


def test_dedupe_first_occurrence_returns_name() -> None:
    seen: set[str] = set()
    assert _dedupe_name("IMG_0001.JPG", seen) == "IMG_0001.JPG"
    assert "IMG_0001.JPG" in seen


def test_dedupe_second_occurrence_gets_suffix() -> None:
    seen: set[str] = {"IMG_0001.JPG"}
    assert _dedupe_name("IMG_0001.JPG", seen) == "IMG_0001_2.JPG"


def test_dedupe_third_occurrence_continues_counter() -> None:
    seen: set[str] = {"IMG_0001.JPG", "IMG_0001_2.JPG"}
    assert _dedupe_name("IMG_0001.JPG", seen) == "IMG_0001_3.JPG"


def test_dedupe_handles_no_extension() -> None:
    seen: set[str] = {"README"}
    assert _dedupe_name("README", seen) == "README_2"


def test_zip_disk_pattern_produces_readable_archive() -> None:
    """
    Regression: der frühere Worker-Code hat während des Schreibens den
    BytesIO-Buffer truncate'd, was das Central Directory mit falschen
    Offsets hinterließ. Resultat: Namen lesbar, aber 'Bad magic number
    for file header' beim entry-read. Dieser Test stellt sicher, dass
    das aktuelle Pattern (Disk-backed Tempfile) ein vollständiges,
    entpackbares ZIP produziert.
    """
    tmp = tempfile.NamedTemporaryFile(
        prefix="lumio-zip-test-", suffix=".zip", delete=False
    )
    tmp_path = tmp.name
    try:
        with zipfile.ZipFile(
            tmp, mode="w",
            compression=zipfile.ZIP_STORED,
            allowZip64=True,
        ) as zf:
            for i in range(3):
                zinfo = zipfile.ZipInfo(filename=f"img_{i}.jpg")
                zinfo.compress_type = zipfile.ZIP_STORED
                with zf.open(zinfo, "w") as zentry:
                    # 5 KB Inhalt pro File — größer als ein einzelner
                    # write() call, weniger als der Multipart-Threshold
                    for _ in range(5):
                        zentry.write(b"x" * 1024)
        tmp.close()

        # Lesbar?
        with zipfile.ZipFile(tmp_path) as zf:
            names = zf.namelist()
            assert names == ["img_0.jpg", "img_1.jpg", "img_2.jpg"]
            for n in names:
                data = zf.read(n)  # würde bei kaputtem CD throw'en
                assert len(data) == 5 * 1024
                assert data == b"x" * 5120
    finally:
        os.unlink(tmp_path)


def test_prepare_entry_small_file_stays_32bit() -> None:
    zinfo = zipfile.ZipInfo(filename="IMG_0001.JPG")
    assert prepare_entry(zinfo, 4 * 1024 * 1024) is False
    assert zinfo.file_size == 4 * 1024 * 1024


def test_prepare_entry_large_file_forces_zip64() -> None:
    zinfo = zipfile.ZipInfo(filename="clip.mp4")
    size = 3 * 1024 * 1024 * 1024
    assert prepare_entry(zinfo, size) is True
    assert zinfo.file_size == size


def test_prepare_entry_at_threshold_forces_zip64() -> None:
    zinfo = zipfile.ZipInfo(filename="clip.mp4")
    assert prepare_entry(zinfo, ZIP64_FORCE_THRESHOLD_BYTES) is True


def test_prepare_entry_unknown_size_forces_zip64() -> None:
    for value in (None, 0, "", "kaputt"):
        zinfo = zipfile.ZipInfo(filename="clip.mp4")
        assert prepare_entry(zinfo, value) is True, value


def test_streamed_entry_over_limit_needs_zip64() -> None:
    """
    Regression fuer den Galerie-Download mit grossen Videos.

    Ein gestreamter Eintrag (`zf.open(zinfo, "w")`) ohne gesetzte Groesse
    wird von zipfile als 32-Bit-Eintrag angelegt und knallt beim Schliessen,
    sobald mehr als ZIP64_LIMIT Bytes durchgelaufen sind. Wir ziehen das
    Limit hier auf 1000 Bytes runter, damit der Test in Millisekunden
    laeuft statt in Gigabytes.
    """
    original_limit = zipfile.ZIP64_LIMIT
    zipfile.ZIP64_LIMIT = 1000
    try:
        def build(force: bool) -> bytes:
            import io
            buf = io.BytesIO()
            with zipfile.ZipFile(
                buf, mode="w",
                compression=zipfile.ZIP_STORED,
                allowZip64=True,
            ) as zf:
                zinfo = zipfile.ZipInfo(filename="clip.mp4")
                zinfo.compress_type = zipfile.ZIP_STORED
                with zf.open(zinfo, "w", force_zip64=force) as zentry:
                    for _ in range(3):
                        zentry.write(b"x" * 500)
            return buf.getvalue()

        # Alt: ohne force_zip64 -> genau der Fehler aus dem Bugreport
        raised = False
        try:
            build(False)
        except RuntimeError:
            raised = True
        assert raised, "erwarteter RuntimeError blieb aus"

        # Neu: mit force_zip64 -> lesbares Archiv
        data = build(True)
        zipfile.ZIP64_LIMIT = original_limit
        import io
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            assert zf.namelist() == ["clip.mp4"]
            assert zf.read("clip.mp4") == b"x" * 1500
    finally:
        zipfile.ZIP64_LIMIT = original_limit


if __name__ == "__main__":
    tests = [
        test_dedupe_first_occurrence_returns_name,
        test_dedupe_second_occurrence_gets_suffix,
        test_dedupe_third_occurrence_continues_counter,
        test_dedupe_handles_no_extension,
        test_zip_disk_pattern_produces_readable_archive,
        test_prepare_entry_small_file_stays_32bit,
        test_prepare_entry_large_file_forces_zip64,
        test_prepare_entry_at_threshold_forces_zip64,
        test_prepare_entry_unknown_size_forces_zip64,
        test_streamed_entry_over_limit_needs_zip64,
    ]
    failures = 0
    for t in tests:
        try:
            t()
            print(f"ok  {t.__name__}")
        except AssertionError as e:
            print(f"FAIL {t.__name__}: {e}")
            failures += 1
    sys.exit(1 if failures else 0)
