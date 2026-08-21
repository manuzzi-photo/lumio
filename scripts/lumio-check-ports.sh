#!/usr/bin/env bash
#
# lumio-check-ports.sh — checks the TCP/UDP ports required by Lumio and, if
# there is a conflict with a service or container already running on the
# host, interactively asks for an alternative port.
#
# Covers the ports defined in docker-compose.yml:
#   - With a dedicated .env variable (CADDY_HTTP_PORT, CADDY_HTTPS_PORT,
#     FRONTEND_PORT, API_PORT, MINIO_API_PORT, MINIO_CONSOLE_PORT): on
#     conflict the new port is written directly to .env.
#   - Without a variable, fixed port in the compose file (Postgres 5432,
#     Redis 6379, acme-dns 53/8053): on conflict the script shows
#     instructions for a manual override in docker-compose.yml (it never
#     touches git-tracked files automatically).
#
# Lumio's own containers (name lumio_*) already holding their default port
# are NOT treated as a conflict — that's just the Lumio stack already
# running.
#
# Usage:
#   ./scripts/lumio-check-ports.sh [--env-file PATH] [--report-only]
#
#   --env-file PATH   Path to the .env file to update (default: .env at
#                      the repo root).
#   --report-only     Ask nothing and write nothing to .env: just report
#                      the status of each port (useful in CI / non-
#                      interactive scripts).
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
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Port table (parallel arrays — macOS's bash 3.2 has no associative arrays,
# so we stick to plain indices).
# ---------------------------------------------------------------------------
PORT_VARS=(CADDY_HTTP_PORT CADDY_HTTPS_PORT FRONTEND_PORT API_PORT MINIO_API_PORT MINIO_CONSOLE_PORT POSTGRES_PORT REDIS_PORT ACME_DNS_PORT ACME_DNS_API_PORT)
PORT_DEFAULTS=(80 443 3000 3001 9000 9001 5432 6379 53 8053)
PORT_PROTOS=("tcp" "tcp udp" "tcp" "tcp" "tcp" "tcp" "tcp" "tcp" "tcp udp" "tcp")
PORT_DESCS=(
  "Caddy — HTTP (redirect to HTTPS + ACME HTTP-01)"
  "Caddy — HTTPS + HTTP/3 (QUIC)"
  "Next.js frontend (debug only, bound to localhost)"
  "Fastify REST+WebSocket API (debug only, bound to localhost)"
  "MinIO — S3 API"
  "MinIO — Web console"
  "Postgres (fixed port in docker-compose.yml)"
  "Redis (fixed port in docker-compose.yml)"
  "acme-dns — DNS (--profile wildcard only)"
  "acme-dns — internal API (--profile wildcard only, bound to localhost)"
)
# 1 = a dedicated .env variable exists, 0 = port hardcoded in the compose file
PORT_HAS_ENV_VAR=(1 1 1 1 1 1 0 0 0 0)
# Snippet shown when a manual edit is needed (only for HAS_ENV_VAR=0)
PORT_MANUAL_HINT=(
  ""
  ""
  ""
  ""
  ""
  ""
  'services.postgres.ports: - "${POSTGRES_BIND_IP:-127.0.0.1}:5432:5432"  →  change the "5432" left of the colon'
  'services.redis.ports:    - "${REDIS_BIND_IP:-127.0.0.1}:6379:6379"    →  change the "6379" left of the colon'
  'services.acme_dns.ports: - "${ACME_DNS_BIND_IP:-127.0.0.1}:53:53/udp" and "...:53:53/tcp"  →  change the leading "53"'
  'services.acme_dns.ports: - "127.0.0.1:8053:80"  →  change "8053" (no .env variable exists for this port)'
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
have_cmd() { command -v "$1" >/dev/null 2>&1; }

CAN_PROMPT=1
if [ "$REPORT_ONLY" -eq 1 ]; then
  CAN_PROMPT=0
elif [ ! -t 0 ]; then
  # If stdin isn't a terminal (e.g. the script runs in a pipeline), try to
  # reattach to /dev/tty. In some sandboxed environments the device exists
  # but can't be opened (no controlling terminal): we test opening it in a
  # subshell so we don't silence the main process's stderr, and this must
  # not fail the script under 'set -e' if the test fails.
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
  echo "WARNING: none of lsof/ss/nc were found. The check falls back to" >&2
  echo "'docker ps' + a connect-test via /dev/tcp: reliable for TCP, but" >&2
  echo "without ss/lsof a busy UDP port will NOT be detected." >&2
  echo "Install 'lsof' or 'iproute2' (ss) for a reliable UDP check." >&2
fi

IS_ROOT=0
[ "$(id -u 2>/dev/null || echo 1)" -eq 0 ] && IS_ROOT=1
if [ "$IS_ROOT" -eq 0 ]; then
  echo "Note: running without elevated privileges. 'lsof' often can't see" >&2
  echo "sockets opened by other users' processes (e.g. root, dockerd) and" >&2
  echo "may falsely report a port as free. The check below compensates with" >&2
  echo "'docker ps' and a direct connect-test, but for maximum reliability:" >&2
  echo "sudo $0" >&2
  echo "" >&2
fi

is_valid_port() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}

# Plain-bash TCP connect-test, no external dependencies. Can't produce false
# positives (if the connection succeeds, something really is listening); the
# only limitation is a false negative on filtered ports — irrelevant here,
# since we test 127.0.0.1.
devtcp_port_open() {
  port="$1"
  (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null
}

# Checks the host-level socket status for a given protocol, trying ALL
# available tools (not stopping at the first one: a non-root 'lsof' may miss
# other users' sockets while 'ss' still sees them, and vice versa on
# different systems).
host_socket_busy() {
  port="$1"; proto="$2"
  if [ "$HAVE_SS" -eq 1 ]; then
    if [ "$proto" = "tcp" ]; then
      [ -n "$(ss -H -ltn "sport = :$port" 2>/dev/null)" ] && return 0
    else
      [ -n "$(ss -H -lun "sport = :$port" 2>/dev/null)" ] && return 0
    fi
  fi
  if [ "$HAVE_LSOF" -eq 1 ]; then
    if [ "$proto" = "tcp" ]; then
      lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && return 0
    else
      lsof -nP -iUDP:"$port" >/dev/null 2>&1 && return 0
    fi
  fi
  if [ "$proto" = "tcp" ]; then
    devtcp_port_open "$port" && return 0
    if [ "$HAVE_NC" -eq 1 ]; then
      nc -z -w1 127.0.0.1 "$port" >/dev/null 2>&1 && return 0
    fi
  fi
  # UDP without ss/lsof: not reliably checkable (nc -zu on a connectionless
  # protocol gives too many false results) — assumed free.
  return 1
}

# Exact host-port + protocol match in 'docker ps' output (format
# "0.0.0.0:9000->9000/tcp"). Independent of lsof/ss and their permission
# quirks: it's the same source 'docker compose up' will use to decide
# whether the port is already allocated.
docker_owner_of_port() {
  port="$1"; proto="$2"
  [ "$DOCKER_OK" -eq 1 ] || return 1
  printf '%s\n' "$DOCKER_PS_SNAPSHOT" | awk -F'\t' -v pat=":${port}->[0-9]+/${proto}" '
    $2 ~ pat { print $1; found=1 }
    END { exit !found }
  '
}

process_owner_of_port() {
  port="$1"; proto="$2"
  [ "$HAVE_LSOF" -eq 1 ] || return 1
  lsof -nP -i"$(printf '%s' "$proto" | tr '[:lower:]' '[:upper:]')":"$port" 2>/dev/null | awk 'NR==2{print $1" (PID "$2")"; found=1} END{exit !found}'
}

# Fills CONFLICT_REASON (empty string = port free on every requested
# protocol). Lumio's own lumio_* containers don't count as a conflict. The
# Docker check always runs first and is independent of the socket check's
# result: it also catches cases (Docker with the userland-proxy disabled, or
# lsof without privileges) where the socket isn't visible on the host even
# though the port is already allocated to another container.
describe_conflict() {
  port="$1"; protos="$2"
  CONFLICT_REASON=""
  for proto in $protos; do
    dockname="$(docker_owner_of_port "$port" "$proto" 2>/dev/null || true)"
    case "$dockname" in
      lumio_*)
        continue
        ;;
    esac

    if [ -n "$dockname" ]; then
      CONFLICT_REASON="${CONFLICT_REASON}${CONFLICT_REASON:+; }${proto}/${port}: Docker container '${dockname}'"
      continue
    fi

    host_socket_busy "$port" "$proto" || continue
    owner="$(process_owner_of_port "$port" "$proto" 2>/dev/null || true)"
    if [ -z "$owner" ]; then
      owner="unidentified process"
      [ "$IS_ROOT" -eq 0 ] && owner="${owner} (rerun with sudo for details)"
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
echo "Lumio — TCP/UDP port check"
echo "==========================="
[ "$DOCKER_OK" -eq 1 ] && echo "Docker: reachable (running containers will also be recognized)."
[ "$DOCKER_OK" -eq 0 ] && echo "Docker: unreachable — only host socket status will be checked."
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
      echo "⚠ Conflict — $desc"
      echo "  $CONFLICT_REASON"
      if [ "$CAN_PROMPT" -eq 0 ]; then
        status="manual"
        break
      fi
      printf "  Alternative port to use instead of %s [enter = recheck, 's' = keep %s and continue]: " "$candidate" "$candidate"
      read -r answer || answer="s"
      case "$answer" in
        s|S) status="conflict_ignored"; break ;;
        "") continue ;;
        *)
          if is_valid_port "$answer"; then
            candidate="$answer"
            continue
          fi
          echo "  Invalid value: expected a number between 1 and 65535."
          continue
          ;;
      esac
    else
      break
    fi
  done

  if [ "$status" = "ok" ] && [ "$candidate" != "$default_port" ]; then
    status="reassigned"
  fi

  echo "✓ $desc → port $candidate ($status)"
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
# Summary + .env write for ports with a dedicated variable
# ---------------------------------------------------------------------------
echo "Summary"
echo "-------"
printf '%-20s %-10s %-10s %s\n' "VARIABLE" "DEFAULT" "CHOSEN" "STATUS"

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
  [ "$has_var" -eq 0 ] && label="${var} (no .env var)"
  printf '%-20s %-10s %-10s %s\n' "$label" "$default_port" "$final_port" "$status"

  if [ "$has_var" -eq 1 ] && [ "$final_port" != "$default_port" ] && [ "$REPORT_ONLY" -eq 0 ]; then
    set_env_var "$ENV_FILE" "$var" "$final_port"
    ENV_UPDATES=$((ENV_UPDATES + 1))
  fi

  if [ "$has_var" -eq 0 ] && { [ "$final_port" != "$default_port" ] || [ "$status" = "manual" ]; }; then
    MANUAL_ACTIONS+=("$hint")
  fi

  i=$((i + 1))
done

echo ""
if [ "$ENV_UPDATES" -gt 0 ]; then
  echo "Wrote $ENV_UPDATES variable(s) to: $ENV_FILE"
elif [ "$REPORT_ONLY" -eq 1 ]; then
  echo "--report-only mode: nothing written."
else
  echo "No .env variable needed updating (every default port is free or already in use by Lumio itself)."
fi

if [ "${#MANUAL_ACTIONS[@]}" -gt 0 ]; then
  echo ""
  echo "These ports have no dedicated .env variable: to use a different one"
  echo "than the default, edit docker-compose.yml by hand before running"
  echo "'docker compose up -d':"
  echo ""
  for hint in "${MANUAL_ACTIONS[@]}"; do
    echo "  - $hint"
  done
fi

echo ""
echo "Done. Rerun 'docker compose up -d' to apply any changes."
