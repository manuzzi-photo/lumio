[English](BACKUP.md) · [Deutsch](BACKUP.de.md) · **Italiano**

# Backup

> Un backup non testato non è un backup. **Esegui regolarmente test di
> restore.**

Lumio esegue il backup di due aree dati separate, gestite in modo diverso:

1. **Postgres** – il database dell'applicazione (utenti, gallerie, permessi,
   stato di abbonamenti/Stripe). Piccolo, di alto valore, cambia
   continuamente → **giornaliero**.
2. **Bucket S3** – i file immagine e video veri e propri. Grande, cambia
   lentamente → **settimanale**.

Principio ferreo: **i backup devono uscire dal server.** Un dump che resta
sullo stesso server del DB non serve a nulla se il server si guasta. Questo
setup segue quindi la **regola del 3-2-1**: i dati (1) più due copie (2)
presso due provider diversi, una delle quali fuori sede (1).

| Dati | Originale | Copia 1 | Copia 2 |
|---|---|---|---|
| Postgres | Volume del server | Hetzner Object Storage (secondo bucket) | Backblaze B2 |
| Immagini/video | `lumio-prod` (Hetzner) | Versioning + Object Lock su `lumio-prod` | Backblaze B2 (rclone sync) |

`redis_data` (coda dei job) e `caddy_data` (certificati TLS) **non**
vengono sottoposti a backup — entrambi si rigenerano al riavvio. Dettagli
sotto in "Cosa non serve backuppare".

Questo repo include gli script già pronti:

- `scripts/lumio-backup.sh` – dump giornaliero di Postgres in entrambi i
  repo restic
- `scripts/lumio-media-sync.sh` – sync rclone settimanale delle immagini
  verso B2
- `scripts/lumio-backup.env.example` – template di configurazione (secrets!)

---

## Panoramica: cosa viene configurato

1. Installa gli strumenti: `restic`, `rclone`, `mc` (client MinIO, solo per
   il versioning dei bucket)
2. Crea un secondo bucket Hetzner `lumio-backups` (per il repo restic del DB)
3. Crea i bucket Backblaze B2 (`lumio-db-backup`, `lumio-media-backup`)
4. Inizializza i repo restic in entrambe le destinazioni
5. Attiva versioning + Object Lock su `lumio-prod`
6. Configura i remote rclone
7. Compila il file di configurazione `/etc/lumio-backup.env`
8. Aggiungi i cron job
9. Collega un dead man's switch
10. Esegui un **test di restore**

---

## 1. Installa gli strumenti

```bash
apt update && apt install -y restic rclone

# mc (MinIO client) — only needed to toggle bucket versioning.
# Architecture automatic (amd64 or arm64):
curl -sSL https://dl.min.io/client/mc/release/linux-$(dpkg --print-architecture)/mc -o /usr/local/bin/mc
chmod +x /usr/local/bin/mc
```

## 2. Secondo bucket Hetzner

Nella Hetzner Cloud Console crea un **secondo** bucket, es.
`lumio-backups` — **non** lo stesso di `lumio-prod`, altrimenti diventa un
single point of failure. Poi genera una coppia di chiavi S3 (Console →
Object Storage → Credentials). L'endpoint è `fsn1.your-objectstorage.com`.

## 3. Bucket Backblaze B2

Nell'account B2 crea due bucket privati:

- `lumio-db-backup` (per il DB)
- `lumio-media-backup` (per le immagini)

Poi crea una **application key** con accesso a entrambi i bucket (B2 → App
Keys). Ottieni un `keyID` e un `applicationKey` — quest'ultimo viene
mostrato solo **una volta**, quindi salvalo subito.

## 4. Inizializza i repo restic

restic cripta tutto con una password. Generane una robusta e conservala —
è l'**unico** modo per decrittare i backup:

```bash
openssl rand -base64 48 > /root/.lumio-restic-pwd
chmod 600 /root/.lumio-restic-pwd
```

> **Conserva questa password anche in un password manager su un dispositivo
> diverso.** Se la perdi INSIEME al server, i backup sono irrecuperabili.

Inizializza entrambi i repo una volta sola (stessa password per entrambi):

```bash
export RESTIC_PASSWORD_FILE=/root/.lumio-restic-pwd

# Hetzner (S3 backend)
export AWS_ACCESS_KEY_ID="<hetzner-backup-key>"
export AWS_SECRET_ACCESS_KEY="<hetzner-backup-secret>"
restic -r s3:https://fsn1.your-objectstorage.com/lumio-backups/db init
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY

# Backblaze B2 (B2 backend)
export B2_ACCOUNT_ID="<b2-key-id>"
export B2_ACCOUNT_KEY="<b2-app-key>"
restic -r b2:lumio-db-backup:db init
```

## 5. Versioning + Object Lock su `lumio-prod`

Protegge le immagini da cancellazioni accidentali/malevole prima ancora che
parta il sync settimanale. Su Hetzner questo si attiva solo via CLI (non
nella UI):

```bash
mc alias set lumio https://fsn1.your-objectstorage.com <prod-key> <prod-secret>
mc version enable lumio/lumio-prod

# Optional but recommended: expire old versions after 30 days (cost!)
mc ilm rule add lumio/lumio-prod --noncurrent-expire-days 30
```

L'Object Lock (WORM, protezione ransomware) può essere attivato solo alla
**creazione del bucket** — per un `lumio-prod` esistente, versioning +
lifecycle è la via pragmatica. Per il massimo irrobustimento, crea un nuovo
bucket con Object Lock e migra (un progetto a parte).

## 6. Remote rclone

```bash
rclone config
```

Crea due remote:

- **`hetzner`** — tipo `s3`, provider `Other`, endpoint
  `fsn1.your-objectstorage.com`, le credenziali di `lumio-prod`.
- **`b2`** — tipo `b2`, con `keyID` e `applicationKey`.

Test:

```bash
rclone lsd hetzner:lumio-prod
rclone lsd b2:
```

## 7. File di configurazione

```bash
cp /opt/docker/lumio/lumio/scripts/lumio-backup.env.example /etc/lumio-backup.env
chmod 600 /etc/lumio-backup.env
nano /etc/lumio-backup.env   # fill in all __PLACEHOLDERS__
```

Copia gli script in una posizione fissa e rendili eseguibili:

```bash
install -m 700 /opt/docker/lumio/lumio/scripts/lumio-backup.sh     /usr/local/bin/
install -m 700 /opt/docker/lumio/lumio/scripts/lumio-media-sync.sh /usr/local/bin/
```

Testa manualmente la prima esecuzione:

```bash
/usr/local/bin/lumio-backup.sh
restic -r b2:lumio-db-backup:db snapshots   # snapshot there?
```

## 8. Cron

```cron
# Postgres daily at 03:00
0 3 * * * /usr/local/bin/lumio-backup.sh >> /var/log/lumio-backup.log 2>&1

# Images/videos weekly, Sunday 03:30
30 3 * * 0 /usr/local/bin/lumio-media-sync.sh >> /var/log/lumio-media-sync.log 2>&1
```

Per un'operatività SaaS molto attiva (molte transazioni Stripe), aumenta la
frequenza di Postgres a ogni 6 o 12 ore.

## 9. Dead man's switch

Il guasto più pericoloso è quello **silenzioso** — il cron smette di girare
e nessuno se ne accorge. Crea due check su
[healthchecks.io](https://healthchecks.io) (gratuito) e inserisci gli URL di
ping come `HEALTHCHECK_URL` e `MEDIA_HEALTHCHECK_URL` in
`/etc/lumio-backup.env`. Gli script fanno ping a `/start`, successo e
`/fail` automaticamente; se un job non gira entro il periodo previsto, il
servizio ti avvisa via email/push.

## 10. Semaforo di stato backup nel super admin (opzionale)

Dopo ogni successo lo script scrive un file di stato (`STATUS_FILE`,
default `/backup/lumio/status.txt`). Il semaforo di stato backup integrato
di Lumio nell'area super admin può leggerlo e mostrare età/dimensione
(verde < 24 h, giallo < 72 h, rosso oltre).

Per questo il container API deve poter vedere il file. In
`docker-compose.prod.yml` aggiungi al servizio `api`:

```yaml
    environment:
      - BACKUP_STATUS_PATH=/backup-status/status.txt
    volumes:
      - /backup/lumio:/backup-status:ro
```

> Questa è una modifica a Compose/deploy (solo server principale,
> `BACKUP_STATUS_PATH` è una env opzionale con un default). Senza questo
> passaggio il backup funziona comunque al 100% — solo il semaforo resta su
> "non attivo".

---

## Test di restore

**Fallo una volta a trimestre**, idealmente su una VM usa e getta.

### Restore di Postgres (in un DB di test)

```bash
export RESTIC_PASSWORD_FILE=/root/.lumio-restic-pwd
export B2_ACCOUNT_ID="<b2-key-id>"; export B2_ACCOUNT_KEY="<b2-app-key>"

restic -r b2:lumio-db-backup:db restore latest --target /tmp/restored
cd /opt/docker/lumio/lumio
docker compose exec -T postgres psql -U lumio -c "DROP DATABASE IF EXISTS lumio_test;"
docker compose exec -T postgres psql -U lumio -c "CREATE DATABASE lumio_test;"
docker compose exec -T postgres pg_restore -U lumio -d lumio_test < /tmp/restored/tmp/lumio-dump.*/lumio.dump

# Sanity: tables + row counts
docker compose exec -T postgres psql -U lumio -d lumio_test -c "\dt"
```

Tabelle presenti e row count plausibili → il backup di Postgres è OK.

### Restore completo (una nuova istanza completa)

1. Installa Lumio da zero su una nuova VM (vedi `SELFHOSTING.md`).
2. Ferma i container: `docker compose stop`.
3. Ripristina `.env` dallo snapshot restic (`env.backup`) — contiene
   password + credenziali S3!
4. Carica il dump di Postgres (come sopra, ma nel DB reale invece di
   `lumio_test`).
5. Sincronizza di nuovo le immagini dal bucket B2:
   `rclone sync b2:lumio-media-backup hetzner:lumio-prod`.
6. Avvia i container, testa il login + una galleria.

Se funziona, in un disastro reale sei di nuovo online in ~1 ora.

---

## Cosa non serve backuppare

- `redis_data` – solo la coda dei job. I job in corso vanno persi, il
  sistema si avvia comunque pulito.
- `caddy_data` – certificati TLS, Caddy li riscarica automaticamente
  (attento solo al rate limit di Let's Encrypt).
- `minio_data` – vuoto quando si usa S3 esterno.
- Immagini dei container – arrivano dal registry.

---

## Frequenza dei backup (riepilogo)

| Asset | Frequenza | Motivazione |
|---|---|---|
| Postgres | giornaliero (SaaS eventualmente 6–12 h) | Alto valore dei dati, dimensione ridotta |
| Bucket S3 (immagini) | settimanale | Grande volume di dati, cambiamento lento |
| `.env` | a ogni backup del DB | Un restore senza `.env` è doloroso (incluso nella directory del dump) |
| Test di restore completo | trimestrale | Convalida l'integrità del backup |
