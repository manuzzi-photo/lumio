[English](STORAGE.md) · [Deutsch](STORAGE.de.md) · **Italiano**

# Archiviazione

Lumio usa un'archiviazione a oggetti compatibile con S3 per tutti i file
foto e video. Il setup predefinito è **MinIO nello stesso stack Compose** –
funziona subito, senza account esterno.

Non appena hai esigenze di scalabilità o di backup, passare a un S3 esterno
conviene.

## Quando usare cosa

| Setup | Quando |
|---|---|
| **MinIO (predefinito)** | Studio singolo, <500 GB di dati, un server |
| **Hetzner Object Storage** | Server anche su Hetzner, il GDPR conta, <10 TB |
| **Cloudflare R2** | Setup CDN, molto traffico pubblico, risparmiare sull'egress |
| **Backblaze B2** | Molto economico per TB, grandi volumi, carattere archivistico |
| **Wasabi** | Prezzo fisso, costi prevedibili, nessun limite di chiamate API |
| **AWS S3** | Multi-regione, compliance enterprise |

---

## Configurazione generale

In `.env`:

```bash
STORAGE_PROVIDER=custom        # for everything except MinIO
S3_ENDPOINT=https://...
S3_REGION=...
S3_BUCKET=lumio-prod
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_FORCE_PATH_STYLE=true       # for all S3-compatibles except AWS itself
S3_PUBLIC_URL=https://...      # same endpoint, unless you put a CDN in front
```

`STORAGE_PROVIDER` può essere: `minio`, `s3`, `r2`, `b2`, `wasabi`,
`custom`. I valori del provider sono solo indicazioni per il logging – la
configurazione effettiva viene dalle variabili `S3_*`.

Dopo il cambio: `docker compose restart api worker`.

**Imposta sempre anche il CORS sul bucket** (vedi sotto), altrimenti i
caricamenti dal browser falliscono.

---

## Sicurezza degli accessi (mantieni il bucket privato)

Il modello di accesso di Lumio si basa sul fatto che il **bucket resti
privato**. Non attivare l'accesso pubblico in lettura — non serve e
comprometterebbe la protezione:

- **Nessuna ACL pubblica.** Lumio non marca mai come pubblici gli oggetti
  caricati; ereditano il default del bucket, che deve restare privato. Un
  URL di oggetto grezzo senza firma deve restituire `AccessDenied`.
- **Accesso firmato e limitato nel tempo.** Tutta la distribuzione
  (thumbnail, anteprime, download, asset di branding) avviene tramite **URL
  presigned** che l'API emette solo all'interno di handler di richiesta
  autorizzati; scadono dopo ~1 ora. I download video (HLS) e ZIP vengono
  trasmessi in streaming attraverso l'API stessa, quindi il browser non
  legge mai direttamente il bucket.
- **Chiavi non indovinabili.** Le chiavi di archiviazione sono basate su
  UUID (`t/<tenant-uuid>/g/<gallery-uuid>/r/<file-uuid>/…`) — non possono
  essere enumerate né indovinate.

Limite intrinseco di cui essere consapevoli: un URL presigned funziona per
chiunque lo possieda finché non scade (è così che funziona il presigning).
Espone un singolo oggetto per quella finestra temporale, non la galleria —
ma non trattare un link presigned come qualcosa da pubblicare.

Verifica rapida che il tuo bucket sia privato: una richiesta non firmata
verso qualsiasi URL di oggetto (anche una chiave inesistente) dovrebbe
restituire HTTP `403 AccessDenied`. Se ottieni `200` o un elenco di file
XML, il bucket è pubblico — correggilo prima di andare in produzione.

## Hetzner Object Storage

Archiviazione compatibile S3 a Falkenstein, Norimberga o Helsinki. GDPR,
provider tedesco.

### Crea il bucket

Hetzner Cloud Console → Object Storage → "Create Bucket"
- Location: Falkenstein (o dove si trova il tuo server – risparmia latenza
  e costi di traffico)
- Nome: `lumio-prod` (o quello che vuoi)
- Genera le credenziali, annota ACCESS_KEY e SECRET_KEY

### `.env`

```bash
STORAGE_PROVIDER=custom
S3_ENDPOINT=https://fsn1.your-objectstorage.com    # adjust for NBG1/HEL1 accordingly
S3_REGION=fsn1
S3_BUCKET=lumio-prod
S3_ACCESS_KEY=<from console>
S3_SECRET_KEY=<from console>
S3_FORCE_PATH_STYLE=true
S3_PUBLIC_URL=https://fsn1.your-objectstorage.com
```

### CORS

Nella Hetzner Cloud Console: Bucket → CORS:
- Allowed Origins: `https://gallery.your-studio.com`
- Methods: `GET, PUT, POST, HEAD`
- Headers: `*`
- Expose: `ETag`

### Prezzi

A partire da €6,49/mese netti per 1 TB di archiviazione + 1 TB di egress.
L'utilizzo aggiuntivo è pay-as-you-go. Traffico tra un server Hetzner Cloud
e Hetzner Object Storage nella stessa regione: gratuito.

---

## Cloudflare R2

Zero costi di egress. Ideale quando ci si aspetta molto traffico pubblico
di immagini.

### Crea il bucket

Cloudflare Dashboard → R2 → "Create Bucket"
- Nome bucket: `lumio-prod`
- Location: Automatic o EU (per il GDPR)
- Crea un token API: R2 → "Manage R2 API Tokens" → diritti di modifica per
  il bucket

### `.env`

```bash
STORAGE_PROVIDER=r2
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=lumio-prod
S3_ACCESS_KEY=<R2 access key>
S3_SECRET_KEY=<R2 secret key>
S3_FORCE_PATH_STYLE=true
S3_PUBLIC_URL=https://<account-id>.r2.cloudflarestorage.com
```

Opzionale: per URL immagine diretti tramite la CDN Cloudflare, configura un
dominio personalizzato per R2 e punta `S3_PUBLIC_URL` a quel dominio.

### CORS

In R2 → Bucket → Settings → CORS Policy.

### Prezzi

$0,015/GB-mese di archiviazione, **egress completamente gratuito**.
Operazioni Class A (scritture) $4,50/milione.

---

## Backblaze B2

Prezzo più economico per TB. Combinato con Cloudflare come CDN: egress
gratuito.

### Crea il bucket

B2 Cloud Storage Dashboard → Create Bucket
- Nome bucket: `lumio-prod` (deve essere univoco a livello globale)
- Privato
- Crea una application key: "Add a New Application Key", limitata al bucket

### `.env`

```bash
STORAGE_PROVIDER=b2
S3_ENDPOINT=https://s3.<region>.backblazeb2.com    # e.g. eu-central-003
S3_REGION=eu-central-003
S3_BUCKET=lumio-prod
S3_ACCESS_KEY=<keyID>
S3_SECRET_KEY=<applicationKey>
S3_FORCE_PATH_STYLE=true
S3_PUBLIC_URL=https://s3.<region>.backblazeb2.com
```

### CORS

B2 Dashboard → Bucket → CORS Rules.

### Prezzi

$6/TB di archiviazione. Egress gratuito fino a 3x la dimensione
dell'archiviazione, poi $0,01/GB. Con una CDN Cloudflare davanti: illimitato
e gratuito.

---

## Wasabi

Prezzo fisso, nessun costo per le chiamate API. Ma: 90 giorni di
archiviazione minima per oggetto.

### `.env`

```bash
STORAGE_PROVIDER=wasabi
S3_ENDPOINT=https://s3.<region>.wasabisys.com   # e.g. eu-central-1
S3_REGION=eu-central-1
S3_BUCKET=lumio-prod
S3_ACCESS_KEY=<from Wasabi console>
S3_SECRET_KEY=<from Wasabi console>
S3_FORCE_PATH_STYLE=true
S3_PUBLIC_URL=https://s3.<region>.wasabisys.com
```

---

## AWS S3

Quando sei comunque già su AWS o hai requisiti di compliance.

### `.env`

```bash
STORAGE_PROVIDER=s3
S3_ENDPOINT=https://s3.<region>.amazonaws.com
S3_REGION=eu-central-1     # Frankfurt
S3_BUCKET=lumio-prod
S3_ACCESS_KEY=<IAM access key>
S3_SECRET_KEY=<IAM secret>
S3_FORCE_PATH_STYLE=false     # AWS uses virtual-hosted style
S3_PUBLIC_URL=https://lumio-prod.s3.<region>.amazonaws.com
```

Policy IAM per l'utente: come minimo `s3:GetObject`, `s3:PutObject`,
`s3:DeleteObject`, `s3:ListBucket`, `s3:AbortMultipartUpload`, limitata al
bucket.

---

## Migrare da MinIO a S3 esterno

Se hai MinIO in produzione e vuoi migrare:

```bash
# Into the MinIO container, mc is already there
docker compose exec minio mc alias set src http://localhost:9000 <minio-key> <minio-secret>
docker compose exec minio mc alias set dst https://<external-endpoint> <ext-key> <ext-secret>

docker compose exec minio mc mirror --overwrite src/lumio dst/lumio-prod
```

Lumio può continuare a girare durante la migrazione. Al termine, cambia
`.env` verso il nuovo provider, `docker compose restart api worker`. Il
container MinIO può poi essere fermato.

Per grandi volumi di dati, preferisci `rclone` sull'host: parallelizzabile,
ripristinabile.

---

## Configurazione CORS

Lumio usa URL presigned. Il browser carica direttamente su S3. Senza CORS
il browser lo blocca.

Regola CORS standard per tutti i provider:

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

Più origin (produzione + staging) come array. I wildcard (`*`) funzionano
ma non sono sicuri.

Se il provider non ha una UI web per questo:

```bash
docker run --rm \
  -e AWS_ACCESS_KEY_ID="<key>" \
  -e AWS_SECRET_ACCESS_KEY="<secret>" \
  amazon/aws-cli s3api put-bucket-cors \
  --bucket lumio-prod \
  --endpoint-url https://<endpoint> \
  --region <region> \
  --cors-configuration file:///path/to/cors.json
```
