[English](SCALING.md) · [Deutsch](SCALING.de.md) · **Italiano**

# Scalabilità orizzontale — nodi worker aggiuntivi

Lumio elabora immagini, RAW, video ed export ZIP in **worker Celery** che estraggono i job da una coda Redis centrale. Se la potenza di calcolo di un server non basta più (shooting di grandi dimensioni, molti video in parallelo), puoi collegare **server aggiuntivi** che eseguono solo worker. Celery distribuisce i job automaticamente su tutti i worker connessi — nessun load balancer, nessuna assegnazione manuale dei job.

> **Self-hoster con un solo nodo?** Questo capitolo è **irrilevante** per te. Lascia tutto com'è — le variabili descritte qui (`REDIS_PASSWORD`, `REDIS_BIND_IP`, `POSTGRES_BIND_IP`) sono opzionali e vengono fornite nello stato "solo locale, nessuna password". Un singolo server non ha bisogno di nulla di tutto ciò. Non cambiare nulla su Redis/Postgres se gestisci un solo server.

---

## Concetto: cosa scala, cosa resta centrale

```
        Rete privata (es. Hetzner Private Network, gratuita)
        ┌──────────────────────────┬──────────────────────────────┐
        │                          │                              │
  ┌─────┴───────────────┐    ┌─────┴────────────────┐
  │  Server principale  │    │  Nodo/i worker       │
  │  10.0.0.2           │    │  10.0.0.3, .4, …     │
  │                     │    │                      │
  │  API, frontend      │    │  Worker × N          │
  │  Caddy, acme-dns    │    │  (solo Celery)       │
  │  Postgres ◄─────────┼────┤  legge/scrive il DB  │
  │  Redis (coda) ◄─────┼────┤  estrae i job        │
  │  Worker (anche qui) │    │                      │
  └─────────────────────┘    └──────────────────────┘
            │                          │
            └───────────┬──────────────┘
                        ▼
          S3 / object storage (esterno, raggiungibile da tutti)
```

**Centrale (esattamente una volta, sul server principale):**
- **Postgres** — l'unica fonte di verità per tutti i metadati
- **Redis** — la coda dei job (broker Celery) e cache
- **API, frontend, Caddy** — livello web, migrazioni del database

**Distribuibile (un numero qualsiasi di nodi):**
- **Worker** — non mantengono uno stato proprio. Prendono un job da Redis, lo elaborano (immagine/RAW/video/ZIP), scrivono il risultato su S3, fine.

**Esterno (raggiungibile da qualsiasi luogo):**
- **S3 / object storage** — es. Hetzner Object Storage. Già esterno, quindi raggiungibile da ogni nodo senza configurazione aggiuntiva.

I nodi worker non eseguono **alcuna** migrazione del database e non hanno bisogno di **alcuna** porta aperta verso l'esterno. Sono puri consumatori.

---

## Requisiti

- Due (o più) server in una **rete privata condivisa**. Su Hetzner Cloud: un "Network", entrambi i server nella **stessa regione** (es. Falkenstein/fsn1), gratuito.
- Il server principale è già in esecuzione (vedi [SELFHOSTING.md](SELFHOSTING.it.md)).
- Storage esterno compatibile S3 (non MinIO-in-Docker, perché sarebbe presente solo sul server principale). Vedi [STORAGE.md](STORAGE.it.md).

> **Perché S3 esterno è obbligatorio:** un nodo worker deve poter leggere i file originali e riscrivere le rendition. Se lo storage gira come container MinIO solo sul server principale, anche quello dovrebbe essere esposto sulla rete privata. Un object storage esterno (Hetzner/S3/R2/B2/Wasabi), comunque raggiungibile da tutti i nodi, è più pulito e più robusto.

---

## Passaggio 1 — Rete privata

**Hetzner Cloud Console → Networks → Create Network:**
- Name: `lumio-net`
- IP range: `10.0.0.0/16`

Aggiungi entrambi i server alla rete (Server → Networking → Attach). Ottengono IP privati, in questa guida:
- Server principale: `10.0.0.2`
- Nodo worker: `10.0.0.3`

Verifica su **entrambi** i server che l'interfaccia privata sia presente:

```bash
ip addr | grep 10.0.0
```

Se non mostra nulla, il server non ha ancora ottenuto l'IP privato — di solito un `reboot` dopo l'attach risolve.

---

## Passaggio 2 — Mettere in sicurezza + esporre Redis (server principale)

Sulla rete privata Redis è raggiungibile solo tra i tuoi server, ma impostiamo comunque una password (defense in depth) e lo bindiamo **esclusivamente** all'IP privato — mai a `0.0.0.0`.

```bash
cd /opt/docker/lumio/lumio
git pull

# Generate a password — keep it safe, the worker node needs it
REDIS_PW=$(openssl rand -hex 24)
echo "Redis password: $REDIS_PW"

# Add to .env
echo "REDIS_PASSWORD=$REDIS_PW"  >> .env
echo "REDIS_BIND_IP=10.0.0.2"    >> .env
echo "POSTGRES_BIND_IP=10.0.0.2" >> .env

# Switch the REDIS_URL of all local services to the password
sed -i 's|^REDIS_URL=.*|REDIS_URL=redis://:'"$REDIS_PW"'@redis:6379|' .env
```

Come funziona: il container Redis aggiunge `--requirepass` solo se `REDIS_PASSWORD` è impostata (espansione sh nel `command`). `REDIS_BIND_IP`/`POSTGRES_BIND_IP` controllano il mapping della porta host — il default è `127.0.0.1` (solo locale), qui lo impostiamo sull'IP privato.

---

## Passaggio 3 — Riavviare lo stack (server principale)

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.ml.yml \
  up -d
```

Una breve interruzione (secondi) mentre Redis + i servizi si riavviano con il nuovo URL.

---

## Passaggio 4 — Verificare (server principale)

```bash
# Redis now requires auth
docker exec lumio_redis redis-cli ping
# → (error) NOAUTH Authentication required.     ✓

docker exec lumio_redis redis-cli -a "$REDIS_PW" ping
# → PONG                                         ✓

# Redis + Postgres listen ONLY on the private IP
ss -tlnp | grep -E '10.0.0.2:(6379|5432)'
# → both listed                                  ✓

# ... and NOT publicly
ss -tlnp | grep -E '0.0.0.0:(6379|5432)'
# → empty                                        ✓
```

---

## Passaggio 5 — Configurare il nodo worker (10.0.0.3)

### 5a. Installare Docker

```bash
curl -fsSL https://get.docker.com | sh
docker compose version
```

### 5b. Testare la connettività (prima di tutto!)

```bash
nc -zv 10.0.0.2 6379    # Redis
nc -zv 10.0.0.2 5432    # Postgres
```

Entrambi "open/succeeded" → continua. Altrimenti controlla la rete privata (`ip addr | grep 10.0.0`).

### 5c. Clonare il repo

```bash
mkdir -p /opt/docker/lumio && cd /opt/docker/lumio
git clone https://github.com/markusthiel/lumio.git lumio
cd lumio
```

### 5d. Creare `.env.worker`

```bash
cp .env.worker.example .env.worker
nano .env.worker
```

I valori: user/nome/password del DB e credenziali S3 **1:1 dal server principale** (esegui lì `grep -E "^POSTGRES_|^REDIS_PASSWORD|^S3_" /opt/docker/lumio/lumio/.env`), host sull'**IP privato** del server principale:

```
DATABASE_URL=postgres://lumio:<DB_PASSWORD>@10.0.0.2:5432/lumio
REDIS_URL=redis://:<REDIS_PASSWORD>@10.0.0.2:6379
STORAGE_PROVIDER=s3
S3_ENDPOINT=https://fsn1.your-objectstorage.com
S3_REGION=fsn1
S3_BUCKET=lumio-prod
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_FORCE_PATH_STYLE=true
WORKER_CONCURRENCY=10
LOG_LEVEL=info
```

### 5e. Avviare il worker

```bash
docker compose -f docker-compose.worker.yml --env-file .env.worker up -d --build
```

### 5f. Verificare

```bash
docker compose -f docker-compose.worker.yml --env-file .env.worker logs -f
```

Indicatori di successo nel log:
- `Connected to redis://:**@10.0.0.2:6379//` — la connessione al broker è attiva
- `mingle: sync with 1 nodes` / `mingle: sync complete` — il nuovo worker ha trovato gli altri worker (cluster formato)
- `celery@… ready.` — accetta job

Non appena arriva un job, vedrai `Task … received` / `… succeeded`.

---

## Tuning

**Job paralleli per nodo** = `WORKER_CONCURRENCY` × `replicas`.

- `WORKER_CONCURRENCY` (in `.env.worker`): regola pratica ≈ numero di core CPU. Server a 12 vCPU → 10–12.
- `replicas` (in `docker-compose.worker.yml`): più processi worker per nodo. Di solito 1 con concurrency alta basta.

**Carico CPU per tipo di job:**
- Il **transcoding video** (libx264 senza GPU) è il maggior divoratore di CPU — qui l'hardware aggiuntivo aiuta di più.
- **Immagine/RAW** (libvips/LibRaw) è relativamente leggero — un nodo copre parecchio.

Più nodi: ripeti il passaggio 5 su altri server (10.0.0.4, .5, …). Nulla da cambiare sul server principale — i nuovi worker si registrano automaticamente via `mingle`.

**Code:** Celery usa `default`, `heavy` (video/job grandi), `io` e `ml` (auto-tagging/CLIP). Quali code serve un worker è controllato dalla variabile d'ambiente `WORKER_QUEUES` (default `default,heavy,io,ml`). Se vuoi riservare un nodo solo al video, puoi limitarlo a `WORKER_QUEUES=heavy` — estendi secondo necessità.

**Importante — CLIP/auto-tagging:** il tagger CLIP gira solo nei worker con l'immagine ML (`docker-compose.ml.yml`, di solito il server principale). I nodi Celery puri senza CLIP **non** devono quindi estrarre dalla coda `ml` — altrimenti le immagini elaborate lì riceverebbero solo i tag rule-based (formato/luminosità), ma nessun tag CLIP di contenuto. `docker-compose.worker.yml` imposta perciò `WORKER_QUEUES=default,heavy,io` (senza `ml`); i task di auto-tagging finiscono così esclusivamente sul server principale abilitato a CLIP. Se il tuo server principale non ha l'immagine ML, l'auto-tagging gira comunque (il default estrae `ml`), ma allora fornisce solo tag rule-based.

---

## Aggiornamenti sul nodo worker

```bash
cd /opt/docker/lumio/lumio
git pull
docker compose -f docker-compose.worker.yml --env-file .env.worker up -d --build
```

Importante: aggiorna i nodi worker dopo il server principale (prima le migrazioni sul server principale via API, poi i worker), così lo schema del DB corrisponde.

### Quale modifica richiede quale server?

| Modificato | Server principale | Nodo/i worker |
|---|---|---|
| `apps/frontend` (UI studio/cliente) | ✅ `up -d --build frontend` | — |
| `apps/api` (backend, endpoint) | ✅ `up -d --build api` | — |
| `apps/worker` (elaborazione immagini/video/RAW/ZIP) | ✅ `up -d --build worker` | ✅ `up -d --build` |
| File Compose/infra | a seconda del servizio interessato | solo se rilevante per il worker |
| Documentazione, siti marketing | — (o il proprio deploy marketing) | — |

Regola pratica: il frontend e l'API girano **solo** sul server principale. Solo le modifiche ad `apps/worker` (la logica di conversione) devono essere distribuite anche su ogni nodo worker. Il deploy standard del server principale resta:

```bash
cd /opt/docker/lumio/lumio && git pull && docker compose \
  -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.ml.yml \
  up -d --build
```

---

## Sicurezza — riepilogo

- Redis + Postgres si bindano **solo** all'IP privato (`10.0.0.2`), mai a `0.0.0.0`. Dall'esterno (l'IP pubblico) le porte sono chiuse.
- Redis è inoltre protetto da password.
- I nodi worker non hanno bisogno di **alcuna** porta in ingresso verso l'esterno.
- La rete privata non trasporta traffico internet — la connessione worker↔DB/Redis non lascia mai la rete interna Hetzner.

---

## Troubleshooting

**`Connection refused` verso 10.0.0.2:6379/5432 dal nodo worker**
La rete privata non è end-to-end. Esegui `ip addr | grep 10.0.0` su entrambi i server; se necessario riavvia il server dopo l'attach della rete. `nc -zv 10.0.0.2 6379` per testare.

**`NOAUTH` / `WRONGPASS` nel log del worker**
`REDIS_URL` in `.env.worker` non contiene la password (o ne contiene una sbagliata). Deve corrispondere esattamente al `REDIS_PASSWORD` del server principale: `redis://:<PW>@10.0.0.2:6379`.

**Il worker parte ma non estrae job**
Controlla se `mingle: sync` ha funzionato. Se `mingle: all alone`, il nodo non vede la coda — di solito una connessione Redis sbagliata o mancante. Controlla anche: c'è effettivamente carico sul server principale? Con una coda vuota, il silenzio è normale.

**`SecurityWarning: running with superuser privileges`**
Solo un avviso, non un errore. I worker girano come root nel container (come sul server principale). Non critico.

**Le immagini vengono elaborate ma mancano le rendition**
Le credenziali S3 sul nodo worker non corrispondono a quelle del server principale, oppure bucket/endpoint sbagliati. Il worker allora scrive nel vuoto. Confronta `.env.worker` con il `.env` principale.
