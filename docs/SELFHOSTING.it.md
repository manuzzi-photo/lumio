[English](SELFHOSTING.md) · [Deutsch](SELFHOSTING.de.md) · **Italiano**

# Production Self-Hosting

Hai finito la Quick Start e ora vuoi far girare Lumio in modo pulito sotto
il tuo dominio, con HTTPS e backup. Questa guida richiede **15 minuti** e
presuppone:

- Un server Linux con IP pubblico (Hetzner, Netcup, hardware tuo – non
  importa), **amd64 o arm64** — entrambi supportati
- Un dominio (es. `gallery.your-studio.com`)
- Docker + Docker Compose v2

Requisiti dettagliati hardware/architettura: [REQUIREMENTS.md](REQUIREMENTS.it.md).

Questa guida copre lo **studio singolo**. Per il multi-tenant vedi
[MULTI_TENANT.md](MULTI_TENANT.it.md).

In esecuzione su un **NAS Synology**? Vedi il complemento specifico per
Synology: [SELFHOSTING-SYNOLOGY.md](SELFHOSTING-SYNOLOGY.it.md).

---

## 1. Configura il DNS

Presso il tuo provider DNS, crea un record A (e opzionalmente AAAA per
IPv6):

```
gallery.your-studio.com.   A     <server-ip>
```

Tieni il TTL basso per ora (300s); puoi alzarlo più avanti.

Verifica:

```bash
dig gallery.your-studio.com +short
```

Dovrebbe restituire l'IP del tuo server.

## 2. Apri il firewall

Sul server (o tramite la console cloud):

```bash
# UFW as an example
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

**Importante su Hetzner Cloud**: oltre al firewall del sistema operativo
c'è anche il Cloud Firewall nella console Hetzner – apri 80 e 443 anche lì,
altrimenti non passa nulla.

## 3. Installa Lumio

```bash
mkdir -p /opt/docker && cd /opt/docker
git clone https://github.com/markusthiel/lumio.git
cd lumio
cp .env.example .env
```

Genera secrets sicuri:

```bash
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')|" .env
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -base64 32 | tr -d '/+=')|" .env
sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -base64 32 | tr -d '/+=')|" .env
sed -i "s|^S3_ACCESS_KEY=.*|S3_ACCESS_KEY=$(openssl rand -hex 12)|" .env
sed -i "s|^S3_SECRET_KEY=.*|S3_SECRET_KEY=$(openssl rand -base64 32 | tr -d '/+=')|" .env
```

## 4. Imposta il dominio in .env

```bash
nano .env
```

Imposta questi valori:

```bash
LUMIO_HOST=gallery.your-studio.com
PUBLIC_URL=https://gallery.your-studio.com

# S3 needs its OWN subdomain — a path prefix (…/s3) does NOT work:
# MinIO verifies the AWS V4 signature over the full path incl. bucket,
# so path rewriting breaks every upload. Set BOTH values and add a
# DNS A record for the subdomain pointing to the same server IP:
LUMIO_S3_HOST=s3.your-studio.com
S3_PUBLIC_URL=https://s3.your-studio.com
```

(Senza un dominio — solo test via IP — lascia entrambi i valori S3 non
impostati: l'API allora firma automaticamente contro `http://<host>:9000`;
assicurati che la porta 9000 sia raggiungibile.)

## 5. Avvia

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Caddy ottiene automaticamente un certificato Let's Encrypt (richiede circa
30 secondi). Osservalo:

```bash
docker compose logs -f caddy
```

Il successo si presenta così: `certificate obtained successfully ...
gallery.your-studio.com`.

## 6. Crea un utente admin

In modalità single Lumio crea automaticamente un tenant chiamato "My
Studio" al primo avvio – non ti serve un super admin e non devi creare un
tenant manualmente. Solo il primo utente:

```bash
docker compose exec api npm run create-admin -- \
  --email=you@your-studio.com \
  --password=atleast12chars \
  --name="Your Studio"
```

## 7. Accedi

→ `https://gallery.your-studio.com`

Al primo login crea una galleria di prova, carica un'immagine, condividi il
link della galleria, aprilo da un altro dispositivo. Se tutto funziona: sei
live.

---

## Attivare funzionalità opzionali (print shop, analytics, …)

Le funzionalità beta/sperimentali sono dietro feature flag e disattivate di
default. In self-hosting (senza UI super admin) le attivi globalmente
tramite `.env`:

```bash
FEATURES_ENABLED=print_shop,advanced_analytics
```

Chiavi disponibili: `print_shop`, `lightroom_plugin`, `advanced_analytics`,
`ai_tagging` (richiede il worker ML, `docker-compose.ml.yml`),
`video_streaming_4k`. Riavvia l'API dopo la modifica:
`docker compose up -d api`. In modalità multi, gli override per tenant
dalla UI super admin hanno la precedenza — anche per disattivare.

Il print shop ha inoltre un'**attivazione a livello di provider**
(normalmente fatta nella UI super admin). La stampa in proprio funziona
sempre; per le integrazioni con i laboratori imposta:

```bash
PRINT_PROVIDERS_ENABLED=prodigi,gelato
```

Ogni studio inserisce poi le proprie credenziali API sotto Print shop →
Providers.

## Backup

Fai il backup di almeno due cose:

1. **Postgres** – l'intero database dell'applicazione (utenti, gallerie,
   permessi)
2. **Bucket S3** – le immagini/video veri e propri

### Dump notturno di Postgres

Aggiungi a crontab (`crontab -e`):

```cron
0 3 * * * cd /opt/docker/lumio && docker compose exec -T postgres pg_dump -U lumio lumio | gzip > /backup/lumio-$(date +\%Y\%m\%d).sql.gz && find /backup -name "lumio-*.sql.gz" -mtime +14 -delete
```

Mantiene 14 giorni. Poi sincronizza fuori sede (es. con `rclone` verso un
provider di backup).

### Backup del bucket S3

Con MinIO basta fare rsync del volume `minio_data`. Con S3 esterno
(Hetzner, R2, B2) attiva versioning + lifecycle – i provider lo fanno dalla
loro console.

### Test di restore

**Esegui regolarmente un test di restore su una VM di prova.** Un backup
non testato non è un backup.

---

## Aggiornamenti

```bash
cd /opt/docker/lumio
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Le migrazioni Prisma vengono eseguite automaticamente all'avvio dell'API.
**Fai un dump di Postgres prima di ogni aggiornamento** – le migrazioni
raramente sono reversibili.

Puoi vedere la versione attualmente in esecuzione con
`docker compose logs api | grep "Lumio API ready"`.

---

## Il tuo S3 esterno al posto di MinIO

MinIO funziona bene per setup più piccoli (fino a ~500 GB). Per volumi
maggiori conviene un S3 esterno:

- **Hetzner Object Storage** – economico, GDPR, può stare nello stesso
  datacenter del server
- **Cloudflare R2** – egress gratuito, ottimo per setup CDN
- **Backblaze B2** – prezzo di archiviazione più economico, latenza
  leggermente più alta

Passaggi di configurazione: vedi [STORAGE.md](STORAGE.it.md).

**Importante con S3 esterno**: imposta il CORS sul bucket! Lumio carica le
immagini direttamente dal browser a S3 (URL presigned). Senza CORS
fallisce. Nello specifico:

```json
{
  "CORSRules": [{
    "AllowedOrigins": ["https://gallery.your-studio.com"],
    "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }]
}
```

Per Hetzner Object Storage imposta inoltre `S3_FORCE_PATH_STYLE=true` e
`S3_REGION=fsn1` (o la posizione del tuo bucket).

---

## Sicurezza

- **Non fare mai commit di `.env`** – è in `.gitignore`, ma controlla
  comunque
- **Non esporre la porta Postgres verso l'esterno** – il default è già
  corretto, raggiungibile solo internamente
- **Metti in sicurezza la console MinIO (porta 9001)** – nel compose di
  produzione non è raggiungibile dall'esterno di default, solo via
  `docker exec`
- **Cripta i backup** quando sono archiviati su storage di terze parti
  (`gpg`, `restic`, `borg`)
- **Login SSH solo con chiave** sul server, nessuna autenticazione via
  password
- **Attiva gli unattended upgrades** per le patch del sistema operativo

---

## Insidie comuni

→ vedi [TROUBLESHOOTING.md](TROUBLESHOOTING.it.md)
