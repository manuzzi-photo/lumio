[English](WILDCARD.md) · [Deutsch](WILDCARD.de.md) · **Italiano**

# Certificati wildcard per i sottodomini dei tenant

Se fai girare Lumio in **modalità multi** con sottodomini dei tenant (es. `saro.lumio-cloud.de`, `acme.lumio-cloud.de`), ti serve un certificato wildcard per `*.lumio-cloud.de`. Ecco la soluzione pulita — funziona con **qualsiasi** provider DNS, anche se non ha un'API.

> Per la **modalità single** (un dominio, uno studio) e i **domini personalizzati** (il cliente punta il proprio dominio verso il tuo IP) questo **non** serve. Caddy ottiene automaticamente certificati standard per il dominio principale singolo e per i domini personalizzati via HTTP-01.

## Perché non un plugin DNS diretto?

Let's Encrypt richiede una challenge DNS-01 per i wildcard — Caddy deve poter impostare un record TXT `_acme-challenge.lumio-cloud.de`. Direttamente questo funziona solo con plugin API dei provider DNS (Cloudflare, Route53, ecc.). Molti provider (domain reselling, Strato, IONOS senza piano premium) non hanno accesso API o richiedono piani premium. Soluzione: **acme-dns** come intermediario.

## Come funziona acme-dns

`acme-dns` è un piccolissimo server DNS che serve solo record TXT `_acme-challenge`. Deleghi esattamente questo unico record al tuo server acme-dns, tutto il resto resta presso il tuo provider principale. Vantaggi:

- **Indipendente dal provider:** non ti serve alcun accesso API
- **Sicuro:** se le credenziali di acme-dns vengono compromesse, l'attaccante può modificare solo `_acme-challenge`, non i tuoi record DNS principali
- **Componente standard:** Caddy ha un plugin ufficiale, è in produzione da anni

Lumio include acme-dns come servizio Docker (`lumio_acme_dns`) — devi configurarlo solo una volta.

## Requisiti

- Lumio gira in modalità multi
- Hai un dominio (es. `lumio-cloud.de`) presso un provider DNS qualsiasi
- La porta 53 UDP+TCP è raggiungibile dall'esterno sul tuo server (apri il firewall cloud se necessario)
- Conosci l'IP pubblico del tuo server

## Configurazione in 6 passaggi

### 1. Disinnescare systemd-resolved (Ubuntu/Debian)

Su Ubuntu, `systemd-resolved` ascolta su `127.0.0.53:53`. Linux vieta quindi i bind su `0.0.0.0:53` — anche se si tratta solo di loopback. Per questo bindiamo acme-dns esplicitamente sull'IP esterno del server invece che su 0.0.0.0:

```bash
# Add the server IP to .env
echo "ACME_DNS_BIND_IP=YOUR.SERVER.IP" >> .env
```

systemd-resolved continua a funzionare normalmente, acme-dns ascolta sull'IP esterno. Nessun conflitto.

### 2. Creare un DB Postgres per acme-dns

Su un'installazione fresca lo script di init `02-acme-dns.sql` lo fa automaticamente. Su un Postgres già esistente (volume già presente) va fatto manualmente:

```bash
docker compose exec postgres psql -U lumio -d postgres -c \
  "CREATE USER acme_dns WITH PASSWORD 'acme_dns_local_pw';"
docker compose exec postgres psql -U lumio -d postgres -c \
  "CREATE DATABASE acme_dns OWNER acme_dns;"
docker compose exec postgres psql -U lumio -d postgres -c \
  "GRANT ALL PRIVILEGES ON DATABASE acme_dns TO acme_dns;"
```

### 3. Firewall cloud: aprire la porta 53

Sulla Hetzner Cloud Console → Firewalls → Add Rule:
- TCP 53, inbound, source: Any
- UDP 53, inbound, source: Any

Su AWS / DigitalOcean / altri: analogamente nel security group.

### 4. Creare la config live + avviare il container

acme-dns legge la sua config da `infra/acme-dns/config.local.cfg` (in gitignore, non toccata da `git pull`). Creala una volta dal template e inserisci il tuo dominio reale + IP:

```bash
cp infra/acme-dns/config.cfg infra/acme-dns/config.local.cfg
# Open config.local.cfg and replace:
#   auth.example.com  → your auth subdomain (e.g. auth.lumio-cloud.de)
#   203.0.113.10      → your public server IP
```

Poi avvia acme-dns. Il container sta dietro al profilo Compose `wildcard` e parte solo quando il profilo è attivo:

```bash
docker compose --profile wildcard \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.ml.yml \
  up -d acme_dns
```

> **Importante:** da ora in poi ti serve `--profile wildcard` a **ogni** deploy, altrimenti Compose ferma il container acme-dns e i certificati wildcard non possono più essere rinnovati. Il tuo comando di deploy standard diventa quindi:
>
> ```bash
> docker compose --profile wildcard \
>   -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.ml.yml \
>   up -d --build
> ```

Verifica:

```bash
docker logs lumio_acme_dns --tail=10
```

Atteso: `Starting DNS listener` e `Listening HTTP`, nessun errore sqlite.

### 5. Record DNS presso il provider

Presso il tuo provider DNS per la zona `lumio-cloud.de` (dominio di esempio — sostituiscilo ovunque col tuo):

| Type | Hostname | Value | TTL |
|---|---|---|---|
| A | `auth` | `YOUR.SERVER.IP` | 300 |
| NS | `auth` | `auth.lumio-cloud.de.` | 300 |

Importante: il valore NS con un punto finale.

Dopo ~5-10 min di propagazione, testa:

```bash
dig auth.lumio-cloud.de +short              # → YOUR.SERVER.IP
dig NS auth.lumio-cloud.de +short            # → auth.lumio-cloud.de.
dig auth.lumio-cloud.de SOA                  # ANSWER with auth.lumio-cloud.de.
```

Tutti e tre devono funzionare prima del passaggio successivo.

### 6. Creare l'account acme-dns + impostare il CNAME

```bash
docker exec lumio_acme_dns \
  wget -qO- --post-data='' --header='Content-Type: application/json' \
  http://localhost:80/register
```

Risposta (esempio):
```json
{
  "username": "6a1c4fbe-974b-...",
  "password": "oDfYLXqJmhy...",
  "subdomain": "af7bc62d-eac2-...",
  "fulldomain": "af7bc62d-eac2-....auth.lumio-cloud.de"
}
```

**Conserva questi valori con cura.** Vengono generati una sola volta e non sono più recuperabili.

Presso il tuo provider DNS aggiungi un CNAME:

| Type | Hostname | Value |
|---|---|---|
| CNAME | `_acme-challenge` | `<fulldomain>.` (con un punto finale) |

Testa la propagazione:

```bash
dig _acme-challenge.lumio-cloud.de +short
# → <fulldomain>.
```

### 7. Configurare Caddy

Salva le credenziali per Caddy:

```bash
mkdir -p infra/caddy/secrets
cat > infra/caddy/secrets/acmedns.json <<'EOF'
{
  "username": "6a1c4fbe-974b-...",
  "password": "oDfYLXqJmhy...",
  "subdomain": "af7bc62d-eac2-...",
  "fulldomain": "af7bc62d-eac2-....auth.lumio-cloud.de",
  "server_url": "http://acme_dns:80"
}
EOF
chmod 600 infra/caddy/secrets/acmedns.json
```


> Dalla v0.49.3, Caddy si avvia anche *senza* questo file (ricade su un
> dummy incorporato così le installazioni fresche non vanno in crash) — ma il
> TLS wildcard non funzionerà finché non esiste il file di credenziali reale.
> Questo passaggio resta quindi obbligatorio per il setup wildcard.
Abilita l'host wildcard in `.env`:

```bash
sed -i 's|^LUMIO_WILDCARD_HOST=.*|LUMIO_WILDCARD_HOST=*.lumio-cloud.de|' .env
```

Riavvia Caddy con una build personalizzata (il plugin acme-dns viene compilato dentro):

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.ml.yml \
  up -d --build caddy
```

Osserva l'emissione del certificato:

```bash
docker logs lumio_caddy -f --tail=30
```

Atteso:
```
trying to solve challenge ... challenge_type=dns-01
authorization finalized ... authz_status=valid
certificate obtained successfully ... *.lumio-cloud.de
```

La prima volta richiede 30-90 sec. Il rinnovo successivo gira in modo completamente automatico ogni ~60 giorni.

## Verifica

```bash
curl -sI https://<any-subdomain>.lumio-cloud.de | head -3
```

Dovrebbe restituire `HTTP/2 200` con un certificato valido (nessun avviso TLS).

## Troubleshooting

**`address already in use` su `up -d acme_dns`**
La porta 53 è occupata. Controlla `ss -tulnp | grep ':53'`. Se systemd-resolved ascolta su 127.0.0.53 — va bene così, devi solo bindare sull'IP esterno (vedi passaggio 1). Se gira un altro server DNS (bind9, dnsmasq): fermalo.

**`sql: unknown driver "sqlite3"` nei log di acme-dns**
L'immagine `joohoi/acme-dns:latest` non ha più un driver sqlite3 compilato. Lumio quindi usa Postgres — se il tuo setup è ancora configurato per sqlite, crea il DB Postgres (passaggio 2) e passa `infra/acme-dns/config.cfg` a `engine = "postgres"`.

**`presenting DNS record` va in timeout**
Il record CNAME non si è ancora propagato. Controlla `dig _acme-challenge.lumio-cloud.de +short` — deve puntare a `<fulldomain>.`. La propagazione DNS può richiedere fino a 1 ora a seconda del provider e del TTL precedente.

**`tls.obtain: ... no DNS-01 challenge support`**
Caddy non ha il plugin acme-dns compilato dentro. Ricostruisci con `docker compose ... up -d --build caddy` — la build usa `infra/caddy/Dockerfile` con `xcaddy --with github.com/caddy-dns/acmedns`.

**`failed to set TXT record: 401 unauthorized`**
Le credenziali in `infra/caddy/secrets/acmedns.json` sono sbagliate. Ricontrolla — username + password devono provenire esattamente dall'output di `/register`, senza spazi.

**Il certificato viene emesso, ma il browser mostra un avviso**
Caddy non ha ancora servito il nuovo certificato. `docker exec lumio_caddy caddy reload --config /etc/caddy/Caddyfile` oppure riavvia Caddy.

## Diagramma dell'architettura

```
Setup DNS presso il tuo provider:
  auth.lumio-cloud.de        A      <SERVER-IP>
  auth.lumio-cloud.de        NS     auth.lumio-cloud.de.
  _acme-challenge.lumio...   CNAME  <fulldomain>.auth.lumio-cloud.de.


Flusso di rinnovo (ogni 60 giorni):

  Let's Encrypt ──chiede──▶  DNS del domain-reselling (la tua zona)
                                    │
                                    │ segue il CNAME _acme-challenge → fulldomain
                                    ▼
                            server acme-dns (sul tuo host)
                                    ▲
                                    │ scrive il TXT via HTTP API
                                    │
  Caddy ────scrive il TXT────────────┘
       (con le credenziali da secrets/acmedns.json)
```

## Cosa acme-dns NON fa

- Non ospita record A/MX/altri — è il puro intermediario TXT per `_acme-challenge`
- Non sostituisce il tuo provider DNS — ti serve comunque una zona "vera" per il tuo dominio principale
- Non si occupa dei certificati per i domini personalizzati — quelli continuano a funzionare via HTTP-01 (comportamento standard di Caddy, nessuna configurazione necessaria)
