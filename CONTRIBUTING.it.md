[English](CONTRIBUTING.md) · [Deutsch](CONTRIBUTING.de.md) · **Italiano**

# Contribuire a Lumio

Grazie per voler contribuire!

## Avvio rapido

1. Leggi un issue o aprine uno nuovo prima di lavorare a modifiche più grandi.
2. Fai un fork del repo, nuovo branch (`feat/your-feature` o `fix/your-fix`).
3. `cp .env.example .env`, `docker compose up -d` — vedi [docs/DEVELOPMENT.md](docs/DEVELOPMENT.it.md).
4. Scrivi codice, aggiungi test dove ha senso.
5. Pull request con una descrizione chiara.

## Cosa ci piace vedere

- **Bug fix** con un caso di test riproducibile
- **Miglioramenti di performance** con misurazioni prima/dopo
- **Traduzioni** — vedi [Aggiungere una traduzione](#aggiungere-una-traduzione)
- **Documentazione** — anche piccole correzioni di refusi
- **Test di formati RAW** — se hai una fotocamera insolita, i file di esempio valgono oro

## Convenzioni di codice

- **TypeScript**: strict mode, niente `any` senza giustificazione
- **Python**: PEP 8, type hints, ruff per il linting
- **Commit**: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`)
- **Titoli delle PR**: stessa convenzione dei commit

## Nota sulla licenza

Lumio è sotto la **Functional Source License 1.1 (FSL-1.1-ALv2)** — una licenza *source-available* (non open source OSI). Contribuendo, accetti che il tuo codice venga pubblicato sotto questa licenza.

Se in futuro dovesse essere offerta una dual license commerciale per fork proprietari, ci riserviamo il diritto a un DCO o CLA per contributi significativi — se ne discuterà quando diventerà rilevante in pratica.

## Politica linguistica

**L'inglese è la lingua primaria del progetto. Il tedesco è una traduzione.**

Questo vale per:

- **UI del frontend** — `en.ts` è il dizionario di riferimento. Le nuove chiavi
  vengono aggiunte prima a `en.ts`, poi a `de.ts` e a ogni altra lingua.
  L'inglese è la locale predefinita e il fallback per le chiavi mancanti.
- **Commenti nel codice e identificatori** — i nuovi commenti sono in inglese. I commenti
  tedeschi esistenti vengono riscritti in modo opportunistico quando un file viene
  comunque toccato; nessun commit separato di riscrittura di massa.
- **Messaggi di commit e descrizioni delle PR** — inglese.
- **Documentazione** — l'inglese è il `.md` canonico, il tedesco vive in `*.de.md`.
- **Formattazione dipendente dalla locale** — date, numeri, valute e ordinamento
  seguono la locale *attiva* dell'interfaccia. Non hardcodare mai un identificatore
  di locale come `"de-DE"` in `Intl.*`, `toLocaleDateString`, `toLocaleString` o
  `localeCompare`.

### Eccezioni deliberate

Queste restano tedesco-first, di proposito:

- **Le email transazionali inviate dall'API.** I destinatari sono i *clienti finali*
  di uno studio, non l'operatore dello studio. La loro lingua segue lo studio, non
  il nostro default. Finché non esisterà una locale per tenant, i template in
  `apps/api/src/services/mail*.ts` restano in tedesco — passarli all'inglese
  sarebbe un regresso per ogni studio tedesco esistente.
- **L'accordo sul trattamento dei dati** (`apps/api/src/services/dpa.ts`). È un
  contratto ai sensi dell'Art. 28 GDPR tra due soggetti giuridici tedeschi; la
  versione tedesca è quella vincolante. Una versione inglese può essere *aggiunta*
  in seguito, ma sarebbe una traduzione non vincolante e richiederebbe la revisione
  di un responsabile della protezione dei dati.
- **I siti marketing tedeschi** (`lumio-app.de`, `lumio-cloud.de`). Si rivolgono
  al mercato tedesco e sono repository separati. Solo `lumio-cloud.com` è
  inglese-first.
- Le voci di **`CHANGELOG.md`** sono bilingue, testo tedesco prima, poi un
  separatore `**🇬🇧 English**`. È un vincolo del tooling di release, non
  un'affermazione sulla priorità linguistica.

## Aggiungere una traduzione

Le stringhe dell'UI del frontend vivono come dizionari TypeScript in
`apps/frontend/src/lib/i18n/` — nessun servizio di localizzazione esterno, solo file semplici.

Per aggiungere una nuova lingua (esempio: ceco, `cs`):

1. **Copia `en.ts` in `cs.ts`** in `apps/frontend/src/lib/i18n/` e traduci i
   valori. Mantieni ogni chiave e la struttura di nesting esattamente come in `en.ts` —
   il tipo `Dict` permette solo valori stringa, e le chiavi mancanti ricadono sull'inglese.
2. **Registra la locale in `dict.ts`**: aggiungi l'import, estendi il
   tipo `Locale` (`"en" | "de" | "cs"`) e aggiungi la voce a `dictionaries`.
3. **Aggiungi la locale a `SUPPORTED`** in `apps/frontend/src/lib/i18n.tsx` così che
   il rilevamento via cookie/`navigator.language` la intercetti.
4. **Aggiorna i selettori di lingua.** Alcuni componenti portano l'unione delle
   locale e le etichette leggibili direttamente. Trovali con:
   ```bash
   grep -rn '"en" | "de"' apps/frontend/src
   ```
   (attualmente `components/gallery/GalleryShell.tsx` e
   `app/studio/settings/page.tsx`) e aggiungi lì la tua lingua.
5. **Verifica**: `npx tsc --noEmit` in `apps/frontend` deve passare — il sistema
   di tipi individua chiavi mancanti o in eccesso.

Le traduzioni parziali vanno bene per una prima PR — le chiavi non tradotte
ricadono sull'inglese. Segnala nella PR quali sezioni mancano ancora.

La documentazione (`docs/*.md`) segue una convenzione separata: l'inglese è il
`.md` canonico, il tedesco vive in `*.de.md`. Altre lingue per la documentazione
sono benvenute, ma apri prima un issue così da concordare lo schema dei nomi.

## Codice di condotta

Sii gentile. Sii specifico. Sii paziente. Costruiamo tutto questo nel nostro tempo libero o a margine di altro — il rispetto reciproco lo rende molto più piacevole.

Attacchi personali, discriminazione o spam portano all'esclusione.

## Domande?

Apri un issue o scrivi nella sezione Discussions del repository GitHub.
