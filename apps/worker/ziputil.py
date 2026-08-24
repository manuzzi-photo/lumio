"""
Lumio Worker — ZIP-Hilfen

Bisher genau ein Zweck: die ZIP64-Entscheidung pro Archiv-Eintrag.

Hintergrund. Wir schreiben Einträge gestreamt (``zf.open(zinfo, "w")``),
damit ein 4-GB-Video nicht erst komplett in den Speicher muss. Pythons
``zipfile`` entscheidet aber schon BEIM ÖFFNEN des Eintrags, ob es die
32-Bit- oder die ZIP64-Felder schreibt, und zwar anhand von
``zinfo.file_size``:

    zip64 = force_zip64 or (zinfo.file_size * 1.05 > ZIP64_LIMIT)

Bei einem frisch gebauten ``ZipInfo`` ist ``file_size`` 0 — also fällt der
Eintrag auf 32 Bit zurück. Beim Schließen zählt ``zipfile`` nach, was
tatsächlich durchgelaufen ist, und wirft ab 2 GiB (ZIP64_LIMIT = 2^31-1):

    RuntimeError: File size too large, try using force_zip64

``allowZip64=True`` auf der ``ZipFile`` hilft dagegen NICHT — das erlaubt
ZIP64 nur, es aktiviert es nicht pro Eintrag.

Der Fehler fällt erst, nachdem die Datei komplett aus S3 gezogen und in
die Tempdatei geschrieben wurde. Bei einem 3,5-GB-Video heißt das: einige
Minuten Arbeit, dann Abbruch.

Auch das Aufteilen in mehrere Teil-ZIPs rettet hier nichts: eine einzelne
Datei landet immer ganz in einem Teil, egal wie klein der Cap gesetzt ist.

Deshalb: bekannte Größe in ``zinfo.file_size`` eintragen und ab 1 GiB
(oder bei unbekannter Größe) ZIP64 erzwingen. Kleine Einträge bleiben
bewusst 32-bittig, damit reine Foto-Archive auch für betagte Entpacker
maximal kompatibel bleiben.
"""
from __future__ import annotations

import zipfile

#: Ab dieser bekannten Einzeldateigröße wird ZIP64 erzwungen. Die harte
#: Grenze liegt bei 2 GiB; 1 GiB lässt Luft, falls die in der DB
#: hinterlegte Größe leicht danebenliegt.
ZIP64_FORCE_THRESHOLD_BYTES = 1024 * 1024 * 1024


def prepare_entry(zinfo: zipfile.ZipInfo, size_bytes: int | None) -> bool:
    """Setzt die bekannte Größe am Eintrag und liefert ``force_zip64``.

    ``size_bytes`` darf ``None`` oder 0 sein (Größe unbekannt) — dann wird
    ZIP64 erzwungen, weil wir nicht wissen, was kommt.

    Rückgabe direkt an ``zf.open(zinfo, "w", force_zip64=...)`` durchreichen.
    """
    try:
        declared = int(size_bytes or 0)
    except (TypeError, ValueError):
        declared = 0
    if declared > 0:
        # zipfile überschreibt das beim Schließen mit der real geschriebenen
        # Menge; hier zählt nur, dass die Entscheidung oben stimmt.
        zinfo.file_size = declared
        return declared >= ZIP64_FORCE_THRESHOLD_BYTES
    return True
