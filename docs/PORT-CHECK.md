**English** · [Deutsch](PORT-CHECK.de.md) · [Italiano](PORT-CHECK.it.md)

# Port check

Self-hosters rarely run Lumio alone on a box. The same server usually already
has a reverse proxy, another app's Postgres, a Redis for something else, a
DNS resolver — anything that can quietly sit on 80, 443, 5432, 6379, 53. If
one of Lumio's ports is already taken, `docker compose up -d` doesn't fail
loudly with a clear message; a container just refuses to bind and you're
left cross-referencing `docker compose ps`, `docker compose logs`, and `ss
-tlnp` by hand.

`scripts/lumio-check-ports.sh` automates that cross-referencing. Run it
**before** `docker compose up -d`, not after something has already failed to
start.

```bash
./scripts/lumio-check-ports.sh
```

## What it checks

Every port Lumio's `docker-compose.yml` can bind on the host:

| Variable | Default | Protocol | Service |
|---|---|---|---|
| `CADDY_HTTP_PORT` | 80 | tcp | Caddy — HTTP (redirect to HTTPS + ACME HTTP-01) |
| `CADDY_HTTPS_PORT` | 443 | tcp+udp | Caddy — HTTPS + HTTP/3 (QUIC) |
| `FRONTEND_PORT` | 3000 | tcp | Next.js frontend (debug only, bound to localhost) |
| `API_PORT` | 3001 | tcp | Fastify REST+WebSocket API (debug only, bound to localhost) |
| `MINIO_API_PORT` | 9000 | tcp | MinIO — S3 API |
| `MINIO_CONSOLE_PORT` | 9001 | tcp | MinIO — Web console |
| *(none)* | 5432 | tcp | Postgres — fixed port in `docker-compose.yml` |
| *(none)* | 6379 | tcp | Redis — fixed port in `docker-compose.yml` |
| *(none)* | 53 | tcp+udp | acme-dns — DNS (`--profile wildcard` only) |
| *(none)* | 8053 | tcp | acme-dns — internal API (`--profile wildcard` only, bound to localhost) |

For each port the script cross-checks two independent sources before
declaring a conflict:

1. **`docker ps`** — the same source `docker compose up` itself relies on to
   decide whether a port is already allocated. This also catches conflicts
   that a plain socket check can miss (Docker with the userland-proxy
   disabled, or `lsof` without root).
2. **The host socket table** — tried via `ss`, then `lsof`, then a
   dependency-free `/dev/tcp` connect-test as a last resort, so the script
   degrades gracefully on a minimal host that has none of `ss`/`lsof`/`nc`
   installed.

Lumio's own containers (named `lumio_*`) holding their default port are
**not** treated as a conflict — that's just your existing Lumio stack
already running, not something to reassign around.

## What happens on a conflict

- **Ports with a dedicated `.env` variable** (the six listed above): the
  script asks interactively for an alternative port, then writes it straight
  to `.env`. Press Enter to recheck the same port (useful if you just
  stopped the conflicting process), or `s` to keep the default anyway and
  move on.
- **Ports without a variable** (Postgres, Redis, acme-dns): these are fixed
  in `docker-compose.yml` itself. The script never edits a git-tracked file
  automatically, so instead it prints the exact line to change and where.

Writing to `.env` goes through a temp file (`mktemp` + `mv`), which as a side
effect tightens the file's permissions to `600` if they were looser — e.g. a
world-readable `644` becomes owner-only. Deliberate, since `.env` holds the
database password and other secrets, but silent, so worth knowing if
something outside the repo expects a specific mode on that file.

At the end it prints a summary table and, if it wrote anything, tells you
how many `.env` variables changed.

## Non-interactive use

```bash
./scripts/lumio-check-ports.sh --report-only
```

Asks nothing and writes nothing — it only reports each port's status. Use
this in CI or any non-interactive context. The script also falls back to
this behavior on its own whenever stdin isn't a terminal and `/dev/tty`
can't be opened either (e.g. inside a sandboxed CI runner), so a scripted
invocation never hangs waiting for input.

```bash
./scripts/lumio-check-ports.sh --env-file /path/to/other.env
```

Points at a `.env` file other than the repo-root default — useful when
managing several Lumio instances on the same host from a shared checkout.

## Why bother

- **Catches the conflict before the stack half-starts**, instead of after —
  no more diffing `docker compose ps` output to figure out which container
  didn't come up.
- **Reassigns automatically** where it safely can (the six ports with an
  `.env` variable), instead of leaving you to hand-edit files.
- **Never silently touches `docker-compose.yml`.** Fixed-port services get
  instructions, not an automatic edit — those lines are shared, git-tracked
  configuration.
- **Doesn't get confused by your own Lumio stack.** Re-running it after
  `docker compose up -d` reports your own containers as fine, not as
  conflicts to work around.

See also: [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) for what to do when
a port conflict was missed and a container already failed to start.
