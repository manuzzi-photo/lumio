[English](KONZEPT.md) · [Deutsch](KONZEPT.de.md) · **Italiano**

# Lumio — Concept & Architecture

**Nome del progetto:** Lumio
**Tipo:** Piattaforma source-available, self-hosted per condividere, fare il proofing e consegnare shooting fotografici e video
**Licenza:** FSL-1.1-ALv2 (Functional Source License — source-available, non open source secondo OSI)
**Ispirazione:** Picdrop, Pixieset, Pic-Time, ShootProof
**Aggiornato a:** giugno 2026
**Stato:** In produzione. Questo documento descrive il sistema **effettivamente costruito e distribuito** (nato originariamente come documento di pianificazione a maggio 2026, da allora costantemente allineato alla realtà).
**Repository (pubblico):** https://github.com/markusthiel/lumio — codice dell'app per studio + gallerie cliente. Mantenuto internamente principalmente via Forgejo e specchiato su GitHub; i due siti marketing in Astro vivono in repository separati e interni.

---

## 1. Visione & posizionamento

Un'alternativa a Picdrop self-hosted, veloce e attenta alla privacy — costruita per fotografi e piccoli studi che vogliono mantenere il pieno controllo dei propri dati (GDPR, NDA, clienti aziendali). L'obiettivo **non** è "parità di funzionalità con Adobe Lightroom", ma: riprodurre in modo pulito, come stack Docker, ciò che Picdrop fa davvero bene.

**Tre principi guida:**

1. **Veloce.** Caricamenti, thumbnail, rendering della galleria devono sembrare app native. Niente scatti da lazy-loading, niente 5 secondi di attesa per una thumbnail da 12 MP.
2. **Semplice per i clienti finali.** Nessun login. Nessun "crea un account". Apri il link — guarda, metti like, commenta, scarica. Mobile-first.
3. **All'altezza dei professionisti.** RAW, video di grandi dimensioni, molte migliaia di file per galleria, un workflow Lightroom/Capture One, branding, condivisioni sicure.

---

## 2. Stack tecnologico

Lo stack effettivamente in uso (dopo aver soppesato performance, elaborazione delle immagini, velocità di sviluppo ed ecosistema):

| Livello                   | Tecnologia                                    | Motivazione                                                                                                                  |
| ------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Frontend**              | **Next.js 16 (App Router, Turbopack) + React 19 + TypeScript** | Server Components per un rendering iniziale veloce, una buona pipeline immagini, un ecosistema enorme. Siti marketing separati in Astro. |
| **UI**                    | Tailwind CSS + shadcn/ui + Radix              | Componenti di alta qualità e personalizzabili senza appesantire. Adatto al whitelabel.                                                      |
| **Visualizzatore immagini**           | PhotoSwipe v5 o OpenSeadragon              | Lo standard di settore per lightbox/deep zoom. Gesti touch, tastiera, schermo intero, pinch zoom.                                  |
| **Player video**          | Video.js o Vidstack                        | Streaming HLS, bitrate adattivo, sottotitoli, immagini di anteprima durante lo scrubbing.                                                   |
| **Backend API**           | **Node.js + Fastify + TypeScript + Prisma (PostgreSQL)** | Molto veloce, stesso linguaggio del frontend → tipi condivisi (`packages/shared`), schemi Zod. Prisma come ORM con migrazioni versionate. |
| **Worker (elaborazione)** | **Python + Celery** (container separato)     | Per l'elaborazione RAW/video l'ecosistema Python (rawpy, Pillow, OpenCV, PyAV) batte chiaramente Node. Una netta separazione API ↔ CPU. |
| **Coda / cache**         | Redis (ioredis nell'API per rate limiting/sessioni, il broker Celery per i job del worker) | Coda di job per thumbnail/transcodifica/tagging, rate limiting, sessioni. Redis è protetto da password. |
| **Database**             | **PostgreSQL 16**                              | JSONB per metadati flessibili (EXIF), ricerca full-text, maturo, transazionalmente sicuro.                                         |
| **Archiviazione oggetti**        | **Compatibile S3**, liberamente selezionabile via `STORAGE_PROVIDER` (MinIO incluso di serie; in produzione su lumio-cloud.de: **Hetzner Object Storage**) | Scala orizzontalmente, backup semplici, URL presigned per il caricamento diretto dal browser (alleggerisce il backend). |
| **Reverse proxy**         | Caddy o Traefik                            | Let's Encrypt automatico, HTTP/3, integrazione Compose semplice.                                                          |
| **Auth (lato studio)**   | Auth di sessione propria (hashing argon2id, sessioni su Redis) | Cookie HTTP-only, TOTP 2FA, passkey/WebAuthn, token API per i plugin.                                            |
| **Auth (lato galleria)**  | Token URL firmati (JWT) + password opzionale   | Stile Picdrop: nessun account per i clienti.                                                                                      |

### Scelta del provider di archiviazione

Poiché la condivisione di foto è **poco scrittura, molta lettura** (caricato una volta, scaricato molte volte), vale la pena guardare i prezzi di egress. Lumio supporta tutti i provider compatibili S3 tramite un unico interruttore `STORAGE_PROVIDER`:

| Provider           | Prezzo storage  | Egress         | Quando ha senso                                                |
| ------------------ | -------------- | -------------- | ------------------------------------------------------------ |
| **MinIO** (locale)  | costo hardware | solo banda | Self-hosting sul proprio server, massima sovranità dei dati       |
| **Cloudflare R2**  | molto economico    | **0 €**         | Consigliato per il modo hosted — i download non costano nulla        |
| **Backblaze B2**   | molto economico    | economico         | Una buona alternativa, ampia scelta di regioni                      |
| **AWS S3**         | medio          | costoso           | Se l'ecosistema AWS è comunque già presente                     |
| **Wasabi**         | economico         | incl.           | Modello "tutto incluso", nessuna commissione di egress nascosta    |
| **Hetzner Object Storage** | economico | incl. (in DE)   | GDPR-friendly, provider europeo                      |

I prezzi concreti oscillano — verifica presso il provider. Per setup puramente self-hosted, **MinIO nello stesso Compose** è la via più semplice (default). L'istanza SaaS di produzione **lumio-cloud.de** gira volutamente su **Hetzner Object Storage** (UE/GDPR, egress incluso). Per setup ad alto traffico senza vincoli GDPR, **Cloudflare R2** (egress a 0 €) resta economicamente interessante.

Il passaggio tra provider è possibile (`rclone sync s3-old:bucket s3-new:bucket` più il cambio di `S3_ENDPOINT`) — tutte le renditions sono reperibili tramite chiavi deterministiche.

### Perché non fare tutto in un solo linguaggio?

Avevo considerato di costruire il backend interamente in Python (FastAPI) — RAW/video ci si sarebbero adattati in modo nativo. Tuttavia:

- Fastify è chiaramente più veloce nel livello API a elevato I/O (coordinamento upload, WebSocket per la collaborazione live, URL presigned) e lavora meglio con gli stream S3.
- La separazione del worker è comunque necessaria (non vuoi una conversione RAW da 30 secondi nel processo API), quindi il worker può tranquillamente essere Python.
- I tipi TypeScript condivisi tra frontend e API fanno risparmiare un numero enorme di bug.

L'unico confine tra linguaggi è API ↔ worker via la coda Redis con payload JSON — pulito e stabile.

### Alternative (se vuoi fare diversamente)

- **TypeScript puro:** backend + worker entrambi in Node. Sharp per JPEG/PNG/TIFF/WebP è eccellente, `libraw` è raggiungibile via FFI, ma la gestione dei RAW diventa complicata. Le chiamate a ffmpeg sono indipendenti dal linguaggio.
- **Python puro:** FastAPI + Celery + SSR Jinja o HTMX. Uno stack snello, ottimo per sviluppatori solo, ma il frontend diventa più faticoso per le interazioni impegnative della galleria.
- **Go:** massime prestazioni, ma l'ecosistema immagini/video è più sottile; molto dovrebbe passare per CGO/sottoprocessi.

---

## 3. Architettura dei componenti

```
                                  ┌──────────────────┐
                                  │   Reverse proxy  │
                                  │  (Caddy/Traefik) │
                                  │   TLS, HTTP/3    │
                                  └────────┬─────────┘
                                           │
              ┌────────────────────────────┼────────────────────────────┐
              │                            │                            │
        ┌─────▼─────┐              ┌───────▼────────┐           ┌──────▼──────┐
        │ Frontend  │              │   API server   │           │  MinIO/S3   │
        │ Next.js   │◄────────────►│ Fastify (Node) │           │  Object     │
        │           │   REST/WS    │                │           │  storage    │
        └───────────┘              └───┬────────┬───┘           └──────▲──────┘
                                       │        │                      │
                                       │        │  Presigned PUT/GET   │
                                       │        └──────────────────────┘
                                       │
                          ┌────────────┼────────────┐
                          │            │            │
                    ┌─────▼─────┐ ┌────▼────┐ ┌────▼──────────┐
                    │ Postgres  │ │  Redis  │ │ Worker pool   │
                    │ (metadata)│ │ (queue) │ │ Python+Celery │
                    └───────────┘ └─────────┘ │ - thumbnails  │
                                              │ - RAW decode  │
                                              │ - video trans │
                                              │ - ZIP build   │
                                              └───────────────┘
```

### Componenti nel dettaglio

**1. Reverse proxy** — TLS, routing HTTP, caching degli asset statici, opzionalmente Brotli/Zstd.

**2. Frontend (Next.js)** — due aree:

- **Studio** (`/studio/*`): la dashboard per il fotografo. Creazione gallerie, caricamento, statistiche, impostazioni, branding.
- **Galleria** (`/g/[slug]`): quello che vedono i clienti. Veloce, focalizzata, ottimizzata per mobile. I Server Components per le parti irrilevanti per SEO/anteprima vanno bene qui, ma il vero e proprio visualizzatore è un Client Component per l'interattività.

**3. Server API (Fastify)** — endpoint REST + un server WebSocket per la collaborazione live. Gestisce le sessioni, valida i token, firma gli URL S3, coordina i job del worker. **Non** fa mai passare le immagini attraverso di sé — sempre URL presigned.

**4. Worker (Python/Celery)** — il livello ad alto uso di CPU. Modello pull: job dalla coda Redis, altamente scalabile (più repliche possibili, worker GPU possibili per ffmpeg+NVENC).

**5. PostgreSQL** — metadati (utenti, gallerie, file, commenti, valutazioni, audit log).

**6. Redis** — coda dei job, rate limiting, session store opzionale, pub/sub per il fanout WebSocket.

**7. Archiviazione oggetti (compatibile S3)** — originali + renditions derivate (thumbnail, preview, web, con watermark). Nessun filesystem diretto — evita problemi di scalabilità. MinIO è incluso di serie per il self-hosting; l'istanza SaaS usa Hetzner Object Storage.

---

## 4. Modello dati (PostgreSQL)

Le tabelle essenziali (semplificate, senza il boilerplate `created_at`/`updated_at`/`id`):

```sql
tenants                -- Multi-tenancy: one or many studios per instance
  slug, name, status, custom_domain, branding_id

users                  -- Studio owners and team members
  tenant_id, email, password_hash, role, totp_secret, totp_enabled, status

teams                  -- Optional: multi-user studios (within a tenant)
  name, owner_id

galleries              -- One gallery per shoot/delivery
  tenant_id, slug, title, owner_id, branding_id, cover_file_id
  mode               -- 'collaboration' | 'presentation'
  status             -- 'draft' | 'live' | 'archived'
  password_hash      -- optional
  expires_at         -- optional
  download_enabled, watermark_enabled, comments_enabled
  selection_limit    -- max number the customer may select
  settings_jsonb     -- flexible: sorting, layout, background color

gallery_access        -- Who has access via a link
  gallery_id, token, label (e.g. "couple", "agency")
  permissions_jsonb  -- {can_download, can_comment, can_select, can_invite}

files                  -- Every upload
  gallery_id, original_filename, storage_key
  mime_type, size_bytes, sha256
  width, height, duration_ms
  exif_jsonb, taken_at
  status             -- 'uploading' | 'processing' | 'ready' | 'failed'
  sort_index

renditions             -- Derived variants per file
  file_id, kind        -- 'thumb' | 'preview' | 'web' | 'watermarked' | 'hls'
  storage_key, width, height, size_bytes

selections             -- Customer selection
  file_id, access_token_id, color, rating, status
  -- color: 'red' | 'yellow' | 'green' (Picdrop-style)
  -- rating: 1-5 stars
  -- status: 'like' | 'pick' | 'reject'

comments               -- Comments/annotations
  file_id, access_token_id, author_label
  body_text, annotation_jsonb  -- for scribbles: paths as SVG coords
  parent_id           -- for threads

team_votes             -- Several members of a customer team vote
  file_id, voter_label, value

download_log           -- Audit
  gallery_id, file_id, ip, user_agent, kind

events                 -- Generic audit log (login, share link, delete)
  tenant_id, actor_type, actor_id, action, target_type, target_id, payload_jsonb

brandings              -- Whitelabel per studio (or per gallery)
  tenant_id, logo_url, primary_color, font, favicon_url
  custom_domain, intro_text, footer_text, css_overrides

billing_plans          -- Plan definitions (only active in hosted mode)
  slug, name, storage_gib, galleries_max, files_per_gallery, users_max
  bandwidth_gib_per_month, custom_domain, white_label, watermarking, analytics
  stripe_price_id_monthly, stripe_price_id_yearly, price_monthly_cents, currency

billing_subscriptions  -- One subscription per tenant
  tenant_id (unique), plan_id, status, billing_interval
  stripe_customer_id, stripe_subscription_id
  current_period_start, current_period_end, trial_ends_at
  storage_bytes_used, bandwidth_bytes_used, galleries_count

billing_usage_records  -- Usage-based additional line items (phase 2)
  tenant_id, kind, quantity, unit_price_cents, period_start, period_end
```

**Nota sulla multi-tenancy:** tutte le tabelle eccetto `tenants` e `billing_plans` hanno `tenant_id` come FK. L'API impone questo filtro centralmente.

**Indici su:** `galleries(slug)`, `files(gallery_id, sort_index)`, `selections(file_id, access_token_id)`, `gallery_access(token)`.

---

## 5. Workflow principali

### 5.1 Caricamento (studio → server)

I "crazy fast uploads" di Picdrop non sono un trucco magico, ma un caricamento diretto browser→S3 con chunk paralleli. È esattamente quello che facciamo:

1. Il browser chiede all'API: "voglio caricare N file" + metadati (nome, dimensione, MIME).
2. L'API crea le voci `files` con stato `uploading`, genera **URL PUT presigned** (con multipart per file >100 MB).
3. Il browser esegue `Promise.allSettled` con ad es. 6 caricamenti paralleli direttamente verso S3/MinIO (il backend **non** diventa il collo di bottiglia).
4. Per ogni caricamento completato: il browser lo comunica all'API → l'API imposta lo stato su `processing` e lancia un job in Redis.
5. Il worker recupera il job, genera le renditions, scrive lo stato `ready` nel DB.
6. Il frontend riceve un aggiornamento di stato via WebSocket → la thumbnail appare live nella vista dello studio.

**Vantaggio:** il backend può girare su 0.5 vCPU, il throughput scala con l'archiviazione oggetti.

### 5.2 Elaborazione RAW

Per ogni file RAW (CR2, CR3, NEF, ARW, RAF, DNG, ORF, PEF, RW2…) nel worker:

```python
import rawpy
from PIL import Image

with rawpy.imread(path) as raw:
    # 1. Use the fast embedded preview JPEG (contained in the RAW,
    #    created in-camera — looks like on the camera display)
    try:
        thumb = raw.extract_thumb()
        if thumb.format == rawpy.ThumbFormat.JPEG:
            preview_bytes = thumb.data
        else:
            preview_bytes = encode_jpeg(thumb.data)
    except rawpy.LibRawNoThumbnailError:
        # 2. Fallback: demosaic from RAW (slow, but reliable)
        rgb = raw.postprocess(use_camera_wb=True, no_auto_bright=False)
        preview_bytes = encode_jpeg(rgb, quality=92)

# From the preview then derive the web renditions with Pillow/libvips
```

La documentazione di LibRaw lo conferma: la preview incorporata è la via veloce alla thumbnail, che copre quasi ogni formato RAW. Per le gallerie questo basta nel 99% dei casi — i clienti vogliono vedere cosa stanno selezionando, non la massima qualità RAW possibile.

**Importante:** il **RAW originale resta intatto** nell'archiviazione. Le renditions sono solo JPEG/WebP derivati.

### 5.3 Pipeline delle renditions

Per ogni foto generiamo diverse varianti — **con libvips** (tramite `pyvips`), che è 4–8× più veloce di ImageMagick e richiede meno RAM:

| Rendition          | Scopo                              | Dimensioni          | Formato              |
| ------------------ | ---------------------------------- | ------------- | ------------------- |
| `thumb`            | Vista a griglia nella galleria       | 400 px lato lungo | WebP, qualità 75 |
| `preview`          | Lightbox / mobile                  | 1600 px       | WebP/AVIF, qual. 82 |
| `web`              | Lightbox su schermi grandi      | 2560 px       | WebP/AVIF, qual. 85 |
| `watermarked`      | Quando il download è disattivato         | come `web`     | JPEG + watermark    |
| `download` (opz.)  | Variante di download "risoluzione web" | 2048 px       | JPEG, qual. 92      |
| Originale           | Download completo (RAW o JPEG completo) | invariato   | formato originale      |

### 5.4 Elaborazione video

Per i video (MP4, MOV, AVI, MKV, HEVC, ProRes) nel worker tramite **ffmpeg**:

1. **Poster** — un frame al 10% della durata come JPEG.
2. **Stream web (HLS)** — bitrate adattivi: 480p, 720p, 1080p (4K opzionale). Codice: `ffmpeg -i input.mov -filter:v ... -hls_time 6 -hls_playlist_type vod ...`. Offre uno streaming fluidissimo invece di un download da 2 GB nel browser.
3. **Thumbnail di scrubbing** — uno sprite sheet (un'immagine ogni 10 sec, come un unico grande JPEG) per l'anteprima del player durante lo scrubbing.
4. **Originale** — resta nell'archiviazione per il download.

**Accelerazione GPU** opzionale (NVENC/QSV) se l'host ha una GPU — drasticamente più veloce con materiale 4K.

### 5.5 Vista galleria (esperienza cliente)

Cosa vede il cliente tramite il link `https://photos.studio.de/g/abc123`:

1. **Copertina** — una grande hero image + titolo della galleria + branding dello studio.
2. **Opzionale:** inserimento password / raccolta email (per la lead generation, disattivabile).
3. **Griglia** — un layout masonry virtualizzato (ad es. `react-photo-album` con `react-window`). Con 5.000 immagini si carica **solo** quello visibile. Le thumbnail vengono fornite tramite `<img loading="lazy">` + `srcset`.
4. **Lightbox** — PhotoSwipe v5, tastiera, touch, pinch zoom, schermo intero, slideshow.
5. **Per ogni immagine:** like, tag colore (rosso/giallo/verde), commento, strumento scribble (su dispositivi touch con pennino), valutazione a stelle.
6. **Filtro** — "mostra solo i selezionati", "solo commentati", "per colore".
7. **Download** — download singolo o ZIP (vedi sotto).

### 5.6 Download ZIP (un grande punto dolente fatto bene)

L'approccio ingenuo sarebbe: "impacchetta tutto in un unico ZIP e consegnalo" — a 10 GB il server muore. Fatto bene:

- **ZIP in streaming**: il worker costruisce lo stream ZIP al volo e lo passa direttamente alla risposta HTTP (`archiver` in Node o `zipstream-ng` in Python). Nessun file temporaneo, nessuna esplosione di RAM.
- Per i download **ripetibili** (ad es. dopo una selezione): lo ZIP viene messo in cache una volta su S3 e il link viene restituito per 7 giorni.
- **Ripristinabile** via HTTP Range, per quanto lo stream lo consenta — in alternativa a blocchi (più ZIP da 5 GB ciascuno).

### 5.7 Workflow Lightroom / Capture One

La funzionalità killer di Picdrop: la selezione del cliente torna in Lightroom. Offriamo:

1. **File di esportazione** — download di un `.txt`/`.csv` con i nomi dei file selezionati.
2. **Sidecar XMP** — per ogni foto selezionata un file `.xmp` con `xmp:Rating` o `xmp:Label` che Lightroom/Capture One riconoscono direttamente quando li posizioni accanto ai RAW originali.
3. **Plugin Lightroom** (fase 2) — un plugin Lua che recupera la selezione tramite un token API e contrassegna le immagini corrispondenti in Lightroom.

---

## 6. Matrice delle funzionalità

Lumio è andato oltre l'MVP originale. Lo stato seguente riflette il sistema **effettivamente distribuito**.

### Costruito & in produzione

| Area | Funzionalità |
| ------- | -------- |
| **Gallerie** | Creazione, caricamento (browser→S3, chunk paralleli), draft/live/archiviata, protezione con password, data di scadenza, copertina, tag della galleria, capitoli, template/preset di galleria |
| **Media** | RAW (CR2/CR3/NEF/ARW/RAF/DNG/ORF/PEF/RW2/X3F), JPEG/PNG/WebP/AVIF/TIFF/HEIC, video (MP4/MOV/AVI/MKV/HEVC/ProRes), transcoding HLS, slideshow |
| **Esperienza cliente** | Galleria senza login, lightbox (tastiera/touch/pinch), like / tag colore / valutazione a stelle, commenti, annotazioni scribble direttamente sull'immagine, limite di selezione, download ZIP in streaming, mobile-first |
| **Branding** | Branding per studio e per galleria (logo, colori, font, footer), domini personalizzati, testi hero/di benvenuto, livelli di animazione |
| **Studio** | Membri del team + ruoli (Owner/Member), accesso team granulare per galleria, azioni bulk, tagging manuale + assistito da IA, rilevamento duplicati, audit log, statistiche/analytics, token API |
| **Sicurezza** | TOTP 2FA, passkey/WebAuthn, argon2id, URL firmati, rate limiting, esportazione dati GDPR (per galleria come ZIP), scadenze automatiche di eliminazione/archiviazione |
| **Print shop** | Vendita di stampe dalla galleria (prodotti/varianti/spedizione/provider), ritaglio, carrello, checkout con Stripe, conferma d'ordine & tracciamento |
| **Plugin** | Plugin Lightroom Classic (publish service), plugin Capture One, webhook |
| **Multilingua** | Interfaccia studio in tedesco + inglese (i18n completo, commutabile) |
| **Multi-tenancy & billing** | Modo single/multi, self-service signup, abbonamenti Stripe + trial + livelli read-only, limiti di piano, banner |
| **Operazioni** | Stack Docker Compose, scalabilità orizzontale dei worker su più nodi (Hetzner Private Network), TLS wildcard via acme-dns, analytics Umami (senza cookie, opzionale) |

### Tagging AI (deliberatamente opt-in)

Picdrop è volutamente privo di IA. Lumio offre il tagging automatico come **opt-in disattivabile** tramite un'immagine worker ML separata (`docker-compose.ml.yml`, CPU; GPU opzionale). I suggerimenti vengono mostrati allo studio per la conferma, nulla viene applicato senza essere richiesto.

### Pianificato / aperto

| Funzionalità |
| ------- |
| Altre lingue (FR, ES, IT) |
| Fatturazione aggiuntiva basata sull'utilizzo (add-on di archiviazione via Stripe Metered) |
| Ricerca globale su tutte le gallerie ("DAM-light") |
| API pubblica + OAuth |
| App mobile (caricamento dall'iPhone) |
| Collaborazione live con cursori in tempo reale di altri visualizzatori |

## 7. Multi-tenancy — un'istanza per uno o più studi

> ⚠️ **Nota sulla licenza:** l'uso interno/agenzia del multi-tenant è illimitato; offrirlo come SaaS commerciale a terzi è *Competing Use* secondo la FSL-1.1-ALv2 e richiede una licenza commerciale. Vedi [LICENSE](../LICENSE).

Lumio può fare entrambe le cose: **un'installazione per un singolo studio** (self-hosting classico) **oppure un'istanza multi-tenant** per provider SaaS, agenzie con più brand o hosted provider. La modalità si sceglie tramite un'unica variabile d'ambiente:

```
DEPLOYMENT_MODE=single   # exactly one tenant, created automatically at start
DEPLOYMENT_MODE=multi    # any number of tenants, each with its own domain
```

### 7.1 Come funziona tecnicamente la separazione

Usiamo la **multi-tenancy logica con `tenant_id` su ogni tabella protetta** (database condiviso, schema condiviso). È la via più pragmatica:

- **Un** database PostgreSQL, **uno** schema, **un** bucket S3.
- Ogni tabella (eccetto `tenants` stessa e `billing_plans`) ha una colonna `tenant_id`.
- L'API impone un filtro su `tenant_id` su **ogni** query (un livello middleware, non un WHERE "dimenticabile").
- Le chiavi di archiviazione in S3 hanno un prefisso per tenant: `t/<tenant_uuid>/files/<file_id>/...`. In questo modo un tenant può essere completamente eliminato con `aws s3 rm --recursive` se necessario.

**Vantaggio rispetto a "schema per tenant" o "DB per tenant":** migrazioni semplici, un solo connection pool, gestione operativa semplice. **Svantaggio:** nessun isolamento rigido a livello di DB — da qui il rigoroso middleware API. Per clienti con requisiti di compliance estremi, un'istanza dedicata per tenant resta comunque la risposta giusta.

### 7.2 Risoluzione del tenant per richiesta

Quale tenant è attivo in un dato momento risulta dalla richiesta (in quest'ordine):

1. **Dominio personalizzato** — `studio-mueller.de` → lookup in `tenants.custom_domain`.
2. **Sottodominio** — `studio-mueller.lumio.example.com` → lookup in `tenants.slug`.
3. **Link galleria** — `/g/<slug>` → la galleria conosce il proprio tenant.
4. **Login studio** — l'ID di sessione è associato a `tenant_id`.
5. **Fallback modo single** — l'unico tenant esistente viene usato automaticamente.

Caddy lo fa in modo trasparente: un certificato wildcard (`LUMIO_WILDCARD_HOST=*.lumio-cloud.de`) tramite il metodo **acme-dns** (un container acme-dns proprio come mediatore DNS, nessuna API key del provider DNS necessaria) più ACME per-dominio per i domini personalizzati. La wildcard è opt-in tramite il profilo Compose `wildcard`.

### 7.3 Isolamento del branding

Ogni tenant ha il proprio profilo `branding` (logo, colori, font, testo del footer, CSS personalizzato opzionale), che può essere ulteriormente sovrascritto per galleria. Nel modo hosted il branding di Lumio può essere mostrato o nascosto in base al piano (piano Free: "Powered by Lumio" visibile, piano Pro: completamente whitelabel).

### 7.4 Passaggio tra modalità

`single` → `multi` è possibile in qualsiasi momento impostando `DEPLOYMENT_MODE=multi` e rifacendo il deploy. Il tenant singolo esistente viene preservato e può continuare a essere usato; i tenant aggiuntivi vengono creati tramite l'interfaccia admin o la CLI.

`multi` → `single` ha senso solo se esiste esattamente un tenant.

---

## 8. Modo hosted — offrire Lumio come servizio

> ⚠️ **Nota sulla licenza:** offrire Lumio come SaaS commerciale a terzi è *Competing Use* secondo la FSL-1.1-ALv2 e richiede una licenza commerciale — farlo girare per la propria organizzazione/agenzia no. Vedi [LICENSE](../LICENSE).

Il modo hosted combina `DEPLOYMENT_MODE=multi` con `BILLING_ENABLED=true`. Con questo puoi gestire Lumio come servizio SaaS autonomo e offrire ai tuoi clienti una variante cloud a pagamento — loro prenotano un piano, tu gestisci l'infrastruttura, loro pagano mensilmente o annualmente.

### 8.1 Sistema dei piani

I piani sono definiti nella tabella `billing_plans`. Ogni piano imposta dei limiti e sblocca funzionalità:

| Campo                | Significato                                                     |
| ------------------- | ------------------------------------------------------------- |
| `storage_gib`       | Archiviazione massima in GiB (NULL = illimitata)                |
| `galleries_max`     | Numero massimo di gallerie attive                              |
| `files_per_gallery` | Numero massimo di file per galleria                             |
| `users_max`         | Numero massimo di membri dello studio                             |
| `bandwidth_gib_per_month` | Limite di traffico, azzerato mensilmente              |
| `custom_domain`     | Booleano — domini personalizzati consentiti?                             |
| `white_label`       | Booleano — il branding Lumio può essere nascosto?                        |
| `watermarking`      | Booleano — funzione watermark                              |
| `analytics`         | Booleano — statistiche dettagliate                            |
| `price_monthly_cents`, `price_yearly_cents`, `currency` | Prezzo                |
| `stripe_price_id_monthly`, `stripe_price_id_yearly`     | Integrazione Stripe      |

I piani effettivamente implementati (fonte: `apps/api/src/services/plans.ts`):

| Piano   | Archiviazione | Gallerie attive | Profili branding | Dominio personalizzato | Team  | Watermark | Prezzo/mese |
| ------ | -------- | --------------- | ---------------- | ------------- | ----- | --------- | ----------- |
| Start  | 150 GB   | 5               | –                | no          | 1     | no      | 9 €         |
| Solo   | 500 GB   | 10              | –                | no          | 1     | no      | 19 €        |
| Studio | 1.000 GB | 50              | 1                | 1             | 1     | sì      | 39 €         |
| Pro    | 3.000 GB | illimitate      | 5                | illimitati    | fino a 3 | sì      | 89 €        |

In più un **trial di 14 giorni** (100 GB, 10 gallerie, accesso completo) e un **add-on di archiviazione** (+50 GB per +9 €/mese). Il pagamento annuale è ~17% più economico (2 mesi gratis).

### 8.2 Integrazione Stripe

Le route di `apps/api` sotto `/api/v1/billing/*` comunicano con Stripe:

- **Sessione di checkout** per i nuovi abbonamenti (carta, SEPA, Apple Pay configurati automaticamente).
- **Customer Portal** per cambio piano, cancellazione, download fatture — Stripe ospita l'interfaccia, noi ci limitiamo a linkarla.
- **Ricevitore webhook** sotto `/api/v1/billing/webhook` elabora `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`. In questo modo lo stato locale di `billing_subscriptions` si sincronizza con Stripe.

Le tasse (DE: 19% IVA, UE: reverse charge, paesi terzi: nessuna IVA) sono gestite interamente tramite Stripe Tax — nessuna logica fiscale propria necessaria.

### 8.3 Applicazione dei limiti

Un job worker periodico (`tasks.billing.update_tenant_usage`, eseguito ogni ora) aggrega l'utilizzo effettivo per tenant e lo scrive in `billing_subscriptions.storage_bytes_used` e `bandwidth_bytes_used`.

Prima di ogni **init di caricamento** l'API verifica se `storage_bytes_used + sum(nuovi file) > plan.storage_gib`. In caso affermativo: HTTP 402 (Payment Required) con un suggerimento di upgrade.

In caso di **superamento della banda** il tenant non viene bloccato duramente (sarebbe ostile verso il cliente se proprio in quel momento è in corso uno shooting), ma gli owner vengono informati via email. Il provider può opzionalmente configurare un throttling a partire dal giorno X in caso di superamento persistente.

In caso di **pagamento fallito** (`status=past_due`) il tenant resta pienamente funzionante per 7 giorni, poi le gallerie vengono impostate su "expired" per i clienti finali (il login dello studio viene preservato in modo che nessuno perda dati). Dopo 30 giorni `unpaid`: sospensione forzata, dopo 90 giorni un avviso di eliminazione imminente.

### 8.4 Add-on basati sull'utilizzo (fase 2)

Tramite la tabella `billing_usage_records` si può aggiungere in seguito una **fatturazione aggiuntiva basata sull'utilizzo** — ad esempio "5 € per ogni 100 GiB aggiuntivi di archiviazione". Stripe Metered Billing accetta i record mensilmente.

### 8.5 Flusso di onboarding in modo multi

Ci sono tre percorsi di onboarding, a seconda della modalità:

1. **Self-host, modo single** (`DEPLOYMENT_MODE=single`, senza Stripe): il tenant di default viene creato automaticamente al primo avvio; serve solo una chiamata `create-admin` per il primo utente.
2. **Self-host, modo multi** (un'agenzia senza billing): il super admin crea i tenant manualmente.
3. **Modo SaaS** (`multi` + `BILLING_ENABLED=true` + Stripe): self-service signup tramite il sito marketing (lumio-cloud.de) — email + password + nome dello studio + sottodominio desiderato, trial di 14 giorni, poi scelta del piano o read-only.

### 8.6 Temi operativi

- I **backup** nel modo hosted sono obbligatori: `pg_dump` giornaliero, il bucket S3 con versioning degli oggetti e replicazione cross-region.
- **Monitoraggio**: analytics **Umami** senza cookie (lo stack incluso sotto `infra/umami`, opt-in via `LUMIO_UMAMI_HOST`); metriche di errori/infrastruttura in base alle necessità (ad es. Sentry/Prometheus).
- **Canale di supporto**: Helpscout, Crisp o semplicemente email. Invia il tenant ID insieme a ogni richiesta.
- **SLA**: per i clienti paganti prometti almeno il 99,5% di uptime; le interruzioni vengono tracciate in `events` e specchiate su una status page.

### 8.7 Quando lasciare disattivato il modo hosted?

Se **fai solo self-hosting** del software (modo single o multi senza vendita): `BILLING_ENABLED=false`. In questo caso le tabelle di billing esistono, ma nessun limite viene applicato e nessun webhook Stripe è attivo. Tutte le funzionalità sono sbloccate per tutti i tenant.

---

## 9. Sicurezza & privacy

Poiché il gruppo target è composto da professionisti con NDA, questo non è un "extra", ma il nucleo.

- I **token della galleria** sono crittograficamente casuali (32 byte) e non indovinabili.
- **Protezione con password** con Argon2id.
- **URL firmati** per ogni accesso S3, con validità breve (ad es. 60 minuti).
- **Rate limiting** su login, accesso alla galleria, commenti (ad es. via `@fastify/rate-limit`).
- **HTTPS ovunque** — Caddy lo fa automaticamente.
- Cookie di sessione **HTTPOnly + SameSite=Strict**.
- Header **CSP** per il frontend.
- **Rimozione EXIF** per le renditions web opzionale (dati GPS fuori).
- **Modo watermark** quando i download sono bloccati — anche l'elemento del browser è protetto da "salva immagine" con `pointer-events` e un overlay CSS (non una vera protezione DRM, ma un ostacolo).
- **Audit log** per: login, creazione galleria, link di condivisione generato, file eliminato, download.
- **Strumenti GDPR**: "elimina automaticamente una galleria dopo X giorni", "esporta tutti i commenti dei clienti", "diritto alla cancellazione" implementabile.
- **Residenza dei dati**: self-hosted — decidi tu dove vivono i dati (server proprio, Hetzner, AWS Francoforte, Wasabi…).

---

## 10. Deployment — Docker Compose

Lo stack viene eseguito tramite **più file Compose componibili**. La base (`docker-compose.yml`) compila le immagini in locale; gli override attivano i mattoncini di produzione o opzionali:

| File | Scopo |
| ----- | ----- |
| `docker-compose.yml` | Base: caddy, frontend, api, worker, postgres, redis, minio (build locale) |
| `docker-compose.prod.yml` | Sostituisce i blocchi `build:` con immagini precompilate dalla **Forgejo container registry** (`forgejo.thiel.tools/thiel/lumio-{api,frontend,worker}:${LUMIO_TAG}`) |
| `docker-compose.ml.yml` | Un worker ML aggiuntivo per il tagging AI (CPU) |
| `docker-compose.gpu.yml` | Accelerazione GPU (NVIDIA) per transcoding/ML |
| `docker-compose.worker.yml` | Un nodo worker puro per la scalabilità orizzontale (server proprio) |

**Self-hosting (modo single), il caso più semplice:**

```bash
cp .env.example .env      # set secrets (S3 keys, DB password, JWT_SECRET …)
docker compose up -d      # acme-dns is profile-gated and stays off
```

Questo fa girare tutto su un unico host incluso MinIO; `DEPLOYMENT_MODE=single` crea il tenant di default al primo avvio.

**Operatività SaaS in produzione (riferimento: lumio-cloud.de):** il TLS wildcard per i sottodomini dei tenant richiede il profilo `wildcard` (altrimenti acme-dns non si avvia e il certificato wildcard si rompe):

```bash
cd /opt/docker/lumio/lumio && git pull && \
  docker compose --profile wildcard \
    -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.ml.yml \
    up -d --build
```

**Scalabilità orizzontale:** i worker possono essere scaricati su nodi aggiuntivi. Il server principale e i nodi worker si trovano in una rete privata (Hetzner Private Network); Redis è protetto da password e si aggancia solo all'IP interno. Un nodo worker si distribuisce con `docker-compose.worker.yml` + un proprio `.env.worker`; Celery si mette in cluster automaticamente. Importante: `apps/frontend` e `apps/api` riguardano solo il server principale, le modifiche ad `apps/worker` riguardano tutti i nodi (i nodi sempre **dopo** il server principale a causa delle migrazioni DB). Dettagli: `docs/SCALING.md`.

**Reverse proxy:** Caddy serve i domini dell'app (studio + wildcard) e i siti marketing tramite blocchi separati (configurazione sotto `infra/caddy/Caddyfile`, controllata via `LUMIO_WILDCARD_HOST`).

**Hardware di riferimento (prod):** Hetzner CCX a Falkenstein (fsn1), 12 vCPU / 24 GB RAM / 480 GB, Hetzner Object Storage al posto di MinIO.

**Hardware minimo consigliato (self-host):**
- 4 vCPU, 8 GB RAM (un piccolo studio, ~50 GB/mese di traffico)
- 8 vCPU, 16 GB RAM (più caricamenti paralleli, tagging AI attivo)
- GPU opzionale, un'accelerazione significativa per video 4K e tagging ML

## 11. Ottimizzazioni delle prestazioni

Dove Picdrop sembra "veloce" — e come lo riproduciamo:

| Leva                              | Implementazione                                                             |
| ---------------------------------- | --------------------------------------------------------------------------- |
| Caricamento diretto verso S3                | URL presigned, il backend non nel flusso dati                                 |
| Griglia virtualizzata               | Vengono renderizzate solo le thumbnail visibili (`react-window`)                  |
| `srcset` / immagini responsive        | Il browser recupera la dimensione adatta al viewport                                     |
| AVIF/WebP invece di JPEG               | File 30–50% più piccoli a parità di qualità                              |
| HTTP/3 (QUIC)                      | Più stream paralleli senza head-of-line blocking                        |
| Caching HTTP aggressivo            | `Cache-Control: public, immutable, max-age=31536000` per le renditions (hash nel percorso) |
| Pronto per CDN                          | Asset statici + renditions sono cacheable; è possibile anteporre una CDN Cloudflare/Bunny |
| Prefetching                        | Le immagini successive/precedenti nella lightbox vengono precaricate                       |
| libvips invece di ImageMagick          | 4–8× più veloce sulle thumbnail                                               |
| Multi-worker                       | Worker Celery scalabili orizzontalmente                                         |
| Connection pooling                 | pgBouncer opzionale con molte visualizzazioni simultanee della galleria               |

---

## 12. Repo, release & licenza

- **Struttura del repo**: monorepo (pnpm workspaces) — `apps/frontend`, `apps/api`, `apps/worker` (Python/Celery), `apps/lightroom-plugin`, `apps/capture-one-plugin`, `packages/shared` (tipi condivisi).
- **Tre repository**: codice dell'app (`lumio.git`) più due siti marketing in Astro — `lumio-cloud-de.git` (SaaS + sign-up + Stripe) e `lumio-app-de.git` (il pitch per il self-host).
- **Hosting**: **Forgejo** (`forgejo.thiel.tools/thiel/*`) è primario; **GitHub** funge da mirror pubblico in push.
- **Licenza**: **FSL-1.1-ALv2** (Functional Source License) — source-available. Vieta l'hosting SaaS concorrente (*Competing Use*), ma si converte automaticamente in Apache 2.0 due anni dopo ogni release. Licenza commerciale per offerte hosted/concorrenti su richiesta.
- **Immagini/CI**: le immagini container vivono nella **Forgejo container registry**; deployment tramite `git pull` + `docker compose … up -d --build`.
- **Documentazione**: nel repo sotto `docs/` (tra gli altri `STORAGE.md`, `SCALING.md`, `SAAS_MODE.md`).
- **Demo/lancio**: prima il self-host (r/selfhosted, awesome-selfhosted, Hacker News, Mastodon) — comunicato come *source-available*, non "open source". GDPR / "i dati restano in Germania" come differenziatore centrale.

## 13. Cosa sa fare Picdrop che deliberatamente tralasciamo (almeno all'inizio)

- Ricerca globale su tutte le gallerie di un'agenzia ("DAM-light") — fase 2/3.
- Integrazione con storage cloud (Dropbox, Drive) — il self-hosted non ne ha bisogno con la stessa urgenza.
- La logica di abbonamento a pagamento è disattivata in modo self-host (`BILLING_ENABLED=false`); attiva via Stripe per la propria variante cloud. (Il **print shop** per la vendita di immagini è stato nel frattempo costruito e non è più escluso.)
- Gestione dei permessi complessa con un centinaio di ruoli — restiamo a: owner, membro del team, ospite della galleria.

---

## 14. Rischi & domande aperte

1. **Compatibilità RAW delle nuove fotocamere.** LibRaw è mantenuto attivamente, ma le fotocamere nuovissime (ad es. la Sony α1 II appena uscita) a volte richiedono aggiornamenti. Strategia: ricompilare regolarmente l'immagine worker, estrarre automaticamente CR3/ecc. con `exiftool` come anteprima di fallback.
2. **Situazione brevettuale HEIC/HEIF** — libheif è OSS, ma l'encoder/decoder HEVC può essere nascosto in alcune distribuzioni. Testare nell'immagine Docker prima del rilascio.
3. **Casi speciali Adobe DNG** — LibRaw gestisce il bilanciamento del bianco DNG diversamente da dcraw, il che può portare ad anteprime visibilmente diverse — di solito accettabile per le gallerie, ma va documentato.
4. **Caricamento mobile di RAW di grandi dimensioni da iPhone** — Safari ha limiti di caricamento, eventualmente considerare il protocollo Tus (upload ripristinabili) invece del multipart semplice.
5. **Scalabilità con gallerie enormi (10.000+ immagini)** — paginazione + scrolling virtuale sono pianificati, ma devono seguire test di carico.
6. **L'angolo "concorrenza con Picdrop"** — Picdrop è uno strumento affermato. Differenziazione: self-hosted, source-available, i dati restano in Germania/UE, nessun lock-in, adatto a NDA. Non "uccidere Picdrop", ma colmare una lacuna.

---

## 15. Stato & prossimi passi

L'MVP originale (le sezioni sottostanti) è completamente distribuito e in produzione, così come gran parte delle ex funzionalità di fase 2/3 (multi-tenancy, billing, 2FA/passkey, print shop, tagging AI, plugin, i18n DE/EN, scalabilità multi-nodo).

**Punti aperti:**

1. Mantenere pulito il **mirror GitHub** (si sincronizza da Forgejo).
2. **Bootstrap Stripe** per i nuovi piani SaaS (`docker compose exec api npm run stripe-bootstrap`) — solo modo SaaS.
3. Far revisionare da un legale i **testi legali** (DPA/Art. 28 GDPR, termini, privacy); impostare gli URL di impronta/privacy nell'env di lumio-cloud.de.
4. Attivare **Umami analytics** (record A `stats.lumio-cloud.de`, `LUMIO_UMAMI_HOST`).
5. Finalizzare il **plugin Capture One**.
6. **Altre lingue** (FR/ES/IT) secondo necessità.
7. **Lancio** della variante self-host (community) + un'istanza demo pubblica.

## Appendice: librerie & strumenti importanti

- **Elaborazione immagini**: libvips (via pyvips), Pillow, libheif; imageio come ponte
- **RAW**: rawpy (wrapper LibRaw), exiftool (metadati)
- **Video**: ffmpeg (HLS/transcoding)
- **Backend**: Fastify, Zod, **Prisma** (PostgreSQL), ioredis, Stripe, argon2 (auth propria per sessioni/2FA/passkey)
- **Worker**: Python, **Celery** (broker Redis), boto3, un'immagine ML separata per il tagging AI
- **Frontend**: **Next.js 16**, **React 19**, Tailwind CSS, TanStack Query; siti marketing in **Astro**
- **DevOps**: Docker Compose, Caddy (+ acme-dns per il TLS wildcard), Forgejo (codice + container registry, mirror GitHub), **Umami** (analytics senza cookie)
- **i18n**: un sistema di dizionario leggero proprio (`apps/frontend/src/lib/i18n`, DE/EN)
- **Testing**: Vitest, Playwright (E2E), pytest (worker)

---

*Fine del concetto.*
