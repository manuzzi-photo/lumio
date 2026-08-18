[Deutsch](README.md) · **Italiano**

# Benchmark delle performance del frontend

Misurazione riproducibile delle performance di caricamento di una
pagina galleria. Permette di verificare i numeri citati nel
blog/marketing.

## Setup

```bash
npm i playwright
npx playwright install chromium
```

## Esecuzione

```bash
node frontend-perf.mjs "https://deine-galerie.example/g/..." --runs 5
```

Confrontare più URL in sequenza:

```bash
node frontend-perf.mjs "<url-a>" "<url-b>" --runs 5
```

## Profilo

Misurato con un profilo mobile, in modo che i numeri si avvicinino a
un dispositivo reale (non a una connessione da data center senza
throttling):

- Dispositivo: Pixel 5 (profilo dispositivo Playwright)
- Rete: Lighthouse "Slow 4G" — 1,6 Mbit/s download, 0,675 Mbit/s
  upload, 150 ms RTT
- CPU: rallentata 4× (emula uno smartphone di fascia media)
- Più run a freddo per ogni misurazione, viene valutata la mediana

## Metriche rilevate

- **FCP** — First Contentful Paint
- **LCP** — Largest Contentful Paint (Web Vital, buono ≤ 2,5 s)
- **CLS** — Cumulative Layout Shift (Web Vital, buono ≤ 0,1)
- **TBT** — Total Blocking Time (proxy di laboratorio per
  l'interattività)
- **reqs** — numero di richieste di rete nella prima visualizzazione
- **loadedImgs** — immagini effettivamente caricate nella prima
  visualizzazione

## Note importanti per l'interpretazione

- I numeri assoluti **dipendono dalla posizione**: la latenza di
  base verso il rispettivo server/CDN varia in base al luogo di
  misurazione. Ciò su cui puoi fare affidamento è il confronto
  **relativo** tra due pagine nelle stesse condizioni.
- I **byte delle immagini** non vengono confrontati di proposito:
  per le immagini servite cross-origin (S3/CDN senza
  `Timing-Allow-Origin`), la Resource Timing API segnala
  `transferSize = 0`. Per questo il focus è su LCP/FCP/CLS/TBT e sul
  numero di richieste.
- Una singola galleria è un punto campione, non un benchmark
  completo. Lo stato della cache CDN e la dimensione della galleria
  influenzano il risultato.
