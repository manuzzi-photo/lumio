[English](GPU.md) · [Deutsch](GPU.de.md) · **Italiano**

# Accelerazione GPU (NVIDIA NVENC)

Per l'elaborazione video (transcodifica HLS di più livelli di qualità) Lumio può usare l'encoder NVENC di NVIDIA. Questo riduce il tempo di transcodifica di un video 1080p di 1 ora da **2-3 ore via software** a **10-20 minuti su una RTX consumer**.

## Requisiti

Questa lista deve essere soddisfatta sul server host prima di attivare la GPU:

1. **Driver NVIDIA installato**

   ```bash
   nvidia-smi
   ```

   dovrebbe elencare la GPU più una versione del driver.

2. **NVIDIA Container Toolkit installato**

   Guida: [NVIDIA Docs](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html)

   Versione breve per Ubuntu/Debian:

   ```bash
   distribution=$(. /etc/os-release; echo $ID$VERSION_ID)
   curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
     sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
   curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \
     sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
     sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
   sudo apt update
   sudo apt install -y nvidia-container-toolkit
   sudo nvidia-ctk runtime configure --runtime=docker
   sudo systemctl restart docker
   ```

3. **Test**

   ```bash
   docker run --rm --gpus all nvidia/cuda:12.3.1-base-ubuntu22.04 nvidia-smi
   ```

   Se questo stampa l'output di `nvidia-smi` da dentro il container → il toolkit funziona.

## Avviare Lumio con GPU

Una volta soddisfatti i requisiti, carichi in aggiunta l'overlay GPU:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.gpu.yml \
  up -d
```

All'avvio del worker il log dovrebbe mostrare:

```
encoder.detected available=['nvenc', 'software']
encoder.selected name=nvenc
```

Se invece ottieni `name=software`, è un segno che NVENC non era raggiungibile — di solito un problema di setup del toolkit. Controlla `docker compose logs worker` per la causa esatta.

## GPU condivisa con Jellyfin / Immich / altri

Una GPU consumer (serie RTX 20/30/40) ha ufficialmente un limite di **5 sessioni NVENC simultanee**. Se fai girare Jellyfin e Immich in parallelo sulla stessa GPU e ci attacchi anche Lumio, il limite può diventare stretto.

Soluzione: [nvidia-patch](https://github.com/keylase/nvidia-patch) è una modifica open-source del driver che rimuove il limite. Ampiamente usata nei setup Jellyfin/Plex ed è stabile. Configurala sull'host (non nel container) — Lumio non se ne accorge.

Cosa puoi aspettarti:

- Un worker Lumio esegue **fino a 3 sessioni NVENC simultanee** per video (una per livello di qualità HLS: 480p/720p/1080p)
- Con più video in coda il worker li elabora in sequenza, non in parallelo — quindi 3 sessioni occupate, non di più
- Con WORKER_CONCURRENCY > 1 potresti entrare nella zona limite; il default è 1 per i job video

## Girare senza GPU

Basta omettere `-f docker-compose.gpu.yml`:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  up -d
```

La logica dell'encoder di Lumio (apps/worker/encoder_profile.py) verifica a runtime cosa è disponibile e ricade automaticamente su libx264 (CPU). Non c'è nessun crash e non serve nessun cambio di configurazione — lo stesso stack Compose funziona su server con e senza GPU.

## Controllare l'encoder esplicitamente

Imposta la variabile env `LUMIO_HW_ENCODER` nel container worker:

- `auto` (default) — NVENC → QSV → VAAPI → libx264, in quest'ordine
- `nvenc` — solo NVENC, ricade su software se la GPU non c'è
- `qsv` — Intel QuickSync (non rilevante senza una GPU Intel)
- `vaapi` — VA-API (AMD o Intel)
- `software` — esplicitamente libx264, anche se una GPU è presente (es. per tenere la GPU libera per altri container)

L'overlay imposta `nvenc` di default — se a volte vuoi far girare il tuo worker solo su CPU (es. perché altri container hanno bisogno della GPU), puoi sovrascriverlo nel tuo `.env`.
