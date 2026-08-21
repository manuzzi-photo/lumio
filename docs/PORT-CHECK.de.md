[English](PORT-CHECK.md) · **Deutsch** · [Italiano](PORT-CHECK.it.md)

# Port-Check

Wer selbst hostet, betreibt Lumio selten allein auf einer Maschine. Auf demselben Server läuft meist schon ein Reverse-Proxy, das Postgres einer anderen App, ein Redis für etwas anderes, ein DNS-Resolver — irgendetwas, das sich still auf 80, 443, 5432, 6379 oder 53 gesetzt hat. Ist einer von Lumios Ports schon belegt, scheitert `docker compose up -d` nicht mit einer klaren Meldung; ein Container bindet einfach nicht, und man vergleicht danach von Hand `docker compose ps`, `docker compose logs` und `ss -tlnp`.

`scripts/lumio-check-ports.sh` automatisiert genau diesen Abgleich. Führe es **vor** `docker compose up -d` aus, nicht erst nachdem etwas schon nicht gestartet ist.

```bash
./scripts/lumio-check-ports.sh
```

## Was geprüft wird

Jeder Port, den Lumios `docker-compose.yml` auf dem Host binden kann:

| Variable | Default | Protokoll | Dienst |
|---|---|---|---|
| `CADDY_HTTP_PORT` | 80 | tcp | Caddy — HTTP (Redirect zu HTTPS + ACME HTTP-01) |
| `CADDY_HTTPS_PORT` | 443 | tcp+udp | Caddy — HTTPS + HTTP/3 (QUIC) |
| `FRONTEND_PORT` | 3000 | tcp | Next.js-Frontend (nur Debug, an localhost gebunden) |
| `API_PORT` | 3001 | tcp | Fastify-REST+WebSocket-API (nur Debug, an localhost gebunden) |
| `MINIO_API_PORT` | 9000 | tcp | MinIO — S3-API |
| `MINIO_CONSOLE_PORT` | 9001 | tcp | MinIO — Web-Konsole |
| *(keine)* | 5432 | tcp | Postgres — fester Port in `docker-compose.yml` |
| *(keine)* | 6379 | tcp | Redis — fester Port in `docker-compose.yml` |
| *(keine)* | 53 | tcp+udp | acme-dns — DNS (nur `--profile wildcard`) |
| *(keine)* | 8053 | tcp | acme-dns — interne API (nur `--profile wildcard`, an localhost gebunden) |

Für jeden Port gleicht das Skript zwei unabhängige Quellen ab, bevor es einen Konflikt meldet:

1. **`docker ps`** — dieselbe Quelle, auf die sich `docker compose up` selbst verlässt, um zu entscheiden, ob ein Port schon belegt ist. Das erfasst auch Konflikte, die eine reine Socket-Prüfung übersehen kann (Docker mit deaktiviertem Userland-Proxy, oder `lsof` ohne Root).
2. **Die Socket-Tabelle des Hosts** — probiert `ss`, dann `lsof`, dann als letzten Ausweg einen abhängigkeitsfreien `/dev/tcp`-Connect-Test, damit das Skript auch auf einem minimalen Host ohne `ss`/`lsof`/`nc` sauber degradiert.

Lumios eigene Container (Name `lumio_*`), die ihren Standardport bereits belegen, gelten **nicht** als Konflikt — das ist einfach der eigene, schon laufende Lumio-Stack und nichts, worum herumreassigniert werden müsste.

## Was bei einem Konflikt passiert

- **Ports mit eigener `.env`-Variable** (die sechs oben): Das Skript fragt interaktiv nach einem alternativen Port und schreibt ihn direkt in die `.env`. Enter prüft denselben Port erneut (praktisch, wenn man den blockierenden Prozess gerade gestoppt hat), `s` behält den Default trotzdem und macht weiter.
- **Ports ohne Variable** (Postgres, Redis, acme-dns): Diese sind fest in `docker-compose.yml` verankert. Das Skript ändert nie automatisch eine Git-getrackte Datei, sondern zeigt stattdessen die genaue Zeile, die zu ändern ist.

Am Ende zeigt es eine Zusammenfassungstabelle und, falls etwas geschrieben wurde, wie viele `.env`-Variablen sich geändert haben.

## Nicht-interaktive Nutzung

```bash
./scripts/lumio-check-ports.sh --report-only
```

Fragt nichts und schreibt nichts — meldet nur den Status jedes Ports. Für CI oder jeden anderen nicht-interaktiven Kontext. Das Skript fällt außerdem von selbst in dieses Verhalten zurück, sobald stdin kein Terminal ist und sich auch `/dev/tty` nicht öffnen lässt (z. B. in einem gesandboxten CI-Runner) — ein automatisierter Aufruf hängt also nie auf eine Eingabe wartend fest.

```bash
./scripts/lumio-check-ports.sh --env-file /pfad/zu/anderer.env
```

Zeigt auf eine andere `.env`-Datei als den Repo-Root-Default — praktisch, wenn mehrere Lumio-Instanzen auf demselben Host aus einem gemeinsamen Checkout verwaltet werden.

## Warum das Ganze

- **Erkennt den Konflikt, bevor der Stack halb startet**, statt danach — kein Abgleichen der `docker compose ps`-Ausgabe mehr, um herauszufinden, welcher Container nicht hochkam.
- **Reassigniert automatisch**, wo es das sicher kann (die sechs Ports mit `.env`-Variable), statt Dateien von Hand editieren zu lassen.
- **Fasst `docker-compose.yml` nie still an.** Dienste mit festem Port bekommen Anweisungen, keinen automatischen Edit — diese Zeilen sind geteilte, Git-getrackte Konfiguration.
- **Verwechselt den eigenen Lumio-Stack nicht mit einem Konflikt.** Ein erneuter Lauf nach `docker compose up -d` meldet die eigenen Container als in Ordnung, nicht als Konflikte, um die man herumarbeiten müsste.

Siehe auch: [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) für das Vorgehen, wenn ein Port-Konflikt übersehen wurde und ein Container bereits nicht gestartet ist.
