[English](OPERATIONS.md) · [Deutsch](OPERATIONS.de.md) · **Italiano**

# Lumio — Operations Cookbook

Attività quotidiane per gestire un'istanza Lumio in produzione. Pensato per chi fa self-hosting e ha già un setup funzionante (vedi [DEVELOPMENT.md](./DEVELOPMENT.it.md) per la prima installazione).

Tutti i comandi di questo documento presuppongono che la directory corrente sia la root del repo Lumio:

```bash
cd /opt/docker/lumio/lumio   # or wherever your clone lives
```

Se il tuo setup richiede Compose file diversi (GPU, proxy esterno, ecc.), sostituiscili di conseguenza in ogni chiamata a `docker compose`. La maggior parte degli esempi usa il set completo che hai anche nel setup di produzione:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.gpu.yml \
  <subcommand>
```

Per leggibilità, nel cookbook lo abbreviamo come `docker compose <subcommand>` — non dimenticare i flag nella pratica.

---

## Indice

1. [Deploy](#deploy)
2. [Ciclo di vita dei servizi](#ciclo-di-vita-dei-servizi)
3. [Modificare una variabile ENV e ricaricare](#modificare-una-variabile-env-e-ricaricare)
4. [Ruotare secret e password](#ruotare-secret-e-password)
5. [Visualizzare i log](#visualizzare-i-log)
6. [Accesso al database](#accesso-al-database)
7. [Redis / stream dei job](#redis--stream-dei-job)
8. [Rimettere in coda i file falliti](#rimettere-in-coda-i-file-falliti)
9. [Backfill del worker](#backfill-del-worker)
10. [Ispezione dell'archiviazione (S3 / MinIO)](#ispezione-dellarchiviazione-s3--minio)
11. [Gestione dei tenant](#gestione-dei-tenant)
12. [Diagnosi: è davvero rotto?](#diagnosi-è-davvero-rotto)
13. [Backup e ripristino](#backup-e-ripristino)
14. [Pulizia dell'archiviazione](#pulizia-dellarchiviazione)
15. [Problemi comuni](#problemi-comuni)

---

## Deploy

### Aggiornare il codice

```bash
git pull
docker compose up -d --build api frontend worker
```

`--build` è importante: senza, continua a girare la vecchia immagine, anche se hai fatto il pull. `up -d` senza `--build` fa un nuovo pull **solo se** il tag dell'immagine è cambiato (Compose non si accorge dei cambiamenti ai file).

**Fai il deploy selettivamente per servizio** se, ad esempio, hai avuto solo modifiche al frontend:

```bash
docker compose up -d --build frontend
```

Nomi dei servizi: `api`, `frontend`, `worker`, `caddy`, `postgres`, `redis`, `minio`. Questi ultimi tre quasi non vengono mai ricostruiti — usano immagini precostituite.

### Ricostruire senza cache (in caso di problemi di build)

```bash
docker compose build --no-cache worker
docker compose up -d worker
```

Aiuta con bug strani tipo "il file è nel repo ma manca nel container", normalmente non serve.

### Hard reload del frontend per gli utenti

Dopo modifiche a CSS o JS, i clienti potrebbero dover fare Ctrl+F5, perché Next.js mette in cache gli asset statici. Per modifiche critiche puoi riavviare il container del frontend, che invalida gli hash di build:

```bash
docker compose restart frontend
```

---

## Ciclo di vita dei servizi

### Avviare tutti i servizi

```bash
docker compose up -d
```

### Fermare tutto

```bash
docker compose stop
```

`stop` vs `down`: `stop` mantiene i container, `down` li rimuove (i volumi restano). Nell'uso normale usa `stop`.

### Riavvio di un singolo servizio

```bash
docker compose restart api
```

Utile ad esempio dopo una modifica a `.env` — il container rilegge l'ENV all'avvio, non serve ricostruire l'immagine.

### Stato dei container

```bash
docker compose ps
```

Mostra quali servizi sono in esecuzione, quali porte sono mappate, se qualcuno è unhealthy.

---

## Modificare una variabile ENV e ricaricare

Le modifiche a `.env` hanno effetto solo con un **riavvio del container**, non automaticamente nel processo in esecuzione. Workflow:

```bash
cd /opt/docker/lumio/lumio

# 1) Edit the ENV
nano .env

# 2) Restart the service (no --build needed, no git pull needed)
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.gpu.yml \
  restart api

# 3) Verify the new value really made it in
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.gpu.yml \
  exec api env | grep <YOUR_KEY>

# 4) Optional: follow the logs while it comes up
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.gpu.yml \
  logs -f api
```

**Quale servizio deve riavviarsi?** Le variabili ENV sono legate all'immagine del container per ogni servizio in `docker-compose.yml`; il servizio da riavviare dipende da cosa cambi:

| Variabile ENV | Riavvio |
|---|---|
| `MAX_FILE_SIZE_MIB`, `MAX_UPLOAD_HARD_CAP_MIB` | `api` |
| `BILLING_ENABLED`, `STRIPE_*` | `api` |
| `LUMIO_DOMAIN_BASE`, `PUBLIC_URL` | `api`, `frontend` |
| Configurazione dominio Caddy | `caddy` |
| `S3_*`, `MINIO_*` | `api`, `worker` |
| Tuning del worker (concorrenza ecc.) | `worker` |
| Credenziali Postgres | `api`, `worker`, `postgres` |
| In caso di dubbio | tutti: `docker compose restart` |

**Perché non `docker compose up -d`?** Funziona anche quello — ma `up` ricostruisce solo se l'immagine è cambiata. Per modifiche pure a `.env`, `restart` è più veloce (nessun controllo dell'immagine) ed è più esplicito ("volevo davvero solo ricaricare l'ENV").

**Perché non `kill -HUP`?** Le app Node non hanno un reload SIGHUP. Per Caddy funzionerebbe, ma usiamo lo stesso pattern per tutti i servizi perché è più facile da ricordare.

---

## Ruotare secret e password

> ⚠️ Qui ci sono due trappole, ognuna delle quali causa un'interruzione di servizio se "cambi semplicemente il `.env`". Leggi per intero la sezione pertinente prima di cambiare qualcosa.

### Boot guard: i secret placeholder bloccano l'avvio

L'API **rifiuta di avviarsi** se `JWT_SECRET` o `SESSION_SECRET` sono ancora i placeholder pubblicamente noti di `.env.example`:

```
[lumio:api] Refusing to start: insecure secret(s) detected: JWT_SECRET, SESSION_SECRET.
```

È voluto — questi valori sono visibili nel repo, chiunque potrebbe falsificare token con essi. Imposta valori robusti:

```
openssl rand -base64 32   # → JWT_SECRET
openssl rand -base64 32   # → SESSION_SECRET
```

### Ruotare i secret dell'app (`JWT_SECRET` / `SESSION_SECRET`)

Le sessioni e i token API sono **hashati lato DB** e NON dipendono da questi secret. Significa che una rotazione **non disconnette nessuno**, gli utenti già loggati restano dentro. Cosa invece influisce davvero `SESSION_SECRET` (è la base HMAC/di derivazione):

- **I cookie dei visitatori della galleria** sono firmati con HMAC tramite `SESSION_SECRET`. Dopo una rotazione, i visitatori attivi della galleria devono reinserire una volta la password della galleria. I link condivisi restano validi — non c'è nulla da rigenerare.
- **Le credenziali del laboratorio di stampa** sono cifrate con una chiave derivata da `SESSION_SECRET` via HKDF. Dopo una rotazione, le credenziali del laboratorio salvate in precedenza non possono più essere decifrate → vanno reinserite una volta. (Se non usi la funzione di stampa: irrilevante.)
- I token di login challenge sono di breve durata → non critici.

`JWT_SECRET` è obbligatorio ma nel codice attuale non firma nulla da cui dipendano sessioni o token esistenti → rotazione senza impatto per l'utente. Tienilo comunque robusto.

Procedura (nessuna build, nessun `git pull`):

```
# Adjust .env on the main server, then:
docker compose --profile wildcard \
  -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.ml.yml \
  up -d --force-recreate api
```

### Ruotare la password del DB (`POSTGRES_PASSWORD`) — la trappola più grande

L'immagine Postgres legge `POSTGRES_PASSWORD` **solo al primissimo init** di una directory dati vuota. Con un volume esistente la variabile viene **ignorata** al riavvio — la password reale del ruolo vive nel DB. Se cambi solo il `.env` e riavvii, l'API si connette con la nuova password a un DB che ha ancora quella vecchia → errore di autenticazione → API giù.

Quindi la password va cambiata **prima in Postgres stesso**:

```
# 1) Backup as a safety net (main server)
docker exec lumio_postgres pg_dump -U lumio lumio | gzip > ~/lumio-db-$(date +%F).sql.gz

# 2) New password WITHOUT special characters (otherwise the DATABASE_URL syntax breaks)
openssl rand -hex 24        # → referred to below as NEWPW

# 3) Change the password in Postgres (changes only the password, no data)
docker exec -it lumio_postgres psql -U lumio -d lumio
#   at the psql prompt:  \password lumio   (asks twice, no echo)  →  \q
```

Poi propaga la nuova password ovunque **venga usato il ruolo `lumio`**:

- **Server principale** `.env`: `POSTGRES_PASSWORD=NEWPW`
- **Ogni worker node** `.env.worker`:
  `DATABASE_URL=postgres://lumio:NEWPW@10.0.0.2:5432/lumio`

E ricrea:

```
# Main server
cd /opt/docker/lumio/lumio && docker compose --profile wildcard \
  -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.ml.yml up -d

# then every worker node
cd /opt/docker/lumio/lumio && docker compose \
  -f docker-compose.worker.yml --env-file .env.worker up -d
```

Postgres viene ricreato nel processo ma **non** rilancia l'init (il volume è pieno) — la password del passo 3 resta valida. Verifica: `curl -s https://<your-domain>/health` → `status: ok` significa che l'API si è connessa con la nuova password.

**Non interessati** da questa rotazione: Umami (una propria istanza Postgres con un proprio `UMAMI_DB_PASSWORD`) e acme-dns (un proprio ruolo DB).

---

## Visualizzare i log

### Log live di un servizio

```bash
docker compose logs -f worker
```

`-f` è follow (Ctrl+C per uscire). Senza `-f` un dump una tantum.

### Ultime N righe

```bash
docker compose logs --tail=200 worker
```

### Log di più servizi combinati

```bash
docker compose logs -f api worker
```

### Filtro per finestra temporale

```bash
docker compose logs --since 10m worker
docker compose logs --since 2026-05-21T15:00:00 worker
```

### Salvare i log su file

```bash
docker compose logs --tail=500 worker > /tmp/worker.log
```

### Cercare nei log JSON strutturati

I log di worker e API sono JSON (via structlog/pino). Filtra con `jq`:

```bash
docker compose logs --no-log-prefix --tail=1000 worker | \
  grep -oE '\{.*\}' | jq -r 'select(.level == "error") | .event'
```

---

## Accesso al database

### Aprire una shell psql

```bash
docker compose exec postgres psql -U lumio lumio
```

`-U lumio` è l'utente DB, il secondo `lumio` è il nome del DB. Entrambi di default. Se hai credenziali tue (`.env`), usa quelle.

### Una singola query senza shell interattiva

```bash
docker compose exec postgres psql -U lumio lumio -c \
  "SELECT id, name, status FROM tenants;"
```

### Escaping delle colonne con lettere maiuscole

Prisma genera tabelle in camelCase e richiede virgolette doppie attorno ad esse. Vanno escapate nella chiamata da shell:

```bash
docker compose exec postgres psql -U lumio lumio -c \
  "SELECT id, status, \"errorMessage\" FROM files WHERE status = 'failed';"
```

### Query utili

**Controllare lo stato di un file:**
```sql
SELECT id, "originalFilename", status, "errorMessage",
       "sizeBytes"/1024/1024 AS mb
FROM files
WHERE id = '<file-id>';
```

**File falliti nell'ultima ora:**
```sql
SELECT id, "originalFilename", "errorMessage", "updatedAt"
FROM files
WHERE status = 'failed'
  AND "updatedAt" > NOW() - INTERVAL '1 hour'
ORDER BY "updatedAt" DESC;
```

**Panoramica dell'archiviazione per tenant:**
```sql
SELECT t.slug, t.name,
       COUNT(DISTINCT g.id) AS galleries,
       COUNT(f.id) AS files,
       pg_size_pretty(SUM(f."sizeBytes")) AS storage
FROM tenants t
LEFT JOIN galleries g ON g."tenantId" = t.id
LEFT JOIN files f ON f."galleryId" = g.id AND f.status = 'ready'
GROUP BY t.id, t.slug, t.name
ORDER BY SUM(f."sizeBytes") DESC NULLS LAST;
```

**Guardare le renditions di un file** (quali esistono, quanto sono grandi):
```sql
SELECT kind, format, "sizeBytes"/1024/1024 AS mb, "storageKey"
FROM renditions
WHERE "fileId" = '<file-id>'
ORDER BY kind;
```

**Trovare il proprietario di un tenant** (es. per contatto di supporto):
```sql
SELECT t.slug, u.email, u.role
FROM tenants t
JOIN users u ON u."tenantId" = t.id
WHERE u.role = 'owner';
```

### Creare un dump

```bash
docker compose exec postgres pg_dump -U lumio lumio > /backup/lumio-$(date +%F).sql
```

### Ripristinare da un dump

```bash
cat /backup/lumio-2026-05-21.sql | \
  docker compose exec -T postgres psql -U lumio lumio
```

`-T` disabilita l'allocazione TTY, altrimenti la pipe del cat resta bloccata.

---

## Redis / stream dei job

Lumio usa Redis come coda dei job tra API e worker. Stream:

| Stream | Contenuto |
|---|---|
| `lumio:jobs:file_processing` | Elaborazione immagini (renditions) |
| `lumio:jobs:video_processing` | Video (HLS + MP4 + sprite) |
| `lumio:jobs:zip_build` | Creazione ZIP |
| `lumio:jobs:webhook_delivery` | Webhook in uscita |

Consumer group: `lumio_workers` (tutti i container worker lo condividono).

### Redis CLI

```bash
docker compose exec redis redis-cli
```

### Stato dello stream

**Quanti messaggi ci sono in totale nello stream:**
```bash
docker compose exec redis redis-cli XLEN lumio:jobs:video_processing
```

**Pending = presi in carico ma non confermati (acked)** (il worker li ha ancora in corso oppure è crashato):
```bash
docker compose exec redis redis-cli XPENDING lumio:jobs:video_processing lumio_workers
```

Formato di output: `[count, min-id, max-id, [[consumer, count], ...]]`. Se qualcosa resta lì appeso per minuti, un worker ha preso in carico un job ma non l'ha finito (il reclaim stale avviene automaticamente dopo `CLAIM_MIN_IDLE_MS` = 60s, poi un altro consumer se ne fa carico).

**Mostrare le ultime 5 voci nello stream** (per il debug):
```bash
docker compose exec redis redis-cli XREVRANGE lumio:jobs:video_processing + - COUNT 5
```

### Inserire manualmente un job nello stream

Formato: un singolo campo `payload` con un body JSON. Questo è importante — il consumer dello stream nel worker legge `fields.get("payload")` e lo fa passare per JSON.parse, **non** più campi separati.

```bash
docker compose exec redis redis-cli XADD lumio:jobs:video_processing '*' \
  payload '{"type":"process_video","fileId":"<uuid>"}'
```

Per altri tipi di job vedi `consumer.py` nel codice del worker — ad es.:
- `{"type":"process_file","fileId":"..."}` → renditions immagine
- `{"type":"process_raw","fileId":"..."}` → anteprima RAW
- `{"type":"process_watermark","fileId":"..."}` → applicazione watermark

---

## Rimettere in coda i file falliti

Se l'elaborazione di un file è fallita (`status = 'failed'`) e vuoi che venga ritentata:

```bash
# 1. Reset the status
docker compose exec postgres psql -U lumio lumio -c \
  "UPDATE files SET status='processing', \"errorMessage\"=NULL \
   WHERE id = '<file-id>';"

# 2. Push the matching job into the Redis stream
docker compose exec redis redis-cli XADD lumio:jobs:video_processing '*' \
  payload '{"type":"process_video","fileId":"<file-id>"}'

# 3. Follow the logs
docker compose logs -f worker
```

Tipo di job in base a `files.kind`:
- `image` → `lumio:jobs:file_processing`, type=`process_file`
- `heic` → `lumio:jobs:file_processing`, type=`process_file`
- `raw` → `lumio:jobs:file_processing`, type=`process_raw`
- `video` → `lumio:jobs:video_processing`, type=`process_video`

### Più file falliti in una volta

```sql
-- First check via SQL which ones they are
SELECT id, "originalFilename", kind, "errorMessage"
FROM files
WHERE status = 'failed'
  AND "galleryId" = '<gallery-id>'
ORDER BY "updatedAt" DESC;
```

Poi un loop bash:

```bash
# Restart all failed video files of a gallery
docker compose exec postgres psql -U lumio lumio -At -c \
  "SELECT id FROM files WHERE status='failed' AND kind='video' AND \"galleryId\"='<gallery-id>'" | \
while read FILE_ID; do
  echo "Re-queueing $FILE_ID"
  docker compose exec postgres psql -U lumio lumio -c \
    "UPDATE files SET status='processing', \"errorMessage\"=NULL WHERE id='$FILE_ID';" > /dev/null
  docker compose exec redis redis-cli XADD lumio:jobs:video_processing '*' \
    payload "{\"type\":\"process_video\",\"fileId\":\"$FILE_ID\"}" > /dev/null
done
```

`-At` rende l'output pulito (`A` = unaligned, `t` = tuples only).

---

## Backfill del worker

Quando il codice del worker aggiunge nuove renditions (es. `web_jpeg` o `video_mp4`), queste naturalmente non esistono per i file caricati prima dello sprint. È a questo che servono i task di backfill.

### video_mp4 (variante MP4 web per il download del cliente)

Per galleria:

```bash
docker compose exec worker celery -A app call \
  tasks.backfill_video_mp4.run_for_gallery --args='["<gallery-id>"]'
```

Globalmente con un limite (idempotente, può girare più volte):

```bash
# 5 videos to try it out
docker compose exec worker celery -A app call \
  tasks.backfill_video_mp4.run_global --args='[5]'

# Larger batch when the test is OK
docker compose exec worker celery -A app call \
  tasks.backfill_video_mp4.run_global --args='[200]'
```

Effetto: circa il 5-15% della dimensione originale in più su S3 per video. Con NVENC un video 1080p di 5 minuti viene elaborato in ~30 secondi, senza GPU in 2-5 minuti. Per backfill grandi, tieni il log del worker aperto:

```bash
docker compose logs -f worker
```

### web_jpeg (versione JPEG per il download immagini del cliente)

Per galleria:

```bash
docker compose exec worker celery -A app call \
  tasks.backfill_web_jpeg.run_for_gallery --args='["<gallery-id>"]'
```

Per tenant (tutte le gallerie del tenant):

```bash
docker compose exec worker celery -A app call \
  tasks.backfill_web_jpeg.run_for_tenant --args='["<tenant-id>"]'
```

### Monitorare l'avanzamento del backfill

```sql
-- How many files (still) have no video_mp4 rendition?
SELECT COUNT(*)
FROM files f
WHERE f.kind = 'video' AND f.status = 'ready'
  AND NOT EXISTS (
    SELECT 1 FROM renditions r
    WHERE r."fileId" = f.id AND r.kind = 'video_mp4'
  );
```

---

## Ispezione dell'archiviazione (S3 / MinIO)

### UI console di MinIO

```
http://docker5.lan:32092
```

Accedi con `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` da `.env`.

### CLI mc (client MinIO) — dall'esterno

```bash
# Set up the alias (once)
mc alias set lumio http://localhost:32091 <root-user> <root-password>

# Count bucket contents
mc ls --recursive lumio/lumio-bucket/ | wc -l

# Storage usage
mc du lumio/lumio-bucket/

# Per tenant
mc du lumio/lumio-bucket/t/<tenant-id>/
```

### Trovare la chiave di archiviazione di un file nel DB

```sql
SELECT "storageKey" FROM files WHERE id = '<file-id>';
SELECT "storageKey", kind FROM renditions WHERE "fileId" = '<file-id>';
```

Le chiavi tipicamente iniziano con `t/<tenant-id>/galleries/<gallery-id>/...`.

### Recuperare un oggetto da MinIO (per debug)

```bash
mc cp lumio/lumio-bucket/t/.../source /tmp/test.jpg
```

---

## Gestione dei tenant

### Mostrare tutti i tenant

```sql
SELECT id, slug, name, status, plan, "createdAt"
FROM tenants
ORDER BY "createdAt" DESC;
```

### Gestire un tenant tramite la UI super admin

```
https://studio.lumio-cloud.de/super/login
```

Accedi con le credenziali super admin (vedi `.env` o i tuoi appunti).

### Creare un tenant manualmente

Funziona nel super admin tramite la UI. Via CLI solo tramite l'API di Prisma — più semplice tramite la UI dello studio.

### Sospendere un tenant

```sql
UPDATE tenants SET status = 'suspended' WHERE slug = '<slug>';
```

`active` / `suspended` / `archived`. Con suspended, non entrano né i clienti né gli utenti dello studio.

### Abilitare un sottodominio personalizzato per un tenant

Tre cose devono essere corrette:

1. **Record DNS**: `mueller.lumio-cloud.de A <server-ip>` (oppure wildcard `*.lumio-cloud.de`)
2. **Blocco Caddy esterno**:
   ```caddyfile
   mueller.lumio-cloud.de {
       reverse_proxy 192.168.178.90:32080
   }
   ```
   Oppure con un blocco wildcard:
   ```caddyfile
   *.lumio-cloud.de {
       reverse_proxy 192.168.178.90:32080
   }
   ```
3. **Lato app**: `LUMIO_DOMAIN_BASE=lumio-cloud.de` deve essere impostato in `.env`. L'app estrae il sottodominio e lo mappa su `tenants.slug`.

Ricarica Caddy dopo le modifiche:

```bash
sudo systemctl reload caddy   # or docker exec caddy ...
```

### Dominio personalizzato del tenant (full custom invece di sottodominio)

Nello studio, in Impostazioni → Dominio personalizzato, inserisci un hostname (es. `gallery.studio-mueller.de`). Anche qui, in più: DNS + Caddy esterni.

---

## Diagnosi: è davvero rotto?

### Guardare dentro il container worker

```bash
# What processes are running?
docker compose exec worker ps auxf

# Specifically ffmpeg subprocesses
docker compose exec worker pgrep -af ffmpeg

# GPU utilization (if the GPU compose overlay is active)
docker compose exec worker nvidia-smi

# Temp directory (processing in progress)
docker compose exec worker ls -lh /tmp/lumio_vid_* 2>/dev/null
docker compose exec worker du -sh /tmp/lumio_vid_* 2>/dev/null
```

### Memoria / disco

```bash
# Container RAM
docker stats --no-stream

# Host disk
df -h

# Container disk (image + overlay)
docker system df
```

### Endpoint di healthcheck

L'API ha un endpoint di health:

```bash
curl -s http://localhost:33031/api/v1/health
# {"status":"ok","db":"ok","redis":"ok","storage":"ok"}
```

Se uno passa a `error`/`down` → è quello il problema.

### Testare gli import nel worker

Se i task del worker falliscono con un ModuleNotFoundError, verifica rapidamente:

```bash
docker compose exec worker python -c \
  "from encoder_profile import profile_for; print(profile_for(1080))"

docker compose exec worker env | grep PYTHONPATH
# expected: PYTHONPATH=/app
```

### Guardare l'ultima esecuzione di un task

```sql
-- Failed jobs in the last 24h
SELECT id, "originalFilename", kind, "errorMessage", "updatedAt"
FROM files
WHERE status = 'failed' AND "updatedAt" > NOW() - INTERVAL '24 hour'
ORDER BY "updatedAt" DESC;
```

`errorMessage` contiene lo `str(err)` dell'eccezione. Per i traceback completi guarda nei log del worker — dal commit `d590520` gli stack trace vengono loggati correttamente con `format_exc_info` nella pipeline structlog.

---

## Backup e ripristino

### Cosa va incluso nel backup

Tre cose:
1. **DB Postgres** — tutti i tenant, le gallerie, i file, le selezioni, ecc.
2. **Bucket S3/MinIO** — i file veri e propri
3. **File `.env`** — credenziali, secret

Cosa **non** serve includere nel backup:
- Redis (coda dei job, stato effimero)
- Immagini Docker (costruite localmente, ricostruibili in qualsiasi momento)

### Dump di Postgres (manuale)

```bash
docker compose exec postgres pg_dump -U lumio lumio \
  | gzip > /backup/lumio-db-$(date +%F).sql.gz
```

### Mirror di MinIO su archiviazione esterna

```bash
# Initial setup
mc alias set backup s3.backup-provider.example <key> <secret>

# Sync (idempotent, copies only new/changed objects)
mc mirror lumio/lumio-bucket/ backup/lumio-backup/
```

### Script di backup via cron (esempio)

```bash
#!/bin/bash
set -e
DATE=$(date +%F)
DEST=/backup/lumio
mkdir -p $DEST

cd /opt/docker/lumio/lumio
docker compose exec -T postgres pg_dump -U lumio lumio \
  | gzip > $DEST/db-$DATE.sql.gz

mc mirror lumio/lumio-bucket/ $DEST/storage/

# 14 days retention for DB dumps
find $DEST -name "db-*.sql.gz" -mtime +14 -delete
```

Crontab:
```
0 3 * * * /opt/scripts/lumio-backup.sh >> /var/log/lumio-backup.log 2>&1
```

### Ripristino (DB)

```bash
# The container must be running and the DB empty (or dropdb first)
gunzip -c /backup/lumio-db-2026-05-21.sql.gz | \
  docker compose exec -T postgres psql -U lumio lumio
```

### Ripristino (archiviazione)

```bash
mc mirror /backup/lumio/storage/ lumio/lumio-bucket/
```

---

## Pulizia dell'archiviazione

### Identificare oggetti S3 orfani

Orfano = si trova nel bucket, ma nessuna voce del DB lo referenzia. Può succedere se i file sono stati eliminati ma il job di pulizia non è stato eseguito.

Una pulizia integrata non esiste ancora (roadmap). Rilevamento manuale:

```bash
# All storage keys from the DB
docker compose exec postgres psql -U lumio lumio -At -c \
  "SELECT \"storageKey\" FROM files
   UNION SELECT \"storageKey\" FROM renditions
   UNION SELECT \"storageKey\" FROM zip_downloads
   WHERE \"storageKey\" IS NOT NULL" > /tmp/db-keys.txt

# All storage keys from MinIO
mc ls --recursive lumio/lumio-bucket/ \
  | awk '{print $NF}' > /tmp/minio-keys.txt

# Difference
comm -23 <(sort /tmp/minio-keys.txt) <(sort /tmp/db-keys.txt) > /tmp/orphans.txt
wc -l /tmp/orphans.txt
```

**Prima di eliminare:** guarda un campione e controlla che siano davvero file orfani. Fai attenzione ai caricamenti in corso — hanno brevemente un oggetto S3 senza una voce nel DB.

### Ripulire i download ZIP scaduti

```sql
SELECT COUNT(*) FROM zip_downloads
WHERE "expiresAt" < NOW();
```

```sql
DELETE FROM zip_downloads
WHERE "expiresAt" < NOW() - INTERVAL '7 day';
```

(Gli oggetti S3 restano — a meno che non vengano rimossi tramite il job di pulizia. Voce dello sprint-2.)

### Eliminare un file completamente (studio + S3)

Nello studio tramite la UI. Programmaticamente senza la UI:

```sql
-- Note the file ID
SELECT id, "storageKey" FROM files WHERE id = '<file-id>';

-- Delete the renditions (CASCADE would do this too, here explicitly)
DELETE FROM renditions WHERE "fileId" = '<file-id>';

-- Delete the file row
DELETE FROM files WHERE id = '<file-id>';
```

Poi rimuovi gli oggetti S3 manualmente (chiavi dalla query SELECT precedente).

---

## Problemi comuni

### "No module named 'encoder_profile'" nel worker

**Sintomo:** `process_video.failed` con `errorMessage = "No module named 'encoder_profile'"`.

**Causa:** l'immagine del worker non è stata ricostruita dopo un aggiornamento del codice, oppure `PYTHONPATH=/app` non è impostato.

**Soluzione:**
```bash
git pull
docker compose up -d --build worker

# Verify
docker compose exec worker env | grep PYTHONPATH
docker compose exec worker python -c "from encoder_profile import profile_for; print('ok')"
```

### "column f.tenantId does not exist" in un task di backfill

**Sintomo:** errore SQL quando viene chiamato `backfill_video_mp4.run_global`.

**Causa:** un vecchio bug, dovrebbe essere risolto dal commit `74fcb50`. Se persiste: non è l'immagine attuale.

**Soluzione:** `git pull && docker compose up -d --build worker`.

### Sottodominio del tenant non raggiungibile

**Sintomo:** `mueller.lumio-cloud.de` non si carica, il login funziona solo tramite il dominio principale dell'app.

**Causa:** manca il blocco Caddy esterno oppure manca il record DNS.

**Soluzione:** controlla entrambi, vedi la sezione [Gestione dei tenant > Abilitare un sottodominio personalizzato](#abilitare-un-sottodominio-personalizzato-per-un-tenant).

### Il web MP4 è più grande dell'originale

**Sintomo:** il download cliente "versione web" fornisce un file più grande dell'originale.

**Causa:** il video sorgente è già fortemente compresso (es. 720p a 1300 kbps), il nostro target di re-encoding di 2800 kbps in quel caso è controproducente.

**Soluzione:** dal commit `36146f8` la generazione del web MP4 viene saltata se il bitrate sorgente è ≤ target. Per i file vecchi, ripulisci manualmente (vedi [Pulizia dell'archiviazione](#pulizia-dellarchiviazione)) oppure via SQL:

```sql
DELETE FROM renditions r
USING files f
WHERE r."fileId" = f.id
  AND r.kind = 'video_mp4'
  AND r."sizeBytes" >= f."sizeBytes";
```

Più eliminare manualmente gli oggetti S3.

### I campi di input nello studio sono bianchi / illeggibili

**Sintomo:** nel tema scuro dello studio, i campi input sono bianchi con testo illeggibile.

**Causa:** prima del commit `2b20607` questo interessava alcune pagine dello studio con tag `<input>` grezzi senza `bg-`/`text-` espliciti. Dal fix in poi dovrebbe funzionare tutto.

**Soluzione:** ricostruisci il frontend con il codice attuale:
```bash
docker compose up -d --build frontend
```

### "Processing failed" — dov'è lo stack trace?

**Prima del commit `d590520`:** la pipeline structlog non includeva `format_exc_info`, quindi i traceback venivano scartati su `log.exception()` e `exc_info=True`. Nel log restava solo `"exc_info": true` senza lo stack effettivo.

**Dal commit `d590520`:** il traceback completo è nel log del worker sotto la chiave `"exception"`. Inoltre la colonna `errorMessage` in `files` contiene la forma breve.

### Il worker interrompe ogni job dopo poco tempo

**Possibile causa:** disco pieno, OOM killer attivo, oppure connessione Redis persa. Controlla:

```bash
df -h
docker stats --no-stream
dmesg | tail -50 | grep -i "oom\|kill"
docker compose logs --tail=100 redis
```

---

## Commit importanti di riferimento

Questi commit sono dietro a bug/migrazioni menzionati nel cookbook. Quando appare un sintomo, `git log --oneline | grep <key>` aiuta:

- `0d8ba99` — migrazione del dominio dell'app a studio.lumio-cloud.de
- `62921b8` — introdotta la rendition MP4 web
- `74fcb50` — `tenantId` nel backfill SQL joinato da galleries
- `d590520` — structlog format_exc_info
- `6085c58` — import top-of-module di encoder_profile + PYTHONPATH
- `88b6fe0` — procps nell'immagine del worker (pgrep/ps/watch)
- `36146f8` — web MP4 saltato quando la sorgente è già piccola
- `2b20607` — fix globale del tema scuro per i campi form
- `4a7625f` — toolbar sticky theme-aware
- `7509cc6` — fix del contrasto degli accenti
- `867edb1` — modalità selezione cliente con localStorage
- `7cbbc37` — leggibilità dei commenti nella lightbox
- `e3e50fd` — MVP dei link di caricamento (backend + studio + drop zone pubblica)
- `3fbb24d` — link di caricamento: approvazione bulk, filtro pending, contatore in header
- `16221bb` — link di caricamento per singolo file + rifiuto bulk con motivazione
- `0dd5c7b` — limite di caricamento per file configurabile per tenant + link
