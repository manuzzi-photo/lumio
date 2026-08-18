#!/usr/bin/env bash
#
# lumio-check-ports.sh — verifica le porte TCP/UDP richieste da Lumio e, in
# caso di conflitto con servizi o container già in esecuzione sull'host,
# chiede interattivamente una porta alternativa.
#
# Copre le porte definite in docker-compose.yml:
#   - Con variabile .env dedicata (CADDY_HTTP_PORT, CADDY_HTTPS_PORT,
#     FRONTEND_PORT, API_PORT, MINIO_API_PORT, MINIO_CONSOLE_PORT):
#     in caso di conflitto la nuova porta viene scritta direttamente in .env.
#   - Senza variabile, porta fissa nel compose (Postgres 5432, Redis 6379,
#     acme-dns 53/8053): in caso di conflitto lo script mostra le istruzioni
#     per l'override manuale in docker-compose.yml (non tocca file tracciati
#     da git in automatico).
#
# Container propri (nome lumio_*) che occupano già la loro porta di default
# NON vengono trattati come conflitto — è lo stack Lumio già avviato.
#
# Uso:
#   ./scripts/lumio-check-ports.sh [--env-file PATH] [--report-only]
#
#   --env-file PATH   Percorso del file .env da aggiornare (default: .env
#                      nella root del repo).
#   --report-only     Non chiede nulla e non scrive .env: mostra solo lo
#                      stato di ogni porta (utile in CI / script non
#                      interattivi).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_DIR/.env"
REPORT_ONLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --report-only)
      REPORT_ONLY=1
      shift
      ;;
    -h|--help)
      sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Opzione sconosciuta: $1" >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Tabella delle porte (array paralleli — bash 3.2 di macOS non ha le
# associative array, quindi restiamo su indici semplici).
# ---------------------------------------------------------------------------
PORT_VARS=(CADDY_HTTP_PORT CADDY_HTTPS_PORT FRONTEND_PORT API_PORT MINIO_API_PORT MINIO_CONSOLE_PORT POSTGRES_PORT REDIS_PORT ACME_DNS_PORT ACME_DNS_API_PORT)
PORT_DEFAULTS=(80 443 3000 3001 9000 9001 5432 6379 53 8053)
PORT_PROTOS=("tcp" "tcp udp" "tcp" "tcp" "tcp" "tcp" "tcp" "tcp" "tcp udp" "tcp")
PORT_DESCS=(
  "Caddy — HTTP (redirect HTTPS + ACME HTTP-01)"
  "Caddy — HTTPS + HTTP/3 (QUIC)"
  "Frontend Next.js (solo debug, bind localhost)"
  "API Fastify REST+WebSocket (solo debug, bind localhost)"
  "MinIO — S3 API"
  "MinIO — Web Console"
  "Postgres (porta fissa in docker-compose.yml)"
  "Redis (porta fissa in docker-compose.yml)"
  "acme-dns — DNS (solo --profile wildcard)"
  "acme-dns — API interna (solo --profile wildcard, bind localhost)"
)
# 1 = esiste una variabile .env dedicata, 0 = porta hardcoded nel compose
PORT_HAS_ENV_VAR=(1 1 1 1 1 1 0 0 0 0)
# Snippet da mostrare quando serve un edit manuale (solo per HAS_ENV_VAR=0)
PORT_MANUAL_HINT=(
  ""
  ""
  ""
  ""
  ""
  ""
  'services.postgres.ports: - "${POSTGRES_BIND_IP:-127.0.0.1}:5432:5432"  →  cambia il "5432" a sinistra dei due punti'
  'services.redis.ports:    - "${REDIS_BIND_IP:-127.0.0.1}:6379:6379"    →  cambia il "6379" a sinistra dei due punti'
  'services.acme_dns.ports: - "${ACME_DNS_BIND_IP:-127.0.0.1}:53:53/udp" e "...:53:53/tcp"  →  cambia il "53" a sinistra'
  'services.acme_dns.ports: - "127.0.0.1:8053:80"  →  cambia "8053" (nessuna variabile .env prevista per questa porta)'
)

# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------
have_cmd() { command -v "$1" >/dev/null 2>&1; }

CAN_PROMPT=1
if [ "$REPORT_ONLY" -eq 1 ]; then
  CAN_PROMPT=0
elif [ ! -t 0 ]; then
  # Se lo stdin non è un terminale (es. script lanciato in pipeline), proviamo
  # a riagganciarci a /dev/tty. In alcuni ambienti sandbox il device esiste
  # ma non è apribile (niente terminale di controllo): testiamo l'apertura
  # in una subshell per non silenziare lo stderr del processo principale, e
  # non deve far fallire lo script sotto 'set -e' se il test fallisce.
  if (exec < /dev/tty) 2>/dev/null; then
    exec < /dev/tty
  else
    CAN_PROMPT=0
  fi
fi

DOCKER_OK=0
DOCKER_PS_SNAPSHOT=""
if have_cmd docker && docker info >/dev/null 2>&1; then
  DOCKER_OK=1
  DOCKER_PS_SNAPSHOT="$(docker ps --format '{{.Names}}\t{{.Ports}}' 2>/dev/null || true)"
fi

HAVE_LSOF=0; have_cmd lsof && HAVE_LSOF=1
HAVE_SS=0;   have_cmd ss   && HAVE_SS=1
HAVE_NC=0;   have_cmd nc   && HAVE_NC=1

if [ "$HAVE_LSOF" -eq 0 ] && [ "$HAVE_SS" -eq 0 ] && [ "$HAVE_NC" -eq 0 ]; then
  echo "ATTENZIONE: nessuno strumento tra lsof/ss/nc trovato — impossibile" >&2
  echo "verificare realmente le porte. Installa 'lsof' (macOS: già presente" >&2
  echo "di norma; Linux: apt/dnf install lsof) e rilancia lo script." >&2
fi

is_valid_port() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}

tcp_port_in_use() {
  port="$1"
  if [ "$HAVE_LSOF" -eq 1 ]; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  if [ "$HAVE_SS" -eq 1 ]; then
    [ -n "$(ss -H -ltn "sport = :$port" 2>/dev/null)" ]
    return $?
  fi
  if [ "$HAVE_NC" -eq 1 ]; then
    nc -z -w1 127.0.0.1 "$port" >/dev/null 2>&1
    return $?
  fi
  return 1
}

udp_port_in_use() {
  port="$1"
  if [ "$HAVE_LSOF" -eq 1 ]; then
    lsof -nP -iUDP:"$port" >/dev/null 2>&1
    return $?
  fi
  if [ "$HAVE_SS" -eq 1 ]; then
    [ -n "$(ss -H -lun "sport = :$port" 2>/dev/null)" ]
    return $?
  fi
  # UDP non affidabilmente verificabile con nc (protocollo connectionless):
  # meglio non dare un falso "libera".
  return 1
}

docker_owner_of_port() {
  port="$1"
  [ "$DOCKER_OK" -eq 1 ] || return 1
  printf '%s\n' "$DOCKER_PS_SNAPSHOT" | awk -F'\t' -v p=":${port}->" '
    index($2, p) { print $1; found=1 }
    END { exit !found }
  '
}

process_owner_of_port() {
  port="$1"; proto="$2"
  [ "$HAVE_LSOF" -eq 1 ] || return 1
  lsof -nP -i"$(printf '%s' "$proto" | tr '[:lower:]' '[:upper:]')":"$port" 2>/dev/null | awk 'NR==2{print $1" (PID "$2")"; found=1} END{exit !found}'
}

# Riempie CONFLICT_REASON (stringa vuota = porta libera su tutti i protocolli
# richiesti). I container lumio_* propri non contano come conflitto.
describe_conflict() {
  port="$1"; protos="$2"
  CONFLICT_REASON=""
  for proto in $protos; do
    if [ "$proto" = "tcp" ]; then
      tcp_port_in_use "$port" && busy=1 || busy=0
    else
      udp_port_in_use "$port" && busy=1 || busy=0
    fi
    [ "$busy" -eq 1 ] || continue

    dockname="$(docker_owner_of_port "$port" 2>/dev/null || true)"
    case "$dockname" in
      lumio_*)
        continue
        ;;
    esac

    if [ -n "$dockname" ]; then
      owner="container Docker '${dockname}'"
    else
      owner="$(process_owner_of_port "$port" "$proto" 2>/dev/null || true)"
      [ -z "$owner" ] && owner="processo non identificato"
    fi
    CONFLICT_REASON="${CONFLICT_REASON}${CONFLICT_REASON:+; }${proto}/${port}: ${owner}"
  done
  [ -n "$CONFLICT_REASON" ]
}

set_env_var() {
  file="$1"; key="$2"; value="$3"
  touch "$file"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    tmp="$(mktemp "${file}.XXXXXX")"
    awk -v k="$key" -v v="$value" -F= '$1==k{$0=k"="v} {print}' "$file" > "$tmp"
    mv "$tmp" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
echo "Lumio — verifica porte TCP/UDP"
echo "==============================="
[ "$DOCKER_OK" -eq 1 ] && echo "Docker: raggiungibile (verranno riconosciuti anche i container in esecuzione)."
[ "$DOCKER_OK" -eq 0 ] && echo "Docker: non raggiungibile — verrà controllato solo lo stato dei socket sull'host."
echo ""

RESULT_VAR=(); RESULT_HAS_VAR=(); RESULT_DEFAULT=(); RESULT_FINAL=(); RESULT_STATUS=(); RESULT_HINT=()

n=${#PORT_VARS[@]}
i=0
while [ "$i" -lt "$n" ]; do
  var="${PORT_VARS[$i]}"
  default_port="${PORT_DEFAULTS[$i]}"
  protos="${PORT_PROTOS[$i]}"
  desc="${PORT_DESCS[$i]}"
  has_var="${PORT_HAS_ENV_VAR[$i]}"
  hint="${PORT_MANUAL_HINT[$i]}"

  candidate="$default_port"
  status="ok"

  while true; do
    if describe_conflict "$candidate" "$protos"; then
      echo "⚠ Conflitto — $desc"
      echo "  $CONFLICT_REASON"
      if [ "$CAN_PROMPT" -eq 0 ]; then
        status="manuale"
        break
      fi
      printf "  Porta alternativa da usare al posto di %s [invio = ricontrolla, 's' = lascia %s e continua]: " "$candidate" "$candidate"
      read -r answer || answer="s"
      case "$answer" in
        s|S) status="conflitto_ignorato"; break ;;
        "") continue ;;
        *)
          if is_valid_port "$answer"; then
            candidate="$answer"
            continue
          fi
          echo "  Valore non valido: serve un numero tra 1 e 65535."
          continue
          ;;
      esac
    else
      break
    fi
  done

  if [ "$status" = "ok" ] && [ "$candidate" != "$default_port" ]; then
    status="riassegnata"
  fi

  echo "✓ $desc → porta $candidate ($status)"
  echo ""

  RESULT_VAR+=("$var")
  RESULT_HAS_VAR+=("$has_var")
  RESULT_DEFAULT+=("$default_port")
  RESULT_FINAL+=("$candidate")
  RESULT_STATUS+=("$status")
  RESULT_HINT+=("$hint")

  i=$((i + 1))
done

# ---------------------------------------------------------------------------
# Riepilogo + scrittura .env per le porte con variabile dedicata
# ---------------------------------------------------------------------------
echo "Riepilogo"
echo "---------"
printf '%-20s %-10s %-10s %s\n' "VARIABILE" "DEFAULT" "SCELTA" "STATO"

ENV_UPDATES=0
MANUAL_ACTIONS=()

n=${#RESULT_VAR[@]}
i=0
while [ "$i" -lt "$n" ]; do
  var="${RESULT_VAR[$i]}"
  has_var="${RESULT_HAS_VAR[$i]}"
  default_port="${RESULT_DEFAULT[$i]}"
  final_port="${RESULT_FINAL[$i]}"
  status="${RESULT_STATUS[$i]}"
  hint="${RESULT_HINT[$i]}"

  label="$var"
  [ "$has_var" -eq 0 ] && label="${var} (senza var .env)"
  printf '%-20s %-10s %-10s %s\n' "$label" "$default_port" "$final_port" "$status"

  if [ "$has_var" -eq 1 ] && [ "$final_port" != "$default_port" ] && [ "$REPORT_ONLY" -eq 0 ]; then
    set_env_var "$ENV_FILE" "$var" "$final_port"
    ENV_UPDATES=$((ENV_UPDATES + 1))
  fi

  if [ "$has_var" -eq 0 ] && { [ "$final_port" != "$default_port" ] || [ "$status" = "manuale" ]; }; then
    MANUAL_ACTIONS+=("$hint")
  fi

  i=$((i + 1))
done

echo ""
if [ "$ENV_UPDATES" -gt 0 ]; then
  echo "Scritte $ENV_UPDATES variabile/e in: $ENV_FILE"
elif [ "$REPORT_ONLY" -eq 1 ]; then
  echo "Modalità --report-only: nessuna modifica scritta."
else
  echo "Nessuna variabile .env da aggiornare (tutte le porte con default libere/già in uso da Lumio stesso)."
fi

if [ "${#MANUAL_ACTIONS[@]}" -gt 0 ]; then
  echo ""
  echo "Queste porte non hanno una variabile .env dedicata: per usarne una"
  echo "diversa dal default va modificato a mano docker-compose.yml prima di"
  echo "'docker compose up -d':"
  echo ""
  for hint in "${MANUAL_ACTIONS[@]}"; do
    echo "  - $hint"
  done
fi

echo ""
echo "Fatto. Rilancia 'docker compose up -d' per applicare eventuali modifiche."
