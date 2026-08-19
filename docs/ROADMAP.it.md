[English](ROADMAP.md) · [Deutsch](ROADMAP.de.md) · **Italiano**

# Lumio — Roadmap

Aggiornato a: giugno 2026. Un documento vivo — le priorità possono cambiare. Il nucleo dell'app è pronto ed è in produzione; la variante SaaS è live su lumio-cloud.de.

---

## Fase 0 — Skeleton & infrastruttura ✅

- [x] Struttura monorepo (apps/api, apps/frontend, apps/worker, packages/shared)
- [x] Stack Docker Compose con Postgres, Redis, MinIO, Caddy
- [x] Schema Prisma (modello dati completo incl. multi-tenancy + billing)
- [x] API skeleton con Fastify + endpoint di health
- [x] Worker skeleton con Celery + helper di archiviazione
- [x] Frontend skeleton con Next.js + Tailwind
- [x] Documento di concept
- [x] Pipeline CI (Forgejo Actions) — lint, build, test
- [x] Immagini container automaticamente nel container registry (Forgejo, con override `docker-compose.prod.yml` e pin `LUMIO_TAG`)
- [x] TLS wildcard per i sottodomini dei tenant via acme-dns (profilo Compose `wildcard`; vedi docs/WILDCARD.md)
- [x] Scalabilità orizzontale dei worker su più nodi (Hetzner Private Network, Redis protetto da password; vedi docs/SCALING.md)

---

## Fase 1 — MVP (sprint 1–4)

**Obiettivo:** un'applicazione di gallerie funzionante con caricamento, visualizzazione, like, download.

### Sprint 1 — Auth & tenancy

- [x] Auto-bootstrap del tenant in modalità single (il primo avvio crea un tenant predefinito)
- [x] Registrazione utente + login (email + password, Argon2)
- [x] Gestione delle sessioni con cookie HTTPOnly
- [x] CLI: `npm run create-admin`
- [x] Middleware di risoluzione del tenant (dominio/sottodominio/slug)

### Sprint 2 — Pipeline di caricamento ✅ (per lo più)

- [x] Creazione di una galleria via API
- [x] Browser → S3 presigned PUT con supporto multipart
- [x] Worker: process_file per JPEG/PNG/WebP/TIFF/HEIC (rendition thumb/preview/web con libvips)
- [x] Studio UI: elenco gallerie, dialog di creazione, pagina di dettaglio con caricamento drag & drop
- [x] Coda dei job basata su stream (Redis streams) tra API e worker
- [x] Aggiornamento di stato basato su polling nel frontend (ogni 2s durante l'elaborazione)
- [x] Push WebSocket per lo stato dei file (sostituisce il polling a 2s nello studio con /ws/galleries/:id; il polling resta come fallback a 10s)
- [x] Test worker: far passare realmente un'immagine end-to-end
      (test di integrazione con testcontainers, viene eseguito in CI con i servizi Postgres+MinIO)

### Sprint 3 — Galleria cliente ✅ (per lo più)

- [x] Route slug della galleria `/g/[slug]` con branding
- [x] Protezione con password
- [x] Vista a griglia (griglia standard, masonry virtualizzato arriva nella fase 2)
- [x] Lightbox con navigazione da tastiera + touch + filtri
- [x] Like / tag colore (UI di valutazione a stelle arriva nella fase 2)
- [x] Ottimizzazione touch mobile (tutti i tap target ≥36px)
- [x] Gestione dei link di condivisione nello studio incl. token e permessi
- [x] Sessione visitatore tramite cookie HMAC invece di un token in ogni URL

### Sprint 4 — Download & proofing ✅

- [x] Download di singolo file via URL presigned
- [x] Commenti per immagine
- [x] Panoramica studio: quali file sono stati selezionati? (`/galleries/:id/proofing/summary`)
- [x] Builder ZIP in streaming (task worker build_zip con S3 multipart)
- [x] Rendition con watermark (quando il download è disattivato)
- [x] Export CSV della selezione
- [x] **Export XMP sidecar per Lightroom Classic / Capture One**
- [x] Studio UI per il riepilogo proofing con statistiche + tabella per-accesso + elenco file
- [x] Notifiche email (nuovo commento)
- [x] Pulsante di completamento selezione per il cliente con notifica email
- [x] Notifica ZIP della selezione al cliente (notifica lazy al primo poll pronto)
- [x] UI di caricamento immagine watermark nello studio (PUT presigned direttamente su S3)

---

## Fase 2 — Funzionalità Pro (sprint 5–8)

### RAW & video ✅ (per lo più)

- [x] Worker: process_raw con rawpy — anteprima JPEG incorporata come fast path,
      fallback al demosaicing completo (use_camera_wb=True),
      poi la stessa pipeline libvips usata per le immagini standard
- [x] Worker: process_video con ffmpeg → poster + HLS adaptive bitrate
      (480p/720p/1080p, nessun upscaling) + sprite sheet per lo scrubbing
- [x] API: route proxy HLS (`/g/:slug/files/:id/hls/...`) così le playlist
      con percorsi di segmento relativi funzionano senza rendere pubblico il bucket
- [x] Frontend: player video hls.js con fallback HLS nativo Safari
- [x] Frontend: indicatori video e RAW nella griglia (icona play, badge RAW)
- [x] Test worker (pytest, 6 verdi) per la selezione delle varianti HLS e il parsing dei kbps
- [x] Usare l'anteprima di scrubbing video nel player (lo sprite sheet c'è già; passando sopra la barra di avanzamento appare una miniatura del frame con tooltip del tempo)
- [x] Accelerazione HW opzionale (NVENC/QSV/VAAPI via LUMIO_HW_ENCODER, fallback su libx264; vedi DEVELOPMENT.md)
- [x] HEIC/HEIF nell'API come rilevamento di tipo proprio (variante `"heic"` dedicata, badge del formato nello studio + tile cliente, suggerimento Windows nel download dal lightbox)
- [x] Download web del video come MP4 standalone (nuova rendition `video_mp4`: 1080p o risoluzione sorgente, +faststart, encoder via select_encoder()/profile_for(); adattati sia il download singolo cliente che il builder ZIP; task di backfill `backfill_video_mp4` per lo stock esistente per galleria o globalmente)
- [x] Estrazione anteprima PSD (composite via Pillow, `apps/worker/psd.py`; libvips non può leggere i PSD direttamente)

### Branding & whitelabel ✅ (fase 1)

- [x] Editor di branding nello studio (logo, favicon, colori, font, testi, CSS personalizzato)
- [x] Override del branding per galleria (con fallback al default del tenant)
- [x] Inserimento dominio personalizzato nelle impostazioni del tenant
- [x] Resolver di branding con URL GET presigned per gli asset (cache di 24h)
- [ ] TLS automatico per i domini personalizzati (attualmente: Caddy deve essere configurato manualmente)
- [ ] Verifica DNS (challenge tramite record TXT)

### Multi-tenancy & billing (modalità hosted) ✅

Completamente implementato — dettagli nella fase 5.

- [x] Definizioni dei piani (`services/plans.ts`) + migrazione seed
- [x] Integrazione Stripe: checkout, webhook, customer portal (`routes/billing.ts`)
- [x] Cronjob di tracciamento utilizzo (`worker/tasks/billing.py`, archiviazione + banda)
- [x] Applicazione dei limiti su caricamento + galleria/dominio personalizzato/branding
- [x] Registrazione self-service del tenant (`routes/signup.ts`)

### Collaborazione

- [ ] Voto di gruppo (più persone per token di accesso)
- [ ] Cursore live nel lightbox (fanout WebSocket)
- [x] Scarabocchi/annotazioni sull'immagine (`AnnotationOverlay.tsx` + campo schema `annotation`, nella galleria cliente e nel proofing dello studio)
- [x] Limite di selezione ("il cliente può scegliere al massimo N") — impostazione della galleria nello studio, contatore "X di Y" nell'hero del cliente, rollback dell'optimistic update in caso di violazione del limite con un toast
- [x] Sincronizzazione in tempo reale della selezione tra studio e cliente (lo studio riceve toast live sui cambi di selezione, commenti e finalizzazione via WebSocket; il lato cliente resta single-user come Picdrop)

### Workflow

- [x] Export XMP sidecar (compatibile Lightroom/Capture One)
- [x] Azioni bulk nello studio: multi-selezione + eliminazione + hide/show + ordinamento drag & drop (touch + tastiera via @dnd-kit)
- [x] Template/preset di galleria (modalità/toggle/branding/scadenza/descrizione predefinita)
- [x] Notifiche email (selezione completata, nuovo commento)
- [x] Modalità presentazione (slideshow a schermo intero con avanzamento automatico, cross-fade, intervallo regolabile)

---

## Fase 3 — Rifinitura & crescita

- [x] Plugin Lightroom Classic (Lua) — porta la selezione direttamente nel catalogo (`apps/lightroom-plugin/`)
- [x] Plugin Capture One (AppleScript + CLI Python per macOS, rispecchia la selezione nel catalogo/sessione attivi; mantiene la stessa API `/api/v1/plugin/*` del plugin Lightroom)
- [x] Studio e pagina cliente multilingue (DE, EN — altre lingue seguiranno tramite il sistema di dizionari i18n; un selettore di lingua in galleria per i visitatori è ancora da fare)
- [ ] App mobile (React Native) per iOS/Android — caricamento dal rullino fotografico
- [ ] API pubblica con OAuth2
- [x] Webhook per gli eventi dello studio (firmati HMAC-SHA256, consegna asincrona con retry a backoff esponenziale, UI /studio/webhooks con pulsante di test e log di consegna)
- [x] Statistiche dettagliate della galleria (visualizzazioni negli ultimi 30 giorni, ripartizione per accesso con visite/like/commenti/stato finalizzato, file principali per like, download per tipo; `/studio/[id]/stats` con sparkline SVG)
- [x] Tagging AI opzionale — **CLIP** in locale sul server (nessuna chiamata API esterna), opt-in tramite l'immagine ML worker (`docker-compose.ml.yml`, CPU/GPU), soglia via `LUMIO_CLIP_THRESHOLD`; vedi docs/ML.md
- [ ] Firme elettroniche per contratti modella/modello e liberatorie sui diritti
- [x] Print shop / vendita immagini — prodotti/varianti/spedizione/fornitori, ritaglio, carrello, checkout Stripe (Stripe Connect), conferma d'ordine + email (`services/print/*`, `routes/print-shop-public.ts`)
- [x] 2FA per il login allo studio: TOTP (otplib + 8 codici di backup) + WebAuthn/passkey (@simplewebauthn, Touch ID/Windows Hello/chiavi di sicurezza, più credenziali per utente)
- [x] Visualizzatore audit log nello studio (strumentato: login/logout, CRUD galleria, eliminazione/bulk file, creazione/eliminazione/sblocco condivisione, selection.finalize, CRUD branding; /studio/audit con filtri galleria/azione/tempo + export CSV lato client; export CSV lato server per log di grandi dimensioni ancora da fare)

---

## Fase 4 — Enterprise / DAM-light

- [x] Ricerca globale su tutte le gallerie di un tenant (command palette Cmd/Ctrl+K con ricerca live su gallerie, file, branding, template; backend ILIKE, 4 query parallele in un solo roundtrip)
- [x] Sistema di tag con gerarchia (tag a livello di tenant con relazione parent, colore, assegnazione alla galleria con filtro AND nell'elenco, componente TagPicker con chip inline; API file-tag pronta, la UI seguirà con le azioni bulk sui file)
- [x] Super admin & gestione multi-tenant (area di login `/super`, tabella super_admins + sessioni dedicate, CRUD tenant con owner iniziale + email di setup, ciclo di vita suspend/reactivate/archive, guardie di stato del tenant nei percorsi di login + cliente, flusso di impostazione password per gli owner invitati)
- [x] Design dell'header della galleria (immagine hero dalla galleria o caricata, colore overlay, colore di sfondo come fallback, logo evento per galleria, markdown di benvenuto con react-markdown, meta tag OG per le anteprime di condivisione su WhatsApp/iMessage/Slack, pulsante Web Share API con fallback negli appunti)
- [x] Footer della galleria + colori della galleria (footerMarkdown per galleria, colorBackground e colorAccent come override del branding del tenant, calcolo automatico del colore del testo via luminanza WCAG)
- [x] Varianti di layout hero (quattro varianti: Minimal, Splash con schermo intero + scroll hint, Side-by-side editoriale, Centered in stile rivista — campi condivisi, cambia solo la disposizione del rendering)
- [x] Font della galleria (titolo + corpo selezionabili separatamente da un elenco curato di 8 font — 4 sans + 4 serif, conformi al GDPR via Bunny Fonts CDN, anteprima live nello studio)
- [x] Varianti di layout a griglia (masonry/justified/equal — solo CSS, nessun layout JS)
- [x] Espansione dello slideshow (tre effetti di transizione: fade/slide/Ken Burns con 4 direzioni di pan, rispetta prefers-reduced-motion)
- [x] Musica di sottofondo per lo slideshow (caricamento audio per galleria MP3/AAC/OGG max 30 MB, auto-play nello slideshow grazie al gesto dell'utente, loop, slider del volume con persistenza in localStorage)
- [x] Capitoli/sezioni della galleria (livello di raggruppamento opzionale, i file mantengono il comportamento del bucket predefinito quando non c'è una sezione, la vista cliente ottiene navigazione con ancore sticky + fasce divisorie con immagine di copertina opzionale, editor dello studio con riordino + selettore bulk dei file)
- [x] Smart collection / filtri salvati (macro di filtro interne allo studio analoghe a Lightroom: modalità + stato + tag collegati con AND, salvati per utente per tenant, accesso rapido dalla sidebar + pagina di modifica dedicata, filtri ad-hoc via query param a /galleries, filtri persistiti via CRUD /collections; intervallo di date preparato nel backend, il datepicker frontend seguirà)
- [ ] Workflow di approvazione (più revisori in sequenza)
- [ ] SSO (SAML, OIDC)
- [ ] Log delle attività con export per la conformità
- [ ] Permessi per cartella

---

## Fase 5 — Variante Cloud (estensione SaaS)

**Obiettivo:** Lumio come servizio gestito su `lumio-cloud.de` con iscrizione self-service e fatturazione automatica. Il nucleo dell'app resta source-available (FSL) e self-hostable — questa fase riguarda solo il livello di servizio hosted che ci sta sopra. **Stato: live su lumio-cloud.de.**

### Modello dei piani & limiti ✅ (commit `e15c5bc`)

- [x] Definizioni dei piani (Start €9, Solo €19, Studio €39, Pro €89; + trial di 14 giorni)
      come modulo centrale in `services/plans.ts`
- [x] Aggregazione live dell'utilizzo di archiviazione senza drift dei contatori
- [x] Applicazione dei limiti nelle route esistenti:
      init caricamento, creazione galleria, dominio personalizzato, branding
- [x] Tabella BillingSubscription con storageAddonGib + readOnlySince
- [x] Migrazione che fa il seed dei 3 piani + una subscription Pro automatica per
      i tenant esistenti
- [x] Pagina studio `/studio/billing` con piano + barra archiviazione +
      barra gallerie + panoramica funzionalità + confronto piani
- [x] Banner di archiviazione in cima a ogni pagina dello studio oltre l'80% di archiviazione,
      fine trial <3 giorni o modalità sola lettura
- [x] Dialog 402 al caricamento con link alla pagina dei piani
- [x] Feature gate: impostazioni di dominio personalizzato + branding disabilitate
      e con un suggerimento sul piano quando non coperte
- [x] Controllato tramite la env `BILLING_ENABLED` — il self-hosted senza billing
      funziona del tutto invariato

### Separazione dei domini app ↔ marketing

- [x] Punti del codice app con `lumio-cloud.de` hardcoded passati a
      `studio.lumio-cloud.de` (default plugin Lightroom e
      Capture One, esempi nel README, commenti nel codice)
- [x] Documentazione Caddy sul nuovo dominio. Più una nota che i siti
      marketing vivono nei propri repo.
- [x] MULTI_TENANT.md: riferimenti dell'app a studio.lumio-cloud.de,
      i sottodomini dei tenant restano deliberatamente su `*.lumio-cloud.de`
      (il wildcard DNS è separato dalla root del sito marketing)
- [x] DNS: `studio.lumio-cloud.de` punta al server dell'app
- [x] Caddy serve il dominio dell'app + il wildcard `*.lumio-cloud.de`
- [x] Questione dei sottodomini dei tenant decisa: `<slug>.lumio-cloud.de`
      via il wildcard acme-dns

### Integrazione Stripe ✅

Implementata in `routes/billing.ts` + `services/stripe-service.ts`/`stripe-client.ts`:

- [x] `POST /billing/subscription` — sessione di checkout con trial di 14 giorni
- [x] `POST /billing/portal` — customer portal (carta/piano/cancellazione)
- [x] `POST /billing/webhook` — verificato tramite firma; elabora
      `checkout.session.completed`, `customer.subscription.updated/deleted`,
      `invoice.payment_succeeded/failed`
- [x] `/billing/plans`, `/billing/usage`, route di riattivazione
- [x] Add-on di archiviazione + metodi di pagamento (via Stripe)
- [ ] Operativamente per ogni deployment: bootstrap di prodotti/prezzi Stripe
      (`docker compose exec api npm run stripe-bootstrap`)

### Logica di grazia ✅

Costruita una state machine per i tenant `past_due` (`worker/tasks/billing.py`, `plugins/read-only.ts`, campo `readOnlySince`): retry Stripe + solleciti → blocco login → sola lettura → annuncio di eliminazione → hard delete con un'offerta di export dati conforme al GDPR prima della cancellazione.

### Flusso di sign-up ✅

- [x] Autoregistrazione (`routes/signup.ts`: `/signup`,
      `/signup/check-email`, `/signup/check-slug`)
- [x] Tenant + utente owner + subscription trial + customer Stripe in un'unica transazione
- [x] Email di onboarding/setup
- [x] Fine trial → addebito automatico o sola lettura

### Estensioni future (aperte, nessuno sprint pianificato)

- [x] Sconto annuale (~17%: prezzo annuale = 10 prezzi mensili, `priceYearlyCents` in `plans.ts`; toggle annuale nella UI di billing)
- [ ] Variante ad acquisto singolo per le coppie di sposi ("€49 una tantum,
      galleria attiva per 12 mesi") come caso d'uso separato
- [ ] Programma affiliati/partner
- [ ] Open core: separare le funzionalità Pro dal repo FSL
      (es. SSO, account team) in caso di pressione del mercato
- [ ] Opzione di dual-licensing (licenza commerciale su richiesta)
      se emerge un caso d'uso concreto

---

## Non pianificato

Escluso deliberatamente — a meno di richieste forti:

- ❌ Un editor immagini integrato (ritaglio, filtri) — resta nel workflow di Lightroom/Capture One.
- ❌ Gestione complessa dei permessi con decine di ruoli — Lumio resta snello.
