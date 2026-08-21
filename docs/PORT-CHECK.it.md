[English](PORT-CHECK.md) · [Deutsch](PORT-CHECK.de.md) · **Italiano**

# Verifica delle porte

Chi fa self-hosting raramente esegue Lumio da solo su una macchina. Sullo stesso server di solito gira già un reverse proxy, il Postgres di un'altra app, un Redis per qualcos'altro, un resolver DNS — qualcosa che si è silenziosamente preso la porta 80, 443, 5432, 6379 o 53. Se una delle porte di Lumio è già occupata, `docker compose up -d` non fallisce con un messaggio chiaro; un container semplicemente non riesce a fare il bind, e ci si ritrova a confrontare a mano `docker compose ps`, `docker compose logs` e `ss -tlnp`.

`scripts/lumio-check-ports.sh` automatizza proprio questo confronto. Eseguilo **prima** di `docker compose up -d`, non dopo che qualcosa ha già fallito l'avvio.

```bash
./scripts/lumio-check-ports.sh
```

## Cosa controlla

Ogni porta che il `docker-compose.yml` di Lumio può fare bind sull'host:

| Variabile | Default | Protocollo | Servizio |
|---|---|---|---|
| `CADDY_HTTP_PORT` | 80 | tcp | Caddy — HTTP (redirect a HTTPS + ACME HTTP-01) |
| `CADDY_HTTPS_PORT` | 443 | tcp+udp | Caddy — HTTPS + HTTP/3 (QUIC) |
| `FRONTEND_PORT` | 3000 | tcp | Frontend Next.js (solo debug, bind su localhost) |
| `API_PORT` | 3001 | tcp | API Fastify REST+WebSocket (solo debug, bind su localhost) |
| `MINIO_API_PORT` | 9000 | tcp | MinIO — API S3 |
| `MINIO_CONSOLE_PORT` | 9001 | tcp | MinIO — Console Web |
| *(nessuna)* | 5432 | tcp | Postgres — porta fissa in `docker-compose.yml` |
| *(nessuna)* | 6379 | tcp | Redis — porta fissa in `docker-compose.yml` |
| *(nessuna)* | 53 | tcp+udp | acme-dns — DNS (solo `--profile wildcard`) |
| *(nessuna)* | 8053 | tcp | acme-dns — API interna (solo `--profile wildcard`, bind su localhost) |

Per ogni porta lo script incrocia due fonti indipendenti prima di dichiarare un conflitto:

1. **`docker ps`** — la stessa fonte su cui si basa `docker compose up` per decidere se una porta è già allocata. Questo intercetta anche i conflitti che un semplice controllo dei socket può non vedere (Docker con lo userland-proxy disabilitato, oppure `lsof` senza privilegi root).
2. **La tabella dei socket dell'host** — provata prima con `ss`, poi `lsof`, infine come ultima risorsa un connect-test su `/dev/tcp` senza dipendenze esterne, così lo script degrada in modo controllato anche su un host minimale privo di `ss`/`lsof`/`nc`.

I container di Lumio stesso (nome `lumio_*`) che occupano già la loro porta di default **non** vengono trattati come un conflitto — è semplicemente lo stack Lumio già avviato, non qualcosa attorno a cui riassegnare le porte.

## Cosa succede in caso di conflitto

- **Porte con una variabile `.env` dedicata** (le sei elencate sopra): lo script chiede interattivamente una porta alternativa e la scrive direttamente in `.env`. Invio ricontrolla la stessa porta (utile se si è appena fermato il processo in conflitto), `s` mantiene comunque il default e prosegue.
- **Porte senza variabile** (Postgres, Redis, acme-dns): sono fisse nel `docker-compose.yml` stesso. Lo script non modifica mai automaticamente un file tracciato da git: mostra invece la riga esatta da cambiare e dove trovarla.

Alla fine stampa una tabella riassuntiva e, se ha scritto qualcosa, quante variabili `.env` sono cambiate.

## Uso non interattivo

```bash
./scripts/lumio-check-ports.sh --report-only
```

Non chiede nulla e non scrive nulla — riporta solo lo stato di ogni porta. Da usare in CI o in qualsiasi contesto non interattivo. Lo script passa da solo a questo comportamento anche ogni volta che lo stdin non è un terminale e non è possibile aprire nemmeno `/dev/tty` (es. dentro un runner CI in sandbox), così un'invocazione automatizzata non resta mai in attesa di input.

```bash
./scripts/lumio-check-ports.sh --env-file /percorso/altro.env
```

Punta a un file `.env` diverso dal default nella root del repo — utile quando si gestiscono più istanze Lumio sullo stesso host da un unico checkout condiviso.

## Perché serve

- **Intercetta il conflitto prima che lo stack parta a metà**, invece che dopo — niente più confronto dell'output di `docker compose ps` per capire quale container non è partito.
- **Riassegna automaticamente** dove può farlo in sicurezza (le sei porte con variabile `.env`), invece di lasciare che si editino i file a mano.
- **Non tocca mai `docker-compose.yml` in silenzio.** I servizi a porta fissa ricevono istruzioni, non una modifica automatica — quelle righe sono configurazione condivisa e tracciata da git.
- **Non confonde il proprio stack Lumio con un conflitto.** Rilanciarlo dopo `docker compose up -d` segnala i propri container come a posto, non come conflitti attorno a cui lavorare.

Vedi anche: [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) per cosa fare quando un conflitto di porta non è stato intercettato e un container ha già fallito l'avvio.
