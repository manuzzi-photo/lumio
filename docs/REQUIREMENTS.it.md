[English](REQUIREMENTS.md) · [Deutsch](REQUIREMENTS.de.md) · **Italiano**

# Requisiti / System Requirements

Cosa deve avere il tuo server prima di installare Lumio. Per il vero e proprio
flusso di installazione vedi [SELFHOSTING.md](SELFHOSTING.it.md), per lo scaling
[SCALING.md](SCALING.it.md).

## Sistema operativo & Docker

- **Linux** (testato su Ubuntu 22.04/24.04 e Debian 12). Altre distribuzioni
  funzionano finché Docker gira.
- **Docker Engine ≥ 24** e **Docker Compose v2** (`docker compose`, non il
  vecchio `docker-compose`). Verifica: `docker compose version`.
- Compose v2 usa BuildKit di default — importante per il `--build`.

## Architettura CPU — amd64 **e** arm64

Lumio gira su entrambe le architetture server comuni. Costruisci le immagini
con `--build` nativamente sulla tua macchina; la variante giusta viene
selezionata automaticamente, nulla da configurare.

| Architettura | Esempi | Stato |
|---|---|---|
| **amd64** (x86-64) | Intel/AMD, la maggior parte delle VM cloud (Hetzner CX/CPX, …) | Pienamente supportata, target di test primario |
| **arm64** (aarch64) | Ampere (Hetzner CAX), AWS Graviton, Apple Silicon via Docker, Raspberry Pi 5 | Pienamente supportata |

**Un limite su ARM:** l'accelerazione GPU per l'auto-tagging IA
([GPU.md](GPU.it.md)) richiede **NVIDIA/CUDA** ed è quindi disponibile solo su amd64. Su
ARM il tagging gira sulla CPU — funzionalmente identico, solo più lento per
immagine. Tutte le altre funzionalità (gallerie, caricamento, RAW/HEIC,
transcodifica video, proofing, ZIP, print shop) sono completamente identiche
su entrambe le architetture.

> Nota su Apple Silicon: Docker Desktop su un Mac serie M esegue container
> `linux/arm64` — ottimo per i test locali. Per la produzione un vero server
> Linux (amd64 o arm64) resta la raccomandazione.

## Memoria & CPU

Indicazioni di massima. Il maggiore consumatore è la transcodifica video
(libx264 su CPU); il funzionamento solo foto/RAW è molto più leggero.

| Setup | CPU | RAM | Nota |
|---|---|---|---|
| **Singolo studio, solo foto** | 2 vCPU | 4 GB | Livello base, gallerie piccole |
| **Singolo studio con video** | 4 vCPU | 8 GB | La transcodifica ha bisogno di margine |
| **+ Auto-tagging IA (worker ML)** | +2 vCPU | **+4 GB** | Inferenza CLIP; immagine ~2,5 GB invece di ~1 GB |
| **Multi-tenant / SaaS** | 8 vCPU | 16 GB | + [nodi worker](SCALING.it.md) separati se necessario |

Il worker ML serve solo se vuoi l'auto-tagging — senza di esso il supplemento
di RAM non si applica. I worker possono essere spostati su nodi dedicati non
appena un server non basta più (vedi [SCALING.md](SCALING.it.md)).

## Disco

- **Sistema + immagini:** ~5 GB (con worker ML ~7 GB).
- **Database:** piccolo (metadati, nessuna immagine) — cresce lentamente.
- **Immagini/video:** il vero fabbisogno di spazio.
  - Con **MinIO** (locale) i file vivono sul volume del server — dimensiona il
    disco in base al volume atteso di foto/video. Regola pratica: sensato fino
    a ~500 GB, oltre usa S3 esterno.
  - Con **S3 esterno** (Hetzner Object Storage, R2, B2, Wasabi) il server
    stesso non ha quasi bisogno di storage. Setup: [STORAGE.md](STORAGE.it.md).

## Rete

- Un **IPv4** pubblico (e opzionalmente IPv6) con le porte **80** + **443**
  aperte (Caddy ottiene il certificato Let's Encrypt tramite queste).
- **Porta 9000** aperta anche se giri SENZA una subdomain S3
  (Quick Start / test via IP): il browser carica e recupera le immagini
  direttamente da MinIO su quella porta. Con `S3_PUBLIC_URL` impostato
  (setup con dominio secondo SELFHOSTING.md), la 9000 resta interna.
- Un **dominio** che punta all'IP del server.
- Per il multi-tenant con sottodomini wildcard vedi anche [WILDCARD.md](WILDCARD.it.md).

## Checklist rapida

- [ ] Server Linux, amd64 **o** arm64
- [ ] Docker ≥ 24 + Compose v2
- [ ] Dominio + IP pubblico, porte 80/443 aperte (firewall del SO **e** del cloud); senza subdomain S3 anche la 9000
- [ ] RAM/CPU secondo la tabella (considera video & tagging ML)
- [ ] Strategia di storage decisa (MinIO locale vs. S3 esterno)
