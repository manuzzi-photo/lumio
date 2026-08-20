[English](README.md) · [Deutsch](README.de.md) · **Italiano**

# brand/

Ogni versione della marca Lumio, più gli script che le generano.

**Le regole e la logica dietro di esse non stanno qui** — vivono in
[`../docs/BRAND.md`](../docs/BRAND.it.md). Questa cartella è il magazzino, quel
documento è il regolamento.

Panoramica più rapida: apri [`preview.html`](preview.html) in un browser. La
pagina incorpora direttamente i file di questa cartella, quindi mostra lo stato
reale invece di una ridisegnata — comprese le dimensioni reali in pixel a
partire da 16 px.

## Contenuto

| Cartella | Cosa contiene |
|---|---|
| `logo/` | simbolo, wordmark e lockup come SVG, ciascuno normale e invertito |
| `favicon/` | favicon SVG, fallback PNG, touch icon, web manifest |
| `email/` | versioni PNG per le intestazioni email |
| `readme/` | PNG dei lockup per l'intestazione del README, chiari e scuri |
| `social/` | card di anteprima social per GitHub — **deve essere caricata lì manualmente**, vedi `social/README.md` |
| `fonts/` | Quicksand e Inter con i relativi testi di licenza |
| `src/` | gli script Python che generano tutto quanto sopra |

### Quale file per cosa

| File | Uso |
|---|---|
| `logo/mark.svg` | favicon, icona dell'app, ovunque si adatti solo il simbolo |
| `logo/mark-inverse.svg` | lo stesso su sfondo scuro |
| `logo/mark-mono.svg` | monocolore, per timbri e stampa a un colore |
| `logo/mark-thin.svg` | taglio più stretto — alternativa se il taglio sembra troppo dominante |
| `logo/logo.svg` | lockup orizzontale per intestazioni e firme |
| `logo/logo-mono-light.svg` | lockup su superficie colorata, dove la tessera arancione sparirebbe |
| `logo/logo-cloud.svg`, `logo/logo-selfhosted.svg` | impilati, con il descrittore di prodotto |
| `logo/wordmark.svg` | solo la wordmark, quando il simbolo è già affiancato |
| `email/logo-email*.png` | intestazioni email. PNG, perché Gmail e Outlook non renderizzano SVG |
| `readme/logo-readme*.png` | intestazione del README, chiara e scura |

Le copie distribuite vivono sotto `apps/frontend/public/`. Questa cartella è la
fonte, non la destinazione — cambia le cose qui, poi copia.

## Rigenerare

Gli SVG sono generati, non disegnati a mano. La wordmark è **Quicksand
SemiBold convertita in tracciati**, così i file del logo non caricano alcun
webfont.

```bash
pip install fonttools cairosvg
cd brand/src

python3 build.py            # symbol, wordmark, all lockups
python3 favicon-adaptive.py # favicon with prefers-color-scheme
python3 og.py               # Open Graph images, 1200x630
python3 github.py           # social preview + README logos
```

Gli script localizzano i font tramite un percorso relativo a se stessi, quindi
la chiamata non dipende dalla working directory. Un'esecuzione da una copia
pulita riproduce tutti e quattordici gli SVG **identici byte per byte** a
quelli qui archiviati — se un file differisce, è un segnale, non rumore.

## Font

`fonts/` contiene i due caratteri usati, insieme ai relativi testi di licenza:

| File | Uso |
|---|---|
| `Quicksand.ttf` | wordmark (istanza `wght 600`), descrittore (`wght 500`) |
| `Inter.ttf` | titoli delle immagini Open Graph |
| `Quicksand-OFL.txt`, `Inter-OFL.txt` | le relative licenze |

Entrambi sono sotto la **SIL Open Font License 1.1**, che permette esplicitamente
la ridistribuzione ma richiede che il testo della licenza viaggi insieme —
da qui i file `OFL.txt` accanto a essi. Entrambe le famiglie portano un
*Reserved Font Name*: una versione modificata non può mantenere il nome
"Quicksand" o "Inter".

La wordmark in `logo/` è già convertita in tracciati e non ha più bisogno del
font — questi file servono solo per la rigenerazione.

## Colori

| Ruolo | Hex | Uso |
|---|---|---|
| Ink | `#12121A` | tessere, wordmark, superfici scure |
| Accent | `#FF4D2E` | esattamente una tessera, il puntino della i, riempimenti, testo da 24 px |
| Accent strong | `#C93214` | link e testo piccolo su sfondi chiari |
| Paper | `#FAF8F5` | sfondo chiaro, etichette su riempimenti arancioni |

## Usare questo altrove

Il codice è concesso in licenza sotto FSL-1.1-ALv2. **Il nome e la marca non sono
coperti da essa.** Se fai self-hosting di Lumio, lascia il branding così com'è —
è proprio quello il punto. Se costruisci qualcosa di tuo sopra e lo distribuisci,
per favore metti la tua marca: altrimenti sembra Lumio ufficiale e le richieste
di supporto finiscono nella casella sbagliata. Tutto è sostituibile: i file
sotto `apps/frontend/public/`, il componente `Logo`, e `--logo-accent` in
`globals.css`.

Per stampa, elenchi o newsletter, i file qui possono essere usati così come
sono. `readme/logo-readme.png` (chiaro) e `readme/logo-readme-dark.png`
(scuro) sono la scelta usuale, `favicon/icon-512.png` dove serve una tessera
quadrata. Non serve chiedere — ma fai un fischio se manca qualcosa in un
formato che ti serve.
