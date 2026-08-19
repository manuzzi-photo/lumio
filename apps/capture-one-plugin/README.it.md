[Deutsch](README.md) · **Italiano**

# Lumio Capture One Plugin

Riflette la selezione del cliente di una galleria Lumio nel catalogo
Capture One attualmente aperto o nella sessione corrente. Color tag,
valutazioni a stelle e pick finiscono direttamente sulle Variant.

## Prerequisiti

- **macOS** — Capture One supporta gli script solo su macOS. Per
  Windows non esiste un percorso di scripting ufficiale.
- **Capture One Pro 14** o successivo. Le versioni precedenti hanno
  librerie AppleScript più limitate e non sono state testate.
- **Python 3** (installato di default su macOS 12.3 e successivi in
  `/usr/bin/python3`). Se non presente: tramite Homebrew con
  `brew install python3` oppure con il pacchetto di installazione
  ufficiale di Python.
- Un'istanza Lumio raggiungibile e un token API (vedi "Setup").

## Installazione

1. Scarica la cartella `apps/capture-one-plugin/` dal repo Lumio
   (oppure clona il repo). Contenuto:
   - `lumio-c1-sync.py` — lo script helper Python che comunica con Lumio
   - `Lumio - Pull Selection.applescript` — l'AppleScript che appare
     in C1
   - questo README

2. Apri una volta il file `.applescript` con l'**Editor script**
   (`/System/Applications/Utilities/Script Editor.app`), verifica
   che compili (menu "Script → Compila") e salvalo come **script
   compilato** (`.scpt`).

3. Copia i file — il `.scpt` + `lumio-c1-sync.py` — nella cartella
   degli script di Capture One:

   ```
   ~/Library/Scripts/Capture One Scripts/
   ```

   Se la cartella non esiste, creala. I due file devono trovarsi
   uno accanto all'altro — l'AppleScript si aspetta l'helper Python
   nella stessa directory in cui si trova lui stesso.

4. Assicurati che l'helper Python sia eseguibile:

   ```bash
   chmod +x ~/Library/Scripts/Capture\ One\ Scripts/lumio-c1-sync.py
   ```

5. Avvia Capture One (o riavvialo). Lo script compare sotto
   **Scripts → Lumio - Pull Selection** nella barra dei menu.

## Setup

1. Genera un token API nello studio Lumio: **Impostazioni →
   Token API → Crea token**, ad es. con nome
   "Capture One @ Studio-Mac". COPIA il token — viene mostrato solo
   una volta.

2. Crea un file `~/.lumio-c1.json` con il seguente contenuto:

   ```json
   {
     "host": "https://studio.lumio-cloud.de",
     "token": "lum_xxxxxxxxxxxxxxxxxxxxxx"
   }
   ```

   `host` è il tuo URL Lumio senza slash finale. Se fai self-hosting
   su un dominio diverso, inseriscilo qui.

3. Testa la connessione:

   ```bash
   ~/Library/Scripts/Capture\ One\ Scripts/lumio-c1-sync.py test
   ```

   Output atteso: `{"ok": true, "apiVersion": "1"}`.

   In caso di `Lumio: API-Token ungültig oder abgelaufen`: crea un
   nuovo token nello studio e aggiorna i valori `host`/`token` in
   `.lumio-c1.json`.

## Utilizzo

1. In Capture One apri il catalogo o la sessione che contiene i file
   RAW/JPEG originali.

2. Seleziona **Scripts → Lumio - Pull Selection**.

3. Dalla lista delle gallerie, scegli quella da sincronizzare.

4. Lo script recupera tutti i file della galleria, li confronta per
   nome file con il catalogo/sessione attualmente attivo e applica
   quanto segue:

   | Lumio | Capture One |
   |---|---|
   | Color "red" | Color-Tag 1 (Rosso) |
   | Color "yellow" | Color-Tag 3 (Giallo) |
   | Color "green" | Color-Tag 4 (Verde) |
   | Rating 1–5 | Rating 1–5 |
   | Pick (senza Color-Tag) | Color-Tag 5 (Blu) |
   | Liked | Rating minimo 1 (marcatore più leggero) |

5. Alla fine appare una finestra di dialogo con il numero di file
   trovati in corrispondenza. Se in Lumio esistono file che non sono
   presenti nel catalogo, la finestra ne elenca alcuni come esempio.

## Logica di matching

Come il plugin Lightroom, anche il plugin Capture One esegue il
matching **per nome file** (minuscolo, senza percorso). Se lo stesso
nome file esiste più volte nel catalogo (es. Variant duplicate o
import multipli), la selezione viene applicata **a tutte le Variant
con lo stesso nome**.

**Cosa significa:**

- Se in Lumio hai caricato più Variant RAW dello stesso scatto e il
  cliente ne ha contrassegnata solo una, il plugin non riesce a
  distinguerle — il contrassegno finisce su tutte.
- Con i file rinominati (es. Variant di modifica con sidecar C1 e
  suffisso) il plugin non trova corrispondenze. È voluto: non
  vogliamo indovinare.

## Limitazioni note

- **Windows non è supportato.** Capture One mette a disposizione una
  libreria AppleScript solo su macOS. Per i workflow su Windows al
  momento è disponibile solo il plugin Lightroom Classic.
- **La mappatura Pick → Color-Tag 5** è una convenzione, non un vero
  concetto di C1. A differenza di Lightroom, C1 non ha un flag
  Pick/Reject dedicato. Gli studio che usano Color-Tag 5 (Blu) per
  altri scopi dovrebbero essere consapevoli di questa collisione.
- **Nessuna sincronizzazione bidirezionale.** Il plugin scrive solo
  Lumio → C1. Le modifiche fatte in C1 (es. valutare i pick in un
  secondo momento) non tornano indietro verso la galleria.
- **Catalogo grande = scansione più lenta.** L'indicizzazione dei
  file è lineare su tutte le Variant. Con un catalogo di 50k+ file,
  la prima scansione richiede qualche secondo. Eseguiamo la
  scansione una sola volta per chiamata, non per ogni file.

## Gestione degli errori

| Messaggio | Causa | Soluzione |
|---|---|---|
| „Konfigurationsdatei fehlt: ~/.lumio-c1.json" | Passo 2 del setup saltato | Crea il file come descritto sopra |
| „Lumio: API-Token ungültig oder abgelaufen" | Token revocato o scaduto nello studio | Genera un nuovo token, inseriscilo in `.lumio-c1.json` |
| „Lumio: Verbindung fehlgeschlagen" | Host non raggiungibile (DNS/firewall) | Controlla il valore di `host`, testa con `curl` |
| „Bitte zuerst einen Capture-One-Katalog oder eine Session öffnen" | Nessun documento attivo in C1 | Apri catalogo/sessione, riavvia lo script |
| „N Files nicht im Katalog gefunden" | I nomi file nel catalogo non corrispondono a quelli in Lumio | Confronta i nomi file — di solito il problema riguarda rinomine o Variant di sola modifica |

## Aggiornamenti

Quando un aggiornamento del repo modifica il plugin:

1. Scarica le nuove versioni dei tre file (`.scpt`, `.py`, README) da
   `apps/capture-one-plugin/` nel repo.
2. Sostituiscili in `~/Library/Scripts/Capture One Scripts/`.
3. Riavvia Capture One una volta.

Il file `~/.lumio-c1.json` resta invariato — l'aggiornamento non lo
tocca mai.
