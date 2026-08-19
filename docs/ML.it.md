[English](ML.md) · [Deutsch](ML.de.md) · **Italiano**

# Auto-tagging IA (CLIP)

Lumio può taggare le immagini automaticamente al caricamento – ad es. riconosce spiaggia, matrimonio, ritratto, set in studio, tramonto. I tag vengono aggiunti ai record della foto e sono ricercabili.

Questo è **opzionale**. Se non ti serve l'auto-tagging, non c'è nulla da fare – il worker standard ha la funzione disabilitata.

---

## Cosa fa

Lumio usa **OpenAI CLIP** (Contrastive Language-Image Pretraining) localmente sul tuo server. Nessuna chiamata API esterna, tutto sul tuo hardware. Il modello è aperto, gira offline, non costa alcuna commissione API.

Ad ogni caricamento immagine:

1. Il worker recupera l'immagine da S3
2. CLIP calcola un embedding (vettore)
3. L'embedding viene confrontato con un elenco di tag candidati
4. I tag con una confidenza superiore a `LUMIO_CLIP_THRESHOLD` vengono salvati

I tag candidati sono configurabili in una word list (`apps/worker/lumio/clip_labels.py` se presente – altrimenti hardcoded).

---

## CPU vs GPU

| | CPU | GPU |
|---|---|---|
| **Per immagine** | 1–3 secondi | 50–200 ms |
| **Fabbisogno RAM** | ~3 GB | ~3 GB + ~2 GB VRAM |
| **Hardware** | qualsiasi server amd64 o arm64 | GPU NVIDIA con Compute Capability 5.0+ (solo amd64) |
| **Setup** | solo `docker-compose.ml.yml` | in aggiunta `docker-compose.gpu.yml` + NVIDIA Container Toolkit |
| **Quando ha senso** | pochi caricamenti, elaborazione in background | throughput elevato, più utenti in parallelo |

Per uno studio solo con 100 immagini al giorno: la CPU basta e avanza. Per un SaaS con 1000+ caricamenti all'ora: la GPU ha senso.

---

## Setup CPU (semplice)

Basta aggiungere `docker-compose.ml.yml` allo stack:

```bash
cd /opt/docker/lumio/lumio
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.ml.yml \
  up -d --build worker
```

Questo sostituisce il worker standard con uno con PyTorch + open_clip_torch. Al primo avvio il worker scarica il modello CLIP da HuggingFace (~150 MB), che viene messo in cache in `lumio_model_cache`.

Verifica lo stato:

```bash
docker compose logs worker --tail=30 | grep -i clip
```

Dovrebbe mostrare qualcosa come `CLIP model loaded: ViT-B-32 (openai)` e, per le immagini, `tagged image with N labels`.

### Ottimizzare le performance CPU

- **Scaling del worker:** più worker paralleli permettono più inferenze concorrenti. Ma ogni worker tiene il modello CLIP in RAM (~2 GB), quindi non scalarlo all'infinito.
  ```bash
  docker compose up -d --scale worker=2
  ```
- **Regola la soglia:** in `.env` `LUMIO_CLIP_THRESHOLD=0.15` (default 0.08). Più alto = meno tag ma più affidabili.

---

## Setup GPU (per throughput elevato)

### Requisiti

1. GPU NVIDIA nel server (serie RTX 20/30/40 o Tesla/serie A)
2. Driver NVIDIA installato (`nvidia-smi` deve funzionare)
3. NVIDIA Container Toolkit installato ([Guida all'installazione](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html))
4. Docker configurato con il runtime nvidia (`docker info | grep -i nvidia`)

### Installazione rapida del Container Toolkit

```bash
# NVIDIA repo
curl -s -L https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

apt update
apt install -y nvidia-container-toolkit
nvidia-ctk runtime configure --runtime=docker
systemctl restart docker

# Test
docker run --rm --gpus all nvidia/cuda:12.2-base-ubuntu22.04 nvidia-smi
```

Se il test mostra l'output di `nvidia-smi`: il toolkit va bene.

### Avviare Lumio con GPU

```bash
cd /opt/docker/lumio/lumio
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.ml.yml \
  -f docker-compose.gpu.yml \
  up -d --build worker
```

Nei log del worker:

```bash
docker compose logs worker | grep -i -E "cuda|gpu"
```

Dovrebbe mostrare `CUDA available: True, device=cuda:0`. Se `CUDA available: False`: il container non riesce a raggiungere la GPU, controlla il setup del toolkit o il flag compose.

### GPU per più che il solo CLIP

`docker-compose.gpu.yml` attiva anche **NVENC** nel worker – ffmpeg usa quindi la GPU per la transcodifica video invece della CPU. È enorme per le gallerie video:

- CPU (libx264): 1080p ~1x tempo reale, 4K ~0.1x tempo reale
- GPU (NVENC): 1080p ~8x tempo reale, 4K ~2x tempo reale

Quindi se hai molti video di matrimoni, una GPU ripaga anche senza tagging IA.

---

## Configurazione

In `.env` (tutte opzionali):

```bash
# CLIP fully on/off (overrides what docker-compose.ml.yml sets)
LUMIO_CLIP_ENABLED=1

# Model choice. Default: ViT-B-32 (small, fast, OK quality).
# Alternatives: ViT-L-14 (better, much slower), ViT-B-16
LUMIO_CLIP_MODEL=ViT-B-32

# Pretraining dataset. Default: openai. Alternative: laion2b_s34b_b79k
# (often better for photo content)
LUMIO_CLIP_PRETRAINED=openai

# Threshold for tag suggestions (0..1). Default: 0.08.
# Higher = fewer but more confident tags. 0.15 is conservative, 0.05 generous.
LUMIO_CLIP_THRESHOLD=0.08
```

Dopo una modifica, riavvia il worker:

```bash
docker compose restart worker
```

---

## Personalizzare la word list dei tag

La word list di default copre gli scenari fotografici tipici (matrimonio, ritratto, paesaggio, studio, ...). Se ti servono tag specifici per il tuo dominio (es. "evento sportivo", "shoot industriale"):

Modifica la word list in `apps/worker/lumio/clip_labels.py` (o equivalente), rebuilda il worker.

CLIP capisce **descrizioni**, non solo parole chiave. "Una foto di una festa di matrimonio in spiaggia" funziona meglio di solo "matrimonio".

---

## Quando l'auto-tagging NON vale la pena

- Hai già un tuo sistema di workflow con keyword di Lightroom
- Contenuti sensibili dal punto di vista della privacy (nudità, riservati) – anche se CLIP gira localmente, una classificazione ML è un flusso di dati aggiuntivo
- L'hardware del worker è già al limite

---

## Errori comuni

**Il worker si blocca al primo avvio:** il modello CLIP è in fase di download (~150 MB). I log mostrano `Downloading ...`. Alla prima immagine potrebbe scaricare ulteriori componenti del modello. Abbi pazienza, al secondo avvio è in cache.

**`CUDA available: False` nonostante la GPU:** il container non ha accesso alla GPU. Controlli:
1. `nvidia-smi` funziona sull'host?
2. `docker info | grep -i nvidia` mostra `Runtimes: ... nvidia ...`?
3. `docker-compose.gpu.yml` è incluso nel comando `up`?
4. Il worker è stato ricostruito (`--build`)?

**I tag non vengono mostrati:** cache del frontend. `Ctrl+Shift+R` nel browser, oppure riapri la galleria. Se ancora non compare: controlla i log del worker per le righe `tagged image`.

**Carico CPU/RAM elevato:** normale per l'inferenza su CPU. Se il server è molto carico, abbassa la concorrenza del worker in `.env` (`WORKER_CONCURRENCY=2`) oppure usa una GPU.
