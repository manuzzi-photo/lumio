[English](DEVELOPMENT.md) · [Deutsch](DEVELOPMENT.de.md) · **Italiano**

# Lumio — Development Guide

## Requisiti

- **Docker** + **Docker Compose v2** (funziona anche Compose v1, ma senza la CLI `docker compose`)
- **Node.js 20+** (per API + frontend senza Docker)
- **Python 3.12+** (per il worker senza Docker)
- **pnpm** o **npm** (nel setup standard usiamo npm)
- **git** e un client Forgejo/Git

## Primo setup

```bash
git clone https://github.com/markusthiel/lumio.git
cd lumio
cp .env.example .env
```

**Importante:** cambia almeno questi valori in `.env`:

- `POSTGRES_PASSWORD` — una stringa casuale lunga qualsiasi
- `S3_ACCESS_KEY`, `S3_SECRET_KEY` — credenziali MinIO
- `JWT_SECRET`, `SESSION_SECRET` — `openssl rand -base64 32`

## Completamente in Docker

```bash
docker compose up -d --build
```

Al primo avvio succede quanto segue:

1. Postgres si avvia, crea il DB, carica le estensioni
2. MinIO si avvia, crea il bucket (tramite il servizio `minio_init`)
3. L'API esegue la migrazione Prisma e si avvia sulla porta 3001
4. Il frontend si compila e si avvia sulla porta 3000
5. Caddy si aggancia a 80/443

Raggiungibili:

- Frontend: http://localhost:3000
- API health: http://localhost:3001/health
- Console MinIO: http://localhost:9001
- (via Caddy sulla porta 80, routing unificato)

Visualizza i log:

```bash
docker compose logs -f api
docker compose logs -f worker
```

Ferma:

```bash
docker compose down              # keeps volumes
docker compose down -v           # deletes everything incl. DB/storage
```

## Production deployment

Il `docker-compose.yml` di default fa partire uno stack funzionante — ma per un deployment reale dietro un dominio pubblico ci sono alcune impostazioni che, se non le configuri correttamente fin dall'inizio, creeranno sicuramente problemi al primo bring-up. Questa checklist riassume tutto quello che un self-hoster dovrebbe sapere prima del primo `docker compose up`.

### Tre topologie — quale fa per te?

**A) Lumio gestisce il TLS da sé**
- IP/VM proprio, il Caddy di Lumio si aggancia a 80+443
- Caddy recupera automaticamente i certificati Let's Encrypt
- La variante più semplice se l'host è dedicato esclusivamente a Lumio

**B) Dietro un proxy TLS esterno** (es. Caddy/Nginx/Traefik nello stesso ambiente per più servizi)
- Il proxy esterno gestisce la terminazione HTTPS
- Il Caddy di Lumio ascolta internamente su HTTP, il proxy esterno fa da passthrough
- Quello che usiamo in questo progetto

**C) Setup locale / test**
- Tutto su `localhost`, nessun hostname reale
- Il `.env.example` di default è pensato per questo caso

### Configurazione DNS

Lumio ha bisogno di **due** hostname:

1. **Dominio dell'app** (es. `galleries.example.com`) — frontend + API
2. **Sottodominio S3** (es. `s3.galleries.example.com`) — MinIO/archiviazione oggetti

Il sottodominio S3 non è opzionale. Abbiamo provato a farlo funzionare tramite un prefisso di percorso del dominio principale (`/s3/...`), ma MinIO non lo supporta — la firma V4 copre l'intero percorso, un rewrite del reverse proxy produce sempre `SignatureDoesNotMatch`. Un sottodominio separato è la via standard, anche nella documentazione ufficiale di MinIO.

Entrambi i record A puntano allo stesso IP.

### `.env` per ogni topologia

**A) Lumio gestisce il TLS da sé:**
```env
LUMIO_HOST=galleries.example.com
LUMIO_S3_HOST=s3.galleries.example.com
PUBLIC_URL=https://galleries.example.com
S3_PUBLIC_URL=https://s3.galleries.example.com
CADDY_HTTP_PORT=80
CADDY_HTTPS_PORT=443
```

Importante: NESSUN prefisso `http://` su `LUMIO_HOST`/`LUMIO_S3_HOST` — altrimenti Caddy pensa che tu voglia solo HTTP e non recupera nessun certificato.

**B) Dietro un proxy TLS esterno:**
```env
LUMIO_HOST=http://galleries.example.com
LUMIO_S3_HOST=http://s3.galleries.example.com
PUBLIC_URL=https://galleries.example.com
S3_PUBLIC_URL=https://s3.galleries.example.com
CADDY_HTTP_PORT=32080
CADDY_HTTPS_PORT=32443
FRONTEND_PORT=33030
API_PORT=33031
MINIO_API_PORT=32091
MINIO_CONSOLE_PORT=32092
```

Qui CON il prefisso `http://` — altrimenti il Caddy di Lumio prova a fare da sé Let's Encrypt per gli hostname e fallisce.

Nel proxy esterno serve poi:

```caddyfile
galleries.example.com {
    reverse_proxy <docker-host>:32080
}
s3.galleries.example.com {
    reverse_proxy <docker-host>:32080
}
```

Importante: **non sovrascrivere l'header Host** nel proxy esterno. Il comportamento di default in Caddy/Nginx è corretto, ma se qualcuno ci ha scritto `proxy_set_header Host $proxy_host` oppure `header_up Host {upstream_hostport}` di Caddy — toglilo. MinIO verifica la firma V4 tramite l'header Host della richiesta, che deve corrispondere a quello con cui l'API ha firmato l'URL (`S3_PUBLIC_URL`).

**C) Setup locale:** i default di `.env.example` vanno bene, non cambiare nulla.

### Controlla i conflitti di porta prima dell'avvio

Prima di eseguire `docker compose up`, controlla per sicurezza che le porte siano libere:

```bash
ss -tlnp | grep -E ':(32080|32443|33030|33031|32091|32092)\s'
```

Nessun output = tutto libero. Importante: i mapping `127.0.0.1:3000` (binding su loopback) **non proteggono** da conflitti con listener su `0.0.0.0:3000` — il kernel riserva la porta indipendentemente dall'indirizzo.

### Genera i secret

```bash
openssl rand -base64 32   # JWT_SECRET
openssl rand -base64 32   # SESSION_SECRET
openssl rand -base64 24   # POSTGRES_PASSWORD
openssl rand -base64 24   # S3_ACCESS_KEY (shorter looks more like a real access key)
openssl rand -base64 32   # S3_SECRET_KEY
```

Metti questi valori in `.env`.

### Bring-up

```bash
docker compose up -d --build
docker compose ps                    # all "Up" / "healthy"?
docker compose logs --tail=30 api    # "Lumio API ready" visible?
```

Se i container partono ma poi si riavviano: `docker compose logs --tail=50 <service>` mostra il perché per ciascuno.

### Crea un utente admin

```bash
docker compose exec api npm run create-admin -- \
    --email=you@example.com --password=long_password --name="Your Studio"
```

In modalità multi-tenant serve inoltre `--tenant=<slug> --tenant-name="..."`.

### Smoke test

Dopo l'avvio, clicca sistematicamente in questo ordine:

1. **Login** su `https://galleries.example.com/login` → studio
2. **Crea un branding** → carica un logo (PNG ~200 KB) → il logo compare nell'editor
3. **Crea una galleria** → collega il branding → stato su `live`
4. **Carica un'immagine di test** nel dettaglio galleria dello studio → lo stato passa da `uploading → processing → ready`, appare una thumbnail
5. **Opzionale: test video** (~30 s, MP4 H.264) → stesso flusso, il worker fa in più il transcoding HLS
6. **Copia il link di condivisione** → aprilo in una scheda in incognito → le immagini sono visibili

Se uno di questi passaggi va storto, `docker compose logs --tail=80 api worker` mostra la causa. Gli errori più comuni al primo deploy sono elencati più sotto in "Problemi comuni".

### Backup

Fai il backup almeno di questi due volume:

- `postgres_data` — metadati (utenti, gallerie, record dei file, sessioni)
- `minio_data` — tutti i file immagine/video

Esempio con `restic` per un backup giornaliero di entrambi:

```bash
docker run --rm \
    --volumes-from lumio_postgres \
    --volumes-from lumio_minio \
    -e RESTIC_REPOSITORY=... -e RESTIC_PASSWORD=... \
    restic/restic backup /var/lib/postgresql/data /data
```

(Adatta al tuo stack di backup.)

### Codifica video hardware (opzionale)

Il transcoding HLS domina il carico del worker sulle gallerie grandi. Di default Lumio usa `libx264` (CPU) — portabile, funziona ovunque senza configurazione. Se hai una GPU, puoi passare il worker alla codifica hardware e transcodificare 5–10× più velocemente a seconda della sorgente.

Si controlla tramite la variabile d'ambiente `LUMIO_HW_ENCODER` nel container worker:

| Valore | Significato |
|---|---|
| `auto` (predefinito) | Prova NVENC → QSV → VAAPI, ripiega sul software |
| `nvenc` | GPU NVIDIA (RTX/Quadro/ecc.) |
| `qsv` | Intel QuickSync |
| `vaapi` | VA-API (Intel/AMD su Linux) |
| `software` | Forza `libx264`, nessuna verifica hardware |

Con `auto` il worker proverà, al primo video, quali encoder il binario ffmpeg supporta davvero (`ffmpeg -encoders`), e metterà in cache il risultato.

**Prerequisiti lato container:**

- **VAAPI** (il più semplice — GPU Intel o GPU AMD su un host Linux):
  ```yaml
  worker:
    devices:
      - /dev/dri/renderD128:/dev/dri/renderD128
    group_add:
      - "render"   # GID of the render group on the host (cat /etc/group | grep render)
    environment:
      LUMIO_HW_ENCODER: "vaapi"
  ```
  Il pacchetto ffmpeg di Debian nell'immagine worker standard ha già VAAPI incluso.

- **NVENC** (GPU NVIDIA): NVIDIA Container Toolkit installato + avvia il worker con `--gpus all`. Il ffmpeg standard dei repo Debian **non** ha NVENC compilato — serve un'immagine con `jellyfin/ffmpeg` o un ffmpeg auto-compilato con `--enable-nvenc`.

- **QSV** (Intel): come VAAPI, più in aggiunta `intel-media-va-driver`.

Senza questi passaggi di setup funziona solo `software`; `auto` lo rileva e ripiega di conseguenza, un avviso finisce nel log del worker (`encoder.requested_unavailable`).

### Deployment dalla container registry

> **Nota:** questo percorso è interno ai maintainer (registry privata). Self-hoster e collaboratori esterni compilano le immagini dal sorgente (`docker compose up -d --build`) e non hanno bisogno di accesso alla registry.

La CI compila tre immagini container a ogni push su `main` e le pubblica sulla Forgejo container registry:

```
forgejo.thiel.tools/thiel/lumio-api:<tag>
forgejo.thiel.tools/thiel/lumio-frontend:<tag>
forgejo.thiel.tools/thiel/lumio-worker:<tag>
```

Schema dei tag:

- `:latest` e `:main` — l'ultima build riuscita di `main`
- `:v0.2.0` — i tag Git (`v*`) vengono ripresi 1:1 come tag dell'immagine
- `:<short-sha>` — ogni build riceve in aggiunta il proprio commit SHA come tag, in modo da poter fissare esattamente una versione del codice

Sull'host di produzione usi il `docker-compose.prod.yml` come override, che sostituisce i blocchi `build:` con riferimenti `image:`:

```bash
cd /opt/docker/lumio/lumio
git pull   # only to keep docker-compose.* up to date

docker compose \
    -f docker-compose.yml \
    -f docker-compose.prod.yml \
    pull

docker compose \
    -f docker-compose.yml \
    -f docker-compose.prod.yml \
    up -d
```

Selezione del tag tramite la variabile d'ambiente `LUMIO_TAG`:

```bash
LUMIO_TAG=v0.2.0 docker compose \
    -f docker-compose.yml \
    -f docker-compose.prod.yml \
    up -d
```

Se la tua registry Forgejo è privata (il default per repository non pubblici), serve un login di pull sul server:

```bash
docker login forgejo.thiel.tools
# Username: your Forgejo name
# Password: Forgejo personal access token with scope `read:package`
```

Il login viene salvato in `~/.docker/config.json` (o `/root/.docker/config.json` per il Compose eseguito come root) e basta per tutti i pull successivi.

**Setup della CI:** il workflow di push sulla registry ha bisogno di due secret in Forgejo sotto `Settings → Actions → Secrets`:

| Nome | Valore |
|---|---|
| `REGISTRY_USER` | Il tuo username Forgejo |
| `REGISTRY_TOKEN` | Personal access token con scope `write:package` |

**Pulizia della registry:** Forgejo ha regole di pulizia integrate sotto `User settings → Packages → Cleanup Rules`. Default sensati per Lumio:

- Match: `lumio-*`
- Keep the most recent: `5`
- Keep versions matching: `^(latest|main|v.*)$` (mantiene i tag di branch e release)
- Remove versions older than: `30 days`

Questo mantiene le ultime 5 build SHA più tutti i tag di release e il puntatore di branch; i tag SHA più vecchi vengono rimossi automaticamente.

### Webhook in uscita (studio → strumenti esterni)

Per ogni tenant puoi configurare endpoint HTTPS che vengono chiamati con un POST firmato su determinati eventi. Configurazione nello studio sotto `/studio/webhooks`. L'attuale whitelist degli eventi (proviene da `apps/api/src/services/webhooks.ts`):

| Evento | Quando |
|---|---|
| `gallery.created` | Creata una nuova galleria |
| `gallery.live` | Lo stato della galleria passa a `live` |
| `gallery.deleted` | Galleria eliminata definitivamente |
| `selection.finalized` | Il cliente ha finalizzato la propria selezione |
| `comment.posted` | Un commento su un file |
| `file.uploaded` / `file.failed` | riservati, al momento non vengono generati |

**Formato della richiesta:** corpo JSON
`{ "event": "<type>", "timestamp": "<iso>", "data": { ... } }`
Header:

```
Content-Type:      application/json
X-Lumio-Event:     gallery.created
X-Lumio-Timestamp: 1730000000
X-Lumio-Signature: sha256=<hex>
User-Agent:        Lumio-Webhook/1.0
```

**Firma:** HMAC-SHA256 su `<timestamp>.<body>` con il secret del webhook. Schema identico a GitHub/Stripe. Esempio di verifica lato ricevente:

**Node/Express:**

```js
const crypto = require("node:crypto");
const SECRET = process.env.LUMIO_WEBHOOK_SECRET;
app.post("/lumio-hook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const ts = req.header("X-Lumio-Timestamp");
    const sig = req.header("X-Lumio-Signature");
    const expected = "sha256=" + crypto
      .createHmac("sha256", SECRET)
      .update(`${ts}.${req.body.toString("utf-8")}`)
      .digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return res.status(401).end();
    }
    // Replay protection: check the timestamp (e.g. max 5 min old)
    const age = Math.abs(Date.now() / 1000 - Number(ts));
    if (age > 300) return res.status(401).end();

    const event = JSON.parse(req.body);
    // ... process ...
    res.status(204).end();
  });
```

**Python/Flask:**

```python
import hashlib, hmac, time
from flask import request, abort

SECRET = b"..."

@app.post("/lumio-hook")
def hook():
    ts = request.headers["X-Lumio-Timestamp"]
    sig = request.headers["X-Lumio-Signature"]
    body = request.get_data()
    expected = "sha256=" + hmac.new(
        SECRET, f"{ts}.".encode() + body, hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(sig, expected):
        abort(401)
    if abs(time.time() - int(ts)) > 300:
        abort(401)
    payload = request.get_json()
    # ... process ...
    return "", 204
```

**Comportamento dei retry:** con 2xx la consegna è completa. Con 4xx (eccetto 408/429) il worker rinuncia direttamente — il ricevente ha segnalato che la richiesta così com'è non va bene. Con 5xx, un timeout o un errore di rete, il worker ritenta con backoff esponenziale (5s, 25s, 2min, 10min, 1h, poi definitivamente morto). I riceventi quindi non devono garantire il 100% di uptime, ma la gestione dovrebbe essere idempotente — lo stesso evento può arrivare più volte se il primo tentativo era un 5xx e il retry è comunque andato a buon fine.

**Audit:** nello studio sotto `/studio/webhooks` → seleziona un webhook → "Ultime consegne" elenca gli ultimi 50 tentativi con stato HTTP e testo dell'errore. Riuscito = verde, morto = rosso, in attesa = giallo. Tramite `POST /webhooks/:id/test` (il pulsante "Test" nella UI) puoi inviare subito un evento `test.ping` per verificare la validazione del ricevente, senza dover aspettare un trigger reale.

**Ciclo di vita del secret:** alla creazione viene generato una volta sola e restituito nella risposta di creazione. Le GET successive non restituiscono più il secret. Se viene perso: elimina il webhook, creane uno nuovo.

## Ibrido: infrastruttura in Docker, app in locale

Per un hot reload veloce:

```bash
# 1. Only the infrastructure in Docker
docker compose up -d postgres redis minio minio_init

# 2. API locally
cd apps/api
npm install
npx prisma migrate deploy
npm run dev          # port 3001, watch mode

# 3. Frontend locally
cd apps/frontend
npm install
npm run dev          # port 3000, fast refresh

# 4. Worker locally (in a venv)
cd apps/worker
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
celery -A app worker -l info -c 2
```

`.env` viene letto in tutte e tre le app (dotenv). Per un setup locale adatta `DATABASE_URL` in modo che punti a `localhost:5432` invece di `postgres:5432` — per farlo, esponi la porta Postgres nel file Compose (vedi il commento in `docker-compose.yml`).

## Crea un utente admin (dev)

Nel setup di sviluppo (app in locale, nessun dominio di produzione):

```bash
# Via Docker
docker compose exec api npm run create-admin -- --email=you@example.com --password=secret --name="Your Studio"

# Locally (from source, without a build)
cd apps/api && npm run create-admin:dev -- --email=you@example.com --password=secret
```

Nel container di produzione usa invece `create-admin` (senza il suffisso `:dev`), vedi la sezione "Production deployment" più sopra.

## Migrazioni del database

Usiamo Prisma:

```bash
# Change the schema in apps/api/prisma/schema.prisma, then:
cd apps/api
npx prisma migrate dev --name description_of_the_change

# Roll out in the container:
docker compose exec api npx prisma migrate deploy
```

## Test

```bash
cd apps/api && npm test         # Vitest
cd apps/frontend && npm test    # not set up yet
cd apps/worker && pytest        # not set up yet
```

## Code style

- **TypeScript** strict mode, niente `any`
- **Python** PEP 8 + type hints, `ruff` come linter (ancora da fare)
- **Commit** secondo Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- **PR** descrivono il cosa e il perché, non il come (quello sta nel codice)

## Problemi comuni

### Generale

- **`pyvips` ha bisogno di libvips42 sul sistema.** Nell'immagine Docker c'è già; in locale `apt install libvips42` (Linux) o `brew install vips` (macOS).
- **`rawpy` ha bisogno di libraw.** Nell'immagine Docker: `libraw-bin`. In locale: `apt install libraw-dev` e reinstalla.
- **MinIO con `S3_FORCE_PATH_STYLE=true`** — AWS S3 invece vuole `false`.
- **CORS con un frontend locale senza Caddy:** l'API deve conoscere `PUBLIC_URL=http://localhost:3000` e impostare CORS di conseguenza. MinIO permette upload dal browser tramite `MINIO_API_CORS_ALLOW_ORIGIN=*` (già impostato in `docker-compose.yml`).
- **Dimenticato prisma generate:** dopo una modifica dello schema esegui `npx prisma generate`, altrimenti i tipi restano obsoleti.
- **L'upload multipart ha bisogno dell'header ETag.** S3/MinIO devono **esporre** l'header di risposta `ETag` nelle richieste `UploadPart` (CORS `ExposeHeaders`). MinIO lo fa automaticamente con `MINIO_API_CORS_ALLOW_ORIGIN=*`; con AWS S3 il CORS del bucket deve impostare esplicitamente `<ExposeHeader>ETag</ExposeHeader>`.

### Deployment

Insidie che tipicamente colpiscono al PRIMO vero deploy:

- **`ambiguous site definition: :80`** nel log di Caddy → sia `LUMIO_HOST` che `LUMIO_S3_HOST` risolvono allo stesso indirizzo. Soluzione: usa hostname reali, così Caddy fa routing basato sull'host sulla stessa porta.
- **`Bind for 0.0.0.0:3000 failed: port is already allocated`** nonostante un binding su `127.0.0.1:` → un altro servizio sull'host è già in ascolto su `0.0.0.0:3000`. Loopback e 0.0.0.0 condividono la stessa riserva di porta nel kernel. Soluzione: scegli una porta libera in `.env` (`FRONTEND_PORT=33030` o simile).
- **L'upload dal browser fallisce con "DNS error: minio"** → riguarda solo le versioni precedenti alla v0.51.0 (da allora, senza `S3_PUBLIC_URL` l'API firma automaticamente verso `http://<request-host>:9000`). Se succede comunque: `S3_PUBLIC_URL` punta all'hostname interno del container — impostalo sul sottodominio S3 pubblico (`https://s3.galleries.example.com`) o rimuovilo.
- **L'upload dal browser riceve un 403 `SignatureDoesNotMatch`** → un proxy tra il browser e MinIO modifica l'header Host. MinIO verifica V4 tramite l'Host. Soluzione: `header_up Host {host}` nel Caddy di Lumio, e nel proxy esterno passa l'header Host **invariato** (il default in Caddy, in Nginx `proxy_set_header Host $host;`).
- **Il logo del branding dello studio mostra un 404 in console** → l'API non è stata ricompilata dopo il fix di `serializeBranding`. `docker compose up -d --build api`.
- **L'API si riavvia all'infinito con `Could not parse schema engine response`** → Prisma non trova libssl nell'immagine Alpine. Non dovrebbe succedere con il `Dockerfile` di default (installiamo `openssl3` e impostiamo `binaryTargets`), ma se succede: controlla se l'immagine attuale è stata effettivamente compilata.
- **Il worker si riavvia all'infinito con `wait: Illegal option -n`** → `entrypoint.sh` gira nella shell sbagliata. Lo shebang è `#!/bin/bash`, che dovrebbe andare bene con l'immagine di default.
- **`create-admin` segnala `tsx: not found`** → l'immagine di produzione include solo `node` + JS compilato. `npm run create-admin` ora chiama `node dist/scripts/create-admin.js`; in modalità dev `npm run create-admin:dev`.
- **La galleria mostra i file con le thumbnail nello studio, ma la pagina cliente è vuota** → i file probabilmente sono a `status='failed'`. La pagina cliente nasconde i `failed`, lo studio mostra tutto. Controlla il log dell'API/worker per capire cosa è andato storto. Elimina i file e ricaricali — `failed` non riprova automaticamente.

## Pipeline di caricamento (flusso dati)

Ecco come un file scorre nel sistema durante il caricamento:

```
Browser (uploadFiles)
   │
   │ 1) POST /api/v1/uploads/init  (filenames + sizes)
   ▼
API
   │ 1a) Check gallery ownership, check the size limit
   │ 1b) Per file: file record (status=uploading) + generate a storage key
   │ 1c) Return presigned PUT URLs (single or multipart parts)
   ▼
Browser
   │ 2) PUT directly to S3/MinIO with progress
   │ 3) POST /api/v1/uploads/complete  (with the ETag list for multipart)
   ▼
API
   │ 3a) Multipart complete at S3 (if multipart)
   │ 3b) files.status = "processing"
   │ 3c) Push a job into the Redis stream "lumio:jobs:file_processing"
   ▼
Worker (stream consumer)
   │ 4) xreadgroup → receives the job
   │ 5) Celery send_task → process_file.generate_renditions
   ▼
Celery worker
   │ 6) Load S3 → /tmp/source
   │ 7) pyvips: autorotate → resize → WebP (thumb/preview/web)
   │ 8) Upload renditions to S3, create DB records
   │ 9) files.status = "ready"
   ▼
The frontend polls /api/v1/galleries/:id every 2s
   → once ready, the thumb URL is visible in the grid
```

In fase 2 sostituiremo il polling con un push WebSocket.

## Decisioni architetturali (ADR)

Le decisioni architetturali più importanti sono documentate in `docs/adr/` come brevi record. Formato:

```
# ADR-NNNN: Title

## Status
accepted / proposed / superseded

## Context
Why was the decision due?

## Decision
What was decided?

## Consequences
What does that mean positively/negatively?
```
