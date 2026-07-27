#!/bin/bash
# Lumio Worker — Entrypoint
#
# Startet zwei Prozesse parallel:
#   1) Celery-Worker, der die eigentlichen Tasks ausführt
#   2) Stream-Consumer, der API-Jobs aus Redis pollt und an Celery weiterreicht
#
# Beide Prozesse teilen sich den Container. Stirbt einer, soll der Container
# stoppen (Docker startet ihn neu). Wir lösen das mit einem simplen wait + trap.
#
# Bash statt /bin/sh, weil `wait -n` bash-spezifisch ist. Auf Debian ist
# /bin/sh = dash, das die Option nicht kennt. bash ist im base-slim-Image
# vorinstalliert.

set -e

LOG_LEVEL="${LOG_LEVEL:-info}"
CONCURRENCY="${WORKER_CONCURRENCY:-4}"
# Slots der Fast-Lane (Bild-Renditions, ZIPs, Webhooks). Bewusst klein:
# die Jobs sind kurz; 2 Slots reichen, damit Uploads sichtbar fluessig
# verarbeitet werden, ohne der Heavy-Lane nennenswert CPU zu nehmen.
FAST_CONCURRENCY="${WORKER_FAST_CONCURRENCY:-2}"

PIDS=()

shutdown() {
    echo "[lumio-worker] shutting down"
    for pid in "${PIDS[@]}"; do
        kill -TERM "$pid" 2>/dev/null || true
    done
    wait
}
trap shutdown TERM INT

if [ -n "${WORKER_QUEUES:-}" ]; then
    # Explizite Queue-Liste gesetzt (Multi-Node-Setups, z.B. reine
    # Celery-Nodes ohne CLIP mit "default,heavy,io"): EIN Worker-Prozess,
    # unveraendertes Verhalten wie vor v0.53.0.
    echo "[lumio-worker] starting celery (concurrency=$CONCURRENCY, queues=$WORKER_QUEUES) and stream consumer"
    celery -A app worker \
        -l "$LOG_LEVEL" \
        -c "$CONCURRENCY" \
        -Q "$WORKER_QUEUES" &
    PIDS+=($!)
else
    # Standard (Single-Node, Self-Hosting): ZWEI Lanes, damit langlaufende
    # Video-/RAW-/ML-Jobs die kurzen Bild-Renditions nicht aushungern.
    # Vorher teilten sich alle Queues die gleichen Slots — drei Video-
    # Transcodings + Auto-Tagging konnten die komplette Kapazitaet belegen,
    # und simple Thumbnails warteten minutenlang ("Wird verarbeitet...").
    echo "[lumio-worker] starting celery fast lane (concurrency=$FAST_CONCURRENCY, queues=default,io)"
    celery -A app worker \
        -n "fast@%h" \
        -l "$LOG_LEVEL" \
        -c "$FAST_CONCURRENCY" \
        -Q "default,io" &
    PIDS+=($!)

    echo "[lumio-worker] starting celery heavy lane (concurrency=$CONCURRENCY, queues=heavy,ml)"
    celery -A app worker \
        -n "heavy@%h" \
        -l "$LOG_LEVEL" \
        -c "$CONCURRENCY" \
        -Q "heavy,ml" &
    PIDS+=($!)
fi

# Stream-Consumer im Hintergrund
python consumer.py &
PIDS+=($!)

# wait -n gibt zurueck, sobald EIN Prozess stirbt — dann alles beenden,
# damit Docker den Container sauber neu startet.
wait -n
echo "[lumio-worker] one of the processes died — exiting"
shutdown
exit 1
