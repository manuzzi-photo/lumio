[English](SELFHOSTING-SYNOLOGY.md) · [Deutsch](SELFHOSTING-SYNOLOGY.de.md) · **Italiano**

# Eseguire Lumio su un NAS Synology

Lumio è un semplice stack Docker Compose che porta con sé tutto il necessario
(PostgreSQL, Redis, MinIO per l'archiviazione a oggetti, Caddy, l'app stessa).
Questo significa che *può* funzionare su un NAS Synology — con alcune
avvertenze su modello, RAM e TLS. Questa pagina è il complemento specifico
per Synology di [SELFHOSTING.md](SELFHOSTING.it.md); leggi anche quella, qui
sono trattate solo le differenze.

> **Stato:** Synology non è un target testato ufficialmente. Funziona perché
> è Docker Compose standard su amd64/arm64 — ma non esiste un pacchetto a un
> clic e dovresti essere a tuo agio con SSH e il Reverse Proxy di DSM.

## La tua Synology può farlo girare?

- [ ] **DSM 7.2 o più recente con il pacchetto *Container Manager*.** Container
      Manager include Docker Engine ≥ 24 **e Compose v2** (`docker compose`),
      che Lumio richiede. Il vecchio pacchetto "Docker" su DSM 6 / inizio DSM 7
      aveva solo Compose v1 e *non* funzionerà senza intervento manuale.
- [ ] **Modello a 64 bit.** Sono supportati sia `amd64` (Intel/AMD) sia
      `arm64` (aarch64). **I modelli x86-64 "Plus"/"+" sono fortemente
      consigliati** (es. DS920+/DS923+, DS1522+/DS1621+). I vecchi modelli
      ARM a 32 bit **non** sono supportati.
- [ ] **RAM** (il solito collo di bottiglia):
    - Solo foto: **minimo 4 GB**
    - Con transcodifica video: **8 GB**
    - Con auto-tagging IA (worker ML): **+4 GB** in più — meglio lasciarlo
      **disattivato** su un NAS
- [ ] **Spazio disco libero** su un volume per i volumi `minio_data` /
      `postgres_data`, dimensionato in base alla tua libreria foto/video.

Se il tuo NAS ha 2 GB di RAM o è un modello ARM a 32 bit, fermati qui — non
sarà una buona esperienza.

## Prestazioni — cosa aspettarsi

- **Il primo `up` compila le immagini dal sorgente** (frontend, API e il
  worker Python con libvips). Sulla CPU di un NAS è lento e affamato di RAM;
  metti in conto **10-30+ minuti** e assicurati di avere un paio di GB di RAM
  liberi durante la build. Un NAS debole/con poca RAM può andare in OOM qui —
  in quel caso, compila le immagini su una macchina più potente e copiale,
  oppure aggiungi RAM.
- **La transcodifica video è di gran lunga il compito più pesante** (x264 su
  CPU). Un NAS a 2 core transcodificherà i clip di un matrimonio lentamente e
  uno alla volta. Gli studi che gestiscono solo foto sono molto più leggeri.
- **L'auto-tagging IA (CLIP) è opzionale e pesante** — l'immagine del worker
  ML è ~2,5 GB e richiede +4 GB di RAM. Su un NAS, **non attivare il profilo
  ML**; tutto il resto funziona anche senza.
- **L'archiviazione locale con MinIO** va bene per un singolo studio; come
  regola empirica è sensata fino a ~500 GB. Oltre, punta Lumio verso un S3
  esterno (vedi [STORAGE.md](STORAGE.it.md)) in modo che il NAS esegua solo
  l'app, non l'archiviazione.
- **I download dei clienti avvengono direttamente da MinIO sul tuo NAS**,
  quindi la velocità di download per i tuoi clienti è limitata dalla tua
  **banda di upload di casa**. Per gallerie grandi questo conta più del NAS
  stesso. (Gli ZIP grandi vengono divisi automaticamente in parti, il che
  aiuta con connessioni instabili.)

Tabella hardware di riferimento: [REQUIREMENTS.md](REQUIREMENTS.it.md).

## Limitazioni su una Synology

- **Nessun auto-tagging GPU.** L'accelerazione GPU richiede NVIDIA/CUDA (solo
  amd64) — non disponibile su nessuna Synology. Su CPU, il tagging è
  funzionalmente identico, solo più lento. Vedi [GPU.md](GPU.it.md).
- **Le porte 80/443 sono occupate da DSM.** Rimapperai il Caddy di Lumio su
  porte alte e lo metterai dietro il Reverse Proxy di DSM (sotto).
- **Compilare sul NAS può essere doloroso** sui modelli di fascia bassa (vedi
  Prestazioni).
- **Gli aggiornamenti/riavvii di DSM riavviano i container.** Con
  `restart: unless-stopped` lo stack torna su da solo, ma aspettati qualche
  minuto di downtime durante la manutenzione DSM.
- **Questo è self-hosting a studio singolo.** Il multi-tenant/wildcard-TLS
  ([MULTI_TENANT.md](MULTI_TENANT.it.md)) non è qualcosa che vuoi far girare
  su un NAS di casa.

## Configurazione

### 1. Attiva Container Manager

Installa **Container Manager** dal Package Center (DSM 7.2+). Conferma via
SSH:

```bash
sudo docker compose version   # must print v2.x
```

### 2. Metti i file sul NAS

Crea una cartella su un volume dati, es. `/volume1/docker/lumio`, e porta lì
il sorgente. Il modo più semplice è via SSH (Pannello di controllo →
Terminal & SNMP → attiva SSH):

```bash
mkdir -p /volume1/docker && cd /volume1/docker
git clone https://github.com/markusthiel/lumio.git
cd lumio
cp .env.example .env
```

Se `git` non è disponibile sul tuo NAS, scarica il repository come ZIP sul
tuo PC e carica invece la cartella estratta tramite **File Station**.

### 3. Secrets e modalità

Genera i secrets (come nella guida generica):

```bash
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')|" .env
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -base64 32 | tr -d '/+=')|" .env
sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -base64 32 | tr -d '/+=')|" .env
sed -i "s|^S3_ACCESS_KEY=.*|S3_ACCESS_KEY=$(openssl rand -hex 12)|" .env
sed -i "s|^S3_SECRET_KEY=.*|S3_SECRET_KEY=$(openssl rand -base64 32 | tr -d '/+=')|" .env
```

`DEPLOYMENT_MODE=single` è il valore predefinito — lascialo così. La
modalità single crea automaticamente uno studio al primo avvio; non serve un
super admin.

### 4. Sposta le porte lontano da DSM

DSM è già in ascolto su 80/443. Imposta il Caddy di Lumio su porte alte in
`.env` in modo che i container non entrino in conflitto con DSM:

```bash
CADDY_HTTP_PORT=8080
CADDY_HTTPS_PORT=8443
```

(Puoi lasciare le porte di MinIO ai valori predefiniti 9000/9001, a meno che
qualcos'altro sul NAS non le usi già.)

### 5. TLS — usa il Reverse Proxy di DSM (consigliato)

Su un NAS la strada più pulita è lasciare che **DSM termini l'HTTPS** con un
certificato gestito da Synology e inoltri HTTP semplice al Caddy di Lumio.
Il Caddy di Lumio supporta esplicitamente l'esecuzione dietro un reverse
proxy esterno.

1. **DNS:** punta un hostname verso il tuo NAS — un dominio reale, o il DDNS
   Synology (`something.synology.me`). Servono due nomi, es.
   `gallery.example.com` e `s3.example.com` (un sottodominio S3 è lo schema
   di reverse proxy documentato).
2. **Certificato:** in **Pannello di controllo → Sicurezza → Certificato**,
   ottieni un certificato Let's Encrypt per entrambi i nomi (Synology lo fa
   per te con DDNS o il tuo dominio).
3. **Reverse Proxy:** **Pannello di controllo → Portale di accesso →
   Avanzate → Reverse Proxy**, crea due regole, entrambe verso la porta
   HTTP di Caddy:
    - `https://gallery.example.com` → `http://localhost:8080`
    - `https://s3.example.com` → `http://localhost:8080`
   Attiva HTTP/2 e, sotto *Intestazione personalizzata*, inoltra l'header
   `Host` (attiva anche il supporto WebSocket — Lumio usa `/ws`).
4. **`.env`:** comunica a Lumio la sua identità pubblica:

```bash
LUMIO_HOST=gallery.example.com
LUMIO_S3_HOST=s3.example.com
PUBLIC_URL=https://gallery.example.com
S3_PUBLIC_URL=https://s3.example.com
```

Il Caddy di Lumio si fida di `X-Forwarded-Proto` proveniente da range
privati, quindi rileva correttamente l'HTTPS terminato da DSM.

**Alternativa (Caddy gestisce il TLS da solo):** se preferisci lasciare che
Lumio gestisca i certificati, devi liberare le porte 80/443 — o sposta le
porte di DSM stesso (Pannello di controllo → Portale di accesso → cambia le
porte HTTP/HTTPS di DSM) in modo che Caddy possa usare
`CADDY_HTTP_PORT=80` / `CADDY_HTTPS_PORT=443`, oppure inoltra sul router
80→8080 / 443→8443. Caddy ottiene quindi da solo il certificato Let's
Encrypt (serve che la porta 80 sia raggiungibile da internet). Il percorso
del Reverse Proxy DSM sopra è di solito meno complicato su un NAS.

### 6. Avvia

```bash
sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Il primo avvio compila le immagini (vedi Prestazioni — abbi pazienza).
Osserva il progresso:

```bash
sudo docker compose logs -f
```

### 7. Crea il tuo utente admin

```bash
sudo docker compose exec api npm run create-admin -- \
  --email=you@example.com \
  --password=atleast12chars \
  --name="Your Studio"
```

### 8. Accedi

Apri `https://gallery.example.com`, crea una galleria di prova, carica
un'immagine, condividi il link e aprilo dal tuo telefono. Se questo giro
funziona, sei live.

## Note operative

- **Le modifiche al Caddyfile richiedono un restart, non un reload**
  (`admin off` è impostato): `sudo docker compose restart caddy`.
- **Fai il backup di due cose:** il database Postgres e i dati oggetto di
  MinIO (volume `minio_data`). Vedi [BACKUP.md](BACKUP.it.md). Synology
  Hyper Backup può fare il backup della cartella `/volume1/docker/lumio` e
  dei volumi Docker.
- **Aggiornamento:** `git pull` nella cartella del progetto, poi riesegui il
  comando `up -d` del passo 6 (aggiungi `--build` per forzare una
  ricompilazione). Le migrazioni del DB vengono eseguite automaticamente
  all'avvio dell'API.
- Bloccato? [TROUBLESHOOTING.md](TROUBLESHOOTING.it.md).

## Vedi anche

- [SELFHOSTING.md](SELFHOSTING.it.md) — la guida generica al self-hosting
  (leggi prima questa)
- [REQUIREMENTS.md](REQUIREMENTS.it.md) — hardware, architettura,
  dimensionamento
- [STORAGE.md](STORAGE.it.md) — MinIO vs. S3 esterno
- [BACKUP.md](BACKUP.it.md) — strategia di backup
- [GPU.md](GPU.it.md) — perché il tagging GPU non è disponibile qui
