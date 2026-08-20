[English](BRAND.md) · [Deutsch](BRAND.de.md) · **Italiano**

# Lumio — Brand

## Il simbolo

Quattro tessere di uguale dimensione su una griglia rigorosa 2×2, tagliate da
un'unica linea retta a 45°. Un contact sheet con un tratto di selezione: la
tessera arancione sta libera, due sono tagliate, una resta intatta.

Una linea retta può tagliare al massimo due tessere in questa griglia — quindi
la divisione non è arbitraria, è l'unica disposizione in cui la tessera
arancione resta intera.

## Colori

| Ruolo  | Hex       | Uso                                             |
|--------|-----------|--------------------------------------------------|
| Ink    | `#12121A` | tessere, wordmark, superfici scure                |
| Accent | `#FF4D2E` | esattamente una tessera, il puntino della i, il descrittore |
| Paper  | `#FAF8F5` | sfondo chiaro, tessere su superfici scure         |

Niente blu, niente violetto, niente gradiente dal blu al viola — quella è la
divisa delle altre app foto self-hosted, ed è il motivo per cui la prima bozza
è stata scartata.

## Tipografia

- **Wordmark: Quicksand SemiBold**, convertita in tracciati. I file del logo
  quindi non caricano alcun webfont. Quicksand viene usata *solo* per la
  wordmark, mai per il testo del corpo.
- **UI e testo: Inter.** Invariata, già in uso in tutti i repo.

## File

`apps/frontend/public/`

| File                   | Scopo                                             |
|------------------------|----------------------------------------------------|
| `favicon.svg`          | simbolo; l'ink segue `prefers-color-scheme`         |
| `favicon-16/32.png`    | fallback per browser più vecchi                     |
| `apple-touch-icon.png` | 180×180, sfondo opaco (iOS non gradisce l'alpha)    |
| `icon-512.png`         | web manifest, PWA                                   |
| `mark.svg`             | solo simbolo                                        |
| `logo.svg`             | simbolo + wordmark, orizzontale                     |
| `logo-inverse.svg`     | lo stesso per superfici scure                       |
| `wordmark.svg`         | solo wordmark                                       |

`brand/` — sorgenti, non serviti

| File                   | Scopo                                        |
|------------------------|-----------------------------------------------|
| `logo-cloud.svg`       | lockup impilato con `CLOUD`                    |
| `logo-selfhosted.svg`  | lockup impilato con `SELF-HOSTED`              |
| `mark-mono.svg`        | monocolore, per timbri e usi a qualità fax    |
| `mark-inverse.svg`     | tessere chiare                                 |

## Nel codice

`Logo` da `@/components/ui`, varianti `mark` e `full`:

```tsx
<Logo variant="full" className="h-6 w-auto" />
```

L'ink segue `currentColor`; l'accent segue `--logo-accent`, che è legato a
`--brand-accent`. Quindi dove il simbolo sostituisce un logo di studio
mancante, porta il colore di accento di quello studio. Su una superficie
scura, basta impostare un colore di testo chiaro — nessun secondo file
necessario.

I file statici sotto `public/` (`favicon.svg`, `logo.svg`, le immagini OG)
mantengono il vermiglio fisso. Quelli sono Lumio come prodotto, non del
tenant.

## Testo su superfici arancioni

Le etichette su vermiglio sono **paper `#FAF8F5`**, non ink. Questa è una
deviazione deliberata da WCAG 2, e nasce dalla misurazione:

| Su `#FF4D2E` | WCAG 2 | APCA |
|---|---|---|
| Ink `#12121A` | 5.64 | Lc +44 — solo testo grande |
| Paper `#FAF8F5` | 3.12 | Lc −60 — va bene per il testo del corpo |

APCA è l'algoritmo successore a derivazione percettiva ed è notevolmente più
accurato per colori saturi a luminosità media. WCAG 2 sovrastima
sistematicamente il testo scuro su riempimenti saturi; su uno schermo reale,
paper si legge chiaramente meglio.

La regola che ne consegue: le etichette su superfici arancioni mai sotto i
14 px e almeno `font-weight: 600`.

**Se WCAG 2.1 AA deve essere formalmente dichiarato** — EN 301 549 e la
normativa tedesca BFSG fanno riferimento a WCAG 2, non ad APCA — il rimedio è
*un'unica* modifica in *un unico* punto: scurire l'accent a `#C93214`, incluso
il simbolo, i favicon e le immagini OG. Questo mantiene un tono unico con
entrambi gli algoritmi verdi. Due arance distinte sono state testate e
respinte: simbolo e bottone affiancati nell'header si leggevano come un
errore.

## Regole

- Esattamente **una** tessera porta l'accent. Mai due, mai tutte e quattro.
- Il taglio resta un'unica linea retta continua. Non piegarlo, non
  specchiarlo, non centrarlo.
- L'interno delle tessere resta vuoto. Nessun simbolo, nessuna lettera lì
  dentro.
- Dimensione minima 16 px. Non usarlo sotto quella soglia.
- Lascia almeno la larghezza di una tessera di spazio libero intorno al logo.
- Su uno sfondo movimentato (una foto), posiziona il simbolo su un chip
  opaco, altrimenti il taglio si riempie di immagine.
