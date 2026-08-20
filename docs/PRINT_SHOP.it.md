[English](PRINT_SHOP.md) · [Deutsch](PRINT_SHOP.de.md) · **Italiano**

# Print shop — provider e adapter

Aggiornato al: 2026-06-04

Questo documento registra lo stato reale del print shop nonché i punti deliberatamente rimandati. Sostituisce la precedente nota generica (e fuorviante) "12 print provider sono NotImplemented".

## Architettura

Il print shop separa in modo netto la logica di Lumio dall'integrazione specifica del laboratorio:

- **Interfaccia adapter** (`apps/api/src/services/print/adapters/base.ts`): ogni provider implementa `validateCredentials`, `fetchCatalog`, `submitOrder`, `getOrderStatus`. Gli adapter sono **stateless** — ricevono credenziali + un oggetto ordine passati come parametro e non hanno accesso proprio al DB. Il livello di servizio verifica accesso/tenant prima che un adapter venga chiamato.
- **Registry dei provider** (`apps/api/src/services/print/providers.ts`): la definizione centrale nel codice di tutti i provider (etichetta, mercato, campi credenziali, stage, istanza adapter). Una voce nel registry **non** significa che il provider sia attivo — lo decide il super admin.
- **Stage**: `production` (live), `beta` (l'API funziona, non ancora rilasciata a tutti), `planned` (stub via `NotImplementedAdapter`), `self_print` (caso speciale).
- **Livello service/order**: `shop.ts`, `orders.ts`, `payment.ts`, `stripe-connect.ts`, `credentials.ts`. Route: `routes/print-shop.ts` (studio) e `routes/print-shop-public.ts` (cliente).

## Stato attuale dei provider

| Provider | Stage | Adapter | Stato |
|---|---|---|---|
| Self print (`manual_self_print`) | self_print | `ManualSelfPrintAdapter` | **Pienamente funzionale.** Gli ordini vengono inoltrati allo studio con l'indirizzo di consegna. Sempre disponibile, nessuna attivazione da super admin necessaria. |
| Prodigi (`prodigi`) | beta | `ProdigiAdapter` | **Completamente implementato** contro Print API v4.0 (creazione ordine, stato/tracking, toggle sandbox). Pronto per la produzione, ma non ancora passato a `production`. |
| Gelato (`gelato`) | beta | `GelatoAdapter` | **Completamente implementato** contro Order Flow API v4 (creazione ordine, stato/tracking; nessuna URL sandbox separata). Pronto per la produzione, ma `beta`. |
| WhiteWall, Saal Digital, CEWE Pro, ProfiLab, myposter, Pixum, Posterlounge, Albelli, Lalalab, MPIX, Bonusprint | planned | `NotImplementedAdapter` | Stub. Vedi "Perché i lab planned sono bloccati". |

Insieme, Gelato e Prodigi coprono la gamma rilevante (stampe, poster, tele, cornici, fotolibri) con una produzione densa in ambito EU/DE. Per un'offerta di stampa funzionante questi due più self print sono sufficienti.

## Perché i lab `planned` sono bloccati

I laboratori consumer tedeschi/UE/USA (WhiteWall, Saal, CEWE, Pixum, myposter, ecc.) quasi tutti **non hanno un'API di ordinazione self-service aperta**. Un'integrazione reale richiede:

1. Un account partner/B2B presso il rispettivo laboratorio (attivazione, talvolta un NDA).
2. La loro documentazione API effettiva (di solito dietro un login partner/NDA).
3. Credenziali sandbox per i test.

Questo è un **passaggio di onboarding di business, non una pura questione di coding**. Costruire un adapter contro endpoint indovinati sarebbe codice privo di valore che si rompe in produzione. Questi provider quindi restano deliberatamente come stub finché non è disponibile un accesso partner concreto, documentazione inclusa.

## Attivazione (SaaS vs. self-hosted)

Ci sono **due livelli**:

1. **Feature flag `print_shop`** — sblocca l'area print shop per un tenant.
2. **Attivazione del provider** — quali laboratori vengono offerti a livello di piattaforma.

| | SaaS / multi mode | Self-hosted (single mode) |
|---|---|---|
| Feature flag | UI super admin, per tenant | `FEATURES_ENABLED=print_shop` in `.env` |
| Provider | UI super admin (`/super/print-providers`) | `PRINT_PROVIDERS_ENABLED=prodigi,gelato` in `.env` |

Self print (`manual_self_print`) è sempre disponibile su entrambi i percorsi. Una
voce DB impostata tramite l'UI del super admin ha la precedenza sulle variabili
env — anche per la disattivazione. Dopo aver modificato `.env`: `docker compose up -d api`.
Ogni studio inserisce le proprie credenziali API del laboratorio sotto Print shop → Providers.

## Aggiungere un nuovo provider

1. Una voce nel registry (`providers.ts`): `key`, `label`, `market`, `credentialFields`, `categories`, inizialmente `stage: "planned"` con `new NotImplementedAdapter("<key>")`.
2. Implementa l'adapter sotto `services/print/adapters/<key>.ts` (modello: `prodigi.ts` / `gelato.ts`).
3. Nel registry, sostituisci il `NotImplementedAdapter` con l'adapter reale e imposta lo stage su `beta`.
4. L'attivazione avviene per piattaforma tramite il super admin (`/super/print-providers`); il tenant inserisce le proprie credenziali nello studio.

## Rimandato (TODO, deliberatamente non ora)

- **Gelato/Prodigi `beta` → `production`**: dopo un test con chiavi sandbox/live reali, aumentare lo stage. Una pura modifica al registry.
- **Pre-rendering del crop**: un crop libero impostato dal cliente (`order.items[].crop`) attualmente non viene passato al laboratorio (Gelato/Prodigi ricevono il file completo, Prodigi usa `sizing: "fillPrintArea"`). Più pulito sarebbe: il worker crea una rendition high-res ritagliata a partire dal crop e l'adapter invia la sua URL firmata. La leva di qualità più grande.
- **Import dinamico del catalogo** (`fetchCatalog`): Gelato/Prodigi indirizzano i prodotti tramite SKU/productUid che il fotografo attualmente inserisce manualmente come `providerVariantRef`. Un import automatico è opzionale.
- **Ulteriori laboratori concreti**: solo una volta disponibile l'accesso API partner (account + documentazione + chiave sandbox) per un laboratorio specifico — allora si costruisce in modo mirato quel singolo adapter.
