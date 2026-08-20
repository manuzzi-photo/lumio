[English](SAAS_MODE.md) · [Deutsch](SAAS_MODE.de.md) · **Italiano**

# Modalità SaaS

> ⚠️ **Nota sulla licenza:** L'uso multi-tenant per la **tua organizzazione o
> agenzia** è senza restrizioni. Ma far girare Lumio come **SaaS commerciale
> per terzi paganti** — esattamente ciò che questa guida rende possibile —
> è *Competing Use* e **non** è consentito di default secondo la
> FSL-1.1-ALv2. Serve una licenza commerciale (è il modello di business
> dietro lumio-cloud.de, gestito dallo stesso maintainer). Vedi
> [LICENSE](../LICENSE).

Lumio può funzionare non solo come strumento per un singolo studio, ma anche
come piattaforma SaaS completa: tenant multipli, fatturazione Stripe,
periodi di prova, registrazione autonoma. Questa guida descrive la
configurazione.

**Prerequisito:** il [setup di produzione](SELFHOSTING.it.md) è completato
con successo, Lumio gira sotto il tuo dominio con HTTPS.

---

## Concetto

In modalità SaaS:

- **DEPLOYMENT_MODE=multi** – uno stack Lumio, tanti tenant
- Ogni tenant è uno studio autonomo con proprie gallerie, utenti, branding
- Periodo di prova alla registrazione (14 giorni di accesso completo)
- Stripe si occupa della gestione degli abbonamenti e dei pagamenti
- Il super admin gestisce l'intera piattaforma tramite `/super`

Piani (definizioni aggiornate in `apps/api/src/services/plans.ts`):

| Piano | Archiviazione | Prezzo/mese | Prezzo/anno |
|---|---|---|---|
| Trial | 50 GB | €0 (14 giorni) | – |
| Solo | 50 GB | €19 | €190 (2 mesi gratis) |
| Studio | 250 GB | €39 | €390 |
| Pro | 1 TB | (vedi plans.ts) | (vedi plans.ts) |

Più un **pacchetto di archiviazione** opzionale come componente aggiuntivo
per ogni piano.

---

## Configurazione

### 1. Attiva la modalità multi

In `.env`:

```bash
DEPLOYMENT_MODE=multi
LUMIO_HOST=studio.your-saas-domain.com       # login domain for all tenants
BILLING_ENABLED=true
```

Poi:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build api worker
```

### 2. Prepara l'account Stripe

- Crea un account Stripe (o usane uno esistente)
- Usa la **modalità test** finché tutto non funziona – attiva/disattiva le
  API key in alto nella dashboard tra test/live
- Copia la secret key: Developers → API Keys → Secret key (`sk_test_...` per
  test, `sk_live_...` per produzione)

### 3. Stripe in `.env`

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=                # stays empty for now, comes in step 5
BILLING_CURRENCY=EUR
```

Riavvia l'API:

```bash
docker compose restart api
```

### 4. Crea i piani in Stripe

Lumio include uno script di bootstrap che crea tutti i prodotti e i prezzi
in Stripe e scrive gli ID nel DB di Lumio:

```bash
docker compose exec api npm run stripe-bootstrap
```

L'output dovrebbe essere:
```
[stripe-bootstrap] ✓ Product 'Lumio Solo' synced
[stripe-bootstrap] ✓ Price 'plan_solo_monthly' created (price_xxx)
[stripe-bootstrap] ✓ Price 'plan_solo_yearly' created (price_xxx)
... (for Studio, Pro, storage pack)
```

Nella Stripe Dashboard → Products dovresti ora vedere tre prodotti Lumio.

Lo script è **idempotente** – eseguirlo più volte è sicuro e aggiorna solo
ciò che è cambiato.

### 5. Configura il webhook

Stripe deve informare Lumio quando un pagamento va a buon fine o un
abbonamento viene annullato.

Nella Stripe Dashboard → Developers → Webhooks → Add endpoint:

- **Endpoint URL:** `https://studio.your-saas-domain.com/api/billing/webhook`
- **Eventi:**
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `customer.subscription.trial_will_end`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
  - `checkout.session.completed`

Dopo averlo creato, copia il "Signing secret" (`whsec_...`) → in `.env`:

```bash
STRIPE_WEBHOOK_SECRET=whsec_...
```

Riavvia l'API:

```bash
docker compose restart api
```

Test: nel dettaglio del webhook in Stripe clicca "Send test webhook" →
l'evento dovrebbe comparire nei log dell'API.

### 6. Crea un super admin

```bash
docker compose exec api npm run create-super-admin -- \
  --email=ops@your-saas-domain.com \
  --password=atleast12chars \
  --name="Ops"
```

Password: almeno 12 caratteri.

### 7. Testa la registrazione

Sul sito marketing (se deployato) percorri il flusso di registrazione.
Oppure direttamente:

→ `https://studio.your-saas-domain.com/signup`

Il periodo di prova dovrebbe iniziare subito, senza bisogno di pagamento
Stripe all'avvio del periodo di prova.

Area super admin:

→ `https://studio.your-saas-domain.com/super`

Qui vedi tutti i tenant, gli abbonamenti, l'MRR.

---

## Andare in produzione

Una volta che il setup in modalità test gira stabilmente:

1. In Stripe disattiva "View test data" in alto a sinistra (torna a live)
2. Copia la secret key e la publishable key live
3. In `.env` cambia `sk_test_...` → `sk_live_...` e `pk_test_...` →
   `pk_live_...`
4. **Crea di nuovo il webhook** in modalità live (live e test hanno webhook
   separati)
5. Aggiorna `STRIPE_WEBHOOK_SECRET` con il nuovo signing secret
6. **Esegui di nuovo `stripe-bootstrap`** – crea i prodotti nello Stripe live
   (i prodotti di test restano in modalità test)
7. Riavvia l'API

---

## Routing dei tenant

In modalità multi si pone una domanda importante: come fa Lumio a sapere a
quale tenant appartiene una richiesta?

La risoluzione avviene nell'API in questo ordine:

1. **Utente autenticato** – il cookie di sessione indica il tenant
2. **Header `X-Lumio-Tenant`** – per l'app mobile e i client API
3. **Dominio personalizzato** – `client-photos.com` confrontato con
   `tenants.customDomain`
4. **Sottodominio** – `studio-mueller.your-domain.com` (serve un certificato
   wildcard, vedi [WILDCARD.md](WILDCARD.it.md))

**Consiglio per iniziare:** tutti i tenant accedono tramite
`studio.your-saas-domain.com`. La risoluzione del tenant avviene quindi
tramite l'utente autenticato. Puoi attivare domini personalizzati e
sottodomini più avanti – vedi [MULTI_TENANT.md](MULTI_TENANT.it.md).

---

## Ciclo di vita della prova e dell'abbonamento

- **Registrazione** → vengono creati tenant e utente, la prova ha inizio
  (14 giorni), nessun pagamento
- **La prova scade** → l'utente riceve un banner nell'interfaccia, il
  webhook `trial_will_end` (3 giorni prima) attiva un'email
- **Scelta del piano** → Stripe Checkout, poi il webhook
  `checkout.session.completed` imposta il piano
- **Pagamento fallito** → `invoice.payment_failed` → il tenant passa a
  `past_due`, dopo la logica di retry di Stripe a `suspended`
- **Sospeso** → il login del tenant funziona ancora (per aggiornare il
  piano), ma le gallerie sono di sola lettura
- **Annullamento** → il tenant viene marcato in `tenants.archived`, non
  eliminato immediatamente. L'eliminazione definitiva viene eseguita da uno
  sweeper dopo un periodo di grazia.

Implementazione concreta in `apps/api/src/services/billing.ts` e
`apps/api/src/routes/billing.ts`.

---

## Configurare l'invio email

Per i promemoria di prova, le notifiche di pagamento fallito, gli inviti
alle gallerie, ecc. ti serve SMTP:

```bash
SMTP_HOST=smtp.your-mail.com
SMTP_PORT=587
SMTP_SECURE=false                    # STARTTLS, true for SMTPS on port 465
SMTP_USER=noreply@your-saas-domain.com
SMTP_PASSWORD=...
SMTP_FROM="Lumio <noreply@your-saas-domain.com>"
SMTP_REPLY_TO="Support <support@your-saas-domain.com>"   # optional, see below
SUPPORT_EMAIL=support@your-saas-domain.com               # optional, see below
FEEDBACK_EMAIL=feedback@your-saas-domain.com             # optional, see below
LEAD_ADMIN_EMAIL=ops@your-saas-domain.com
```

**Reply-To:** Se `SMTP_FROM` è un indirizzo no-reply senza una casella di
posta dietro, le risposte rimbalzano. Imposta `SMTP_REPLY_TO` su un
indirizzo monitorato (casella reale o inoltro). Senza, non viene impostato
alcun header Reply-To.

**Indirizzi di contatto nelle email di sistema:** Lumio adatta il testo
delle sue email a ciò che è effettivamente configurato — non promette mai un
canale di risposta che non esiste:

| Configurazione | Cosa dicono le email |
|---|---|
| `SMTP_REPLY_TO` impostato | "Rispondi pure a questa email oppure scrivi a …" |
| solo `SUPPORT_EMAIL` impostato | "Scrivici a …" |
| nessuno dei due | nessun indirizzo di contatto |

`SUPPORT_EMAIL` ricade sull'indirizzo di `SMTP_REPLY_TO` se non impostato,
`FEEDBACK_EMAIL` ricade su `SUPPORT_EMAIL`. Entrambi si aspettano un
indirizzo nudo senza nome visualizzato.

Se `SMTP_HOST` resta vuoto, tutto gira in modalità no-op – le email di prova
non vengono inviate, il resto funziona normalmente.

Provider consigliati: **Postmark** (transazionale, alta deliverability),
**Mailjet** (server UE, GDPR), **SES** (economico, legato ad AWS).

---

## Errori comuni

→ vedi [TROUBLESHOOTING.md – problemi in modalità SaaS](TROUBLESHOOTING.it.md#problemi-in-modalità-saas)
