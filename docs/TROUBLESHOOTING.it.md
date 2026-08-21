[English](TROUBLESHOOTING.md) · [Deutsch](TROUBLESHOOTING.de.md) · **Italiano**

# Troubleshooting

Una raccolta dei problemi più comuni nel self-hosting e delle loro soluzioni.

## Strumenti diagnostici

Prima di ogni altra cosa: guarda i log.

```bash
# Status of all containers
docker compose ps

# Logs of a service (follow live with -f)
docker compose logs api --tail=50 -f
docker compose logs caddy --tail=50 -f
docker compose logs worker --tail=50 -f

# All services at once
docker compose logs --tail=20 -f

# Last 30 seconds of all containers
docker compose logs --since=30s
```

Health-check dell'API:

```bash
curl -s http://localhost/health
```

---

## Problemi di configurazione

### ERR_CONNECTION_REFUSED — niente risponde sulla porta 80

Sulle installazioni precedenti alla v0.49.3, Caddy non riusciva mai a partire
su un clone fresco (loop di restart) per tre ragioni sovrapposte: un
`LUMIO_HOST` vuoto produceva un site block senza chiave, gli indirizzi di
default morti di due blocchi collidevano, e il plugin acme-dns richiede il
suo file di credenziali all'avvio anche quando il blocco wildcard non è
usato. Aggiorna alla v0.49.3+ (`git pull`,
`docker compose up -d --build`). Per confermare che è questo il problema:

```bash
docker compose ps            # caddy restarting?
docker compose logs caddy --tail=20
```

### I container non partono

```bash
docker compose ps
```

Se un servizio mostra `Restarting` o `Exited`, guarda i suoi log:

```bash
docker compose logs <service-name> --tail=100
```

Cause comuni:

- **`POSTGRES_PASSWORD` non impostata** → il container Postgres esce con "POSTGRES_PASSWORD not specified". Controlla il file `.env`.
- **Porta 80 o 443 occupata** → un altro web server è già in esecuzione. Trovalo con `ss -tlnp | grep -E ':80|:443'` e fermalo, oppure cambia `CADDY_HTTP_PORT`/`CADDY_HTTPS_PORT` in `.env`. Eseguire `./scripts/lumio-check-ports.sh` prima di `docker compose up -d` intercetta il problema in anticipo — vedi [docs/PORT-CHECK.it.md](PORT-CHECK.it.md).
- **Disco pieno** → controlla `df -h`. Le immagini Docker + i log divorano velocemente diversi GB.

### Dominio irraggiungibile (Connection Refused / Timeout)

Ordine dei controlli:

1. **Il DNS punta all'IP giusto?** `dig your-domain.com +short`
2. **Firewall aperto?** Su Hetzner Cloud: sia il firewall del sistema operativo (`ufw`) che il firewall della cloud console. Entrambi!
3. **Caddy è in esecuzione?** `docker compose ps caddy` → deve essere "running"
4. **Caddy binda 80/443?** `docker compose ps caddy` mostra porte come `0.0.0.0:80->80/tcp`. Se solo `127.0.0.1:...` → il servizio Caddy non è stato avviato.

Errore comune: `docker compose up -d --build api worker frontend` – questo avvia **solo** i servizi indicati, Caddy manca. Usa invece semplicemente `docker compose up -d` (tutti i servizi).

### Caddy non ottiene i certificati

```bash
docker compose logs caddy | grep -iE "error|acme"
```

Errori tipici:

- **`connection refused` durante la challenge ACME** → porta 80 non raggiungibile dall'esterno. Controlla firewall, firewall cloud, IP DNS sbagliato.
- **`no solvers available for remaining challenges (offered=[dns-01])`** → stai cercando di ottenere un certificato wildcard (`*.your-domain.com`). I wildcard richiedono la challenge DNS-01, non HTTP-01. Vedi [MULTI_TENANT.md](MULTI_TENANT.it.md#wildcard-zertifikate).
- **`too many requests` (rate limit)** → Let's Encrypt consente max. 50 certificati per dominio a settimana. Se fai test spesso: passa Caddy alla staging CA.

---

## Problemi di caricamento

### "Failed" durante il caricamento delle immagini

L'API è a posto, il caricamento dal browser a S3 fallisce. Il classico **problema CORS**.

Lumio usa URL presigned – il browser carica direttamente sul bucket S3, non tramite l'API. Senza header CORS sul bucket, il browser blocca la richiesta PUT.

**Soluzione per S3 esterno** (Hetzner, R2, B2, Wasabi):

Nella console del bucket del provider crea una regola CORS:

```json
{
  "CORSRules": [{
    "AllowedOrigins": ["https://your-domain.com"],
    "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }]
}
```

Se il tuo storage provider non ha una UI web per questo, tramite AWS CLI:

```bash
docker run --rm \
  -e AWS_ACCESS_KEY_ID="<key>" \
  -e AWS_SECRET_ACCESS_KEY="<secret>" \
  amazon/aws-cli s3api put-bucket-cors \
  --bucket lumio-prod \
  --endpoint-url https://<your-s3-endpoint> \
  --region <your-region> \
  --cors-configuration file:///path/to/cors.json
```

**Con MinIO** il CORS è permissivo di default e dovrebbe funzionare senza problemi. Se non funziona, nel container MinIO:

```bash
docker compose exec minio mc anonymous set download local/lumio
```

### "S3 connection refused" / l'init del caricamento fallisce

Guarda i log dell'API (`docker compose logs api`). Cause comuni:

- **`S3_ENDPOINT` sbagliato** – dovrebbe essere `http://minio:9000` per MinIO o `https://<your-endpoint>` per S3 esterno. **Non** localhost, il container non ci arriva.
- **`S3_REGION` sbagliata** – il default è `us-east-1`. Per Hetzner deve essere `fsn1` (o `nbg1`/`hel1`), altrimenti un signature mismatch (403).
- **`S3_FORCE_PATH_STYLE` mancante** – per la maggior parte dei servizi S3-compatibili (tranne AWS stesso) deve essere `true`.
- **Il bucket non esiste** – alcuni provider non lo creano automaticamente. Crealo manualmente nella console del provider.

---

## Problemi di login

### "JSON.parse: unexpected character" / "Unexpected token '<'" al login

Il frontend ha ricevuto HTML invece di JSON dall'API. Due cause comuni:

1. **Stai bypassando il proxy.** Lumio va raggiunto tramite Caddy sulla
   **porta 80/443** — che instrada `/api/*` verso l'API. Accedere direttamente
   alla porta del frontend (3000), es. via tunnel SSH `ssh -L 3000:127.0.0.1:3000 …`,
   colpisce Next.js senza le route API. Fai invece il tunnel della porta 80:
   `ssh -L 8080:127.0.0.1:80 your-server` → apri `http://localhost:8080`.
   (Dalla v0.49.1 la porta 3000 fa proxy delle chiamate API anche come fallback,
   ma sulle versioni precedenti questo è esattamente il sintomo.)
2. **Il container API è down** — Caddy allora risponde con una pagina di
   errore HTML. Controlla `docker compose ps` e `docker compose logs api --tail=50`.

Dalla v0.49.1 il frontend mostra un messaggio di errore descrittivo invece
del fallimento grezzo di `JSON.parse`.

### Il login riesce ma vieni subito disconnesso (accesso via IP del server)

Prima della v0.49.2 il cookie di sessione veniva sempre impostato con il flag
`Secure`. I browser lo accettano su `http://localhost`, ma lo scartano
silenziosamente su `http://<server-ip>` — il login restituisce OK, ma la
sessione non tiene mai. Risolto nella v0.49.2 (il flag ora segue il protocollo
effettivo; i setup HTTPS mantengono `Secure` come prima). Se la pagina non si
carica affatto via IP, controlla:

- **Firewall**: la porta 80 deve essere aperta (Hetzner Cloud Firewall, `ufw status`).
- **Upgrade HTTPS del browser**: alcuni browser (es. Brave) forzano `https://` —
  non c'è certificato per un IP nudo. Digita esplicitamente `http://<ip>`.

### Nessun pulsante di login, pagina vuota

Log del frontend:

```bash
docker compose logs frontend --tail=50
```

Se `ECONNREFUSED` verso la porta 3001 → l'API è irraggiungibile. Spesso a causa di un errore di migrazione in Postgres. Controlla i log dell'API:

```bash
docker compose logs api | grep -iE "error|migration"
```

### "Invalid credentials" nonostante i dati corretti

Causa più comune: l'utente è stato creato in un tenant diverso e stai facendo login sul dominio sbagliato.

Non critico in modalità single. In modalità multi: controlla lo slug del tenant nell'URL di login.

Elenca gli utenti:

```bash
docker compose exec api npx prisma studio
```

(Apre una UI web sulla porta 5555 dove puoi ispezionare la tabella utenti.)

### `create-admin` viene eseguito, ma il login non funziona

La password deve essere lunga almeno 12 caratteri. Con password più corte lo script si interrompe – ma se chiami `create-admin` tramite codice custom, una password troppo corta potrebbe passare inosservata e fallire al login.

Soluzione: crea di nuovo l'admin, lo script è idempotente (sovrascrive quello esistente).

---

## Problemi in modalità SaaS

### `price_not_configured` alla registrazione

I piani Stripe non sono ancora stati creati. Una volta:

```bash
docker compose exec api npm run stripe-bootstrap
```

Prerequisito: `STRIPE_SECRET_KEY` deve essere impostata in `.env` (con `sk_test_...` per la modalità test).

Lo script è idempotente e può essere eseguito più volte. Crea tre piani (Solo, Studio, Pro) + un pacchetto di archiviazione in Stripe e scrive i price ID nel DB di Lumio.

### I webhook Stripe non arrivano

Controlla nella Stripe Dashboard → Developers → Webhooks:

- URL dell'endpoint corretto: `https://your-domain.com/api/billing/webhook`
- Eventi sottoscritti: almeno `customer.subscription.*`, `invoice.payment_*`, `checkout.session.completed`
- Signing secret in `.env` come `STRIPE_WEBHOOK_SECRET`
- Riavvia il container API dopo la modifica di .env: `docker compose restart api`

Test: nella Stripe Dashboard puoi attivare eventi di test e vedere se Lumio li accetta.

---

## Problemi di performance

### Caricamento lento

Dal frontend all'API → allo storage S3 e ritorno al browser è una deviazione. Lumio usa **URL presigned**: il browser carica direttamente su S3, senza passare dall'API.

Se è lento:

- **S3 esterno invece di MinIO** – MinIO su una VM piccola satura rapidamente il disco
- **Storage nello stesso datacenter** del server (es. Hetzner Cloud + Hetzner Object Storage a Falkenstein)
- **`UPLOAD_CHUNK_SIZE_MIB`** in `.env` alzato da 8 a 16 per i file grandi

### La generazione delle miniature richiede un'eternità

Log del worker:

```bash
docker compose logs worker --tail=50
```

- **Uso CPU alto?** Scala i worker: `docker compose up -d --scale worker=4`
- **Molti file RAW di grandi dimensioni?** È intrinsecamente CPU-intensivo. Per l'accelerazione GPU vedi [GPU.md](GPU.it.md).
- **Auto-tagging AI attivo?** CLIP gira sulla CPU a 1–3 s per immagine. Anche qui aiutano GPU o più worker.

---

## Debug come ultima risorsa

Quando nient'altro aiuta, resetta tutto (⚠️ **tutti i dati persi**):

```bash
docker compose down -v   # -v also deletes volumes!
docker compose up -d --build
```

Oppure parzialmente – solo il DB da capo:

```bash
docker compose down
docker volume rm lumio_postgres_data
docker compose up -d
```

E prima ancora, clona di nuovo Lumio in una directory **nuova** per essere sicuro che non ci sia drift locale nelle config.

---

## Segnalare un problema

Se hai trovato un bug che non è elencato qui: apri un issue su https://github.com/markusthiel/lumio/issues con:

1. Cosa stavi cercando di fare?
2. Cosa è successo?
3. Log (`docker compose logs --tail=200`)
4. Modalità di setup (single/multi, MinIO o S3 esterno, Caddy o proxy esterno)
5. Versione di Lumio (`git rev-parse HEAD`)
