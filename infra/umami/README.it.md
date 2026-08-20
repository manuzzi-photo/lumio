[Deutsch](README.md) · **Italiano**

# Umami — Web analytics per i siti marketing

Analytics self-hosted e senza cookie per `lumio-cloud.de` e
`lumio-app.de`. Gira come stack a sé, servito dal Caddy dell'app su
`stats.lumio-cloud.de`.

## Perché senza cookie / senza banner di consenso

Umami non imposta cookie, non usa `localStorage` né un
identificatore persistente. Genera un hash giornaliero rotante e non
ricostruibile e non salva l'IP. Non accede quindi al dispositivo
dell'utente (il § 25 TDDDG non si applica); il breve trattamento
dell'IP può basarsi sul legittimo interesse (art. 6, par. 1, lett. f
GDPR). Self-hosted in Germania (Hetzner) → nessun trasferimento verso
paesi terzi.

Resta comunque necessaria la menzione nell'informativa sulla privacy
(già presente su entrambi i siti). Non è una consulenza legale —
l'approvazione finale spetta a una revisione legale.

`DISABLE_TELEMETRY=1` è impostato in modo che Umami stesso non invii
statistiche di utilizzo anonime verso l'esterno.

## Setup iniziale

1. Imposta il **record A** `stats.lumio-cloud.de` → IP del server.
2. Imposta `LUMIO_UMAMI_HOST=stats.lumio-cloud.de` nel `.env` dello
   stack app e rideploya lo stack app (Caddy carica il blocco stats
   e ottiene il certificato; senza questa variabile il blocco resta
   inattivo).
3. Crea i secret e avvia lo stack:
   ```
   cd /opt/docker/lumio/lumio/infra/umami
   cp .env.example .env
   # UMAMI_DB_PASSWORD + UMAMI_APP_SECRET eintragen (openssl rand ...)
   docker compose up -d
   ```
4. Apri `https://stats.lumio-cloud.de`, accedi con il login
   predefinito (`admin` / `umami`) e **cambia subito la password**.
5. In *Settings → Websites* crea due siti web:
   - Domain `lumio-cloud.de`
   - Domain `lumio-app.de`
   Ognuno restituisce un **Website-ID** (UUID).
6. Inserisci gli ID nel `.env` del rispettivo sito marketing
   (`PUBLIC_UMAMI_WEBSITE_ID`, `PUBLIC_UMAMI_SRC`) e ricostruisci il
   sito (`docker compose up -d --build`). Solo a quel punto viene
   caricato lo snippet di tracking.

## Aggiornamenti

```
cd /opt/docker/lumio/lumio/infra/umami
docker compose pull && docker compose up -d
```

I dati si trovano nel volume `umami_db_data` e sopravvivono agli
aggiornamenti.
