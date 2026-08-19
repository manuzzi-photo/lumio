[English](VERSIONING.md) · [Deutsch](VERSIONING.de.md) · **Italiano**

# Versionamento

Lumio segue il [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

La versione è soprattutto un **segnale per i self-hoster** su quanto sia rischioso un aggiornamento — perché aggiornano manualmente tramite `git pull` + `docker compose up`.

## Le tre posizioni

| Posizione | Esempio | Significato | Azione del self-hoster |
|--------|----------|-----------|--------------------------|
| **PATCH** | 0.9.0 → 0.9.**1** | bugfix, retrocompatibile | solo pull + deploy |
| **MINOR** | 0.**9** → 0.**10**.0 | nuova funzionalità, retrocompatibile (es. una nuova env *opzionale* con un default) | solo pull + deploy |
| **MAJOR** | 0.x → **1**.0.0 | breaking change | intervento manuale secondo le note di upgrade |

### L'unica regola pratica

> Dopo il `git pull`, il self-hoster deve toccare qualcosa in `.env`, nel comando Compose o nel DB, altrimenti si rompe?
> **Sì → MAJOR.** Altrimenti MINOR (funzionalità) o PATCH (fix).

Esempi di breaking change (MAJOR):
- variabili env **obbligatorie** rinominate o nuove
- un'invocazione Compose modificata (es. il refactor `--profile wildcard`)
- funzionalità o endpoint rimossi
- una migrazione DB che non gira automaticamente in modo pulito

## Pre-1.0

Siamo a `0.x`. Questo segnala deliberatamente: strutturalmente le cose possono ancora muoversi. I breaking change vengono comunque segnalati chiaramente nel `CHANGELOG.md` sotto **⚠️ Upgrade notes**. Imposteremo `1.0.0` quando vorremo promettere stabilità.

## Unica fonte di verità

La versione canonica vive in **`/VERSION`** (radice del repo). Da essa derivano:

- `apps/api/src/version.ts` → `LUMIO_VERSION` (in `/health` e `/meta`)
- `apps/worker/version.py` → `__version__` (log di avvio)
- `version` nei `package.json` dei workspace

Questi file **non vengono modificati a mano** ma tenuti sincronizzati dallo script di bump. Una `LUMIO_VERSION` env impostata sovrascrive a runtime il valore integrato (es. per immagini con timbro CI).

## Flusso di release

```bash
# 1. Bump the version (syncs all files + creates a Git tag)
./scripts/bump-version.sh 0.10.0

# 2. CHANGELOG.md: move entries from [Unreleased] into the new section,
#    for breaking changes add a "⚠️ Upgrade notes" block.

# 3. Push commit + tag
git push && git push --tags
```

Successivamente crea una release dal tag in Forgejo (la sezione del changelog come note di release). I self-hoster vedono la versione in esecuzione nel footer dello studio e sotto `GET /health`.

## Siti marketing

`lumio-app-de` e `lumio-cloud-de` sono contenuti con deploy continuo e non necessitano **nessun** SemVer. Il versioning riguarda solo l'app (`lumio`).
