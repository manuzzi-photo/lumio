#!/usr/bin/env bash
#
# Lumio — Versions-Bump.
#
# Hebt die Produkt-Version an EINER Stelle an und synchronisiert alle
# abgeleiteten Orte. Optional wird ein Git-Tag (vX.Y.Z) angelegt.
#
#   ./scripts/bump-version.sh 0.10.0          # setzt + committet + taggt
#   ./scripts/bump-version.sh 0.10.0 --no-tag # nur Dateien setzen, kein Tag/Commit
#
# Single Source of Truth ist /VERSION. Dieser Script schreibt von dort in:
#   - apps/api/src/version.ts      (BUILTIN_VERSION)
#   - apps/worker/version.py       (_BUILTIN_VERSION)
#   - apps/api/package.json        ("version")
#   - apps/frontend/package.json   ("version")
#   - packages/shared/package.json ("version")
#   - die drei zugehoerigen package-lock.json ("version" + packages[""])
#
set -euo pipefail

NEW_VERSION="${1:-}"
DO_TAG=1
[[ "${2:-}" == "--no-tag" ]] && DO_TAG=0

if [[ -z "$NEW_VERSION" ]]; then
  echo "Usage: $0 <version> [--no-tag]   (z.B. $0 0.10.0)" >&2
  exit 1
fi

# SemVer-Grobcheck (X.Y.Z, optional -pre)
if [[ ! "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "Fehler: '$NEW_VERSION' ist keine gültige SemVer-Version (erwartet X.Y.Z)." >&2
  exit 1
fi

# Ins Repo-Root wechseln (Script liegt in scripts/)
cd "$(dirname "$0")/.."

echo "→ /VERSION"
printf '%s\n' "$NEW_VERSION" > VERSION

echo "→ apps/api/src/version.ts"
sed -i -E "s/(BUILTIN_VERSION = \")[^\"]+(\";)/\1${NEW_VERSION}\2/" apps/api/src/version.ts

echo "→ apps/worker/version.py"
sed -i -E "s/(_BUILTIN_VERSION = \")[^\"]+(\")/\1${NEW_VERSION}\2/" apps/worker/version.py

for pkg in apps/api/package.json apps/frontend/package.json packages/shared/package.json; do
  echo "→ $pkg"
  # ersetzt nur das erste "version"-Feld (das Paket selbst, nicht Dependencies)
  sed -i -E "0,/(\"version\": \")[^\"]+(\")/s//\1${NEW_VERSION}\2/" "$pkg"

  # Das zugehoerige Lockfile fuehrt die Version doppelt: einmal oben und
  # einmal unter packages[""]. Bleibt es zurueck, meldet `npm ci` einen
  # Versatz zwischen package.json und Lock — und im Repo steht eine Datei,
  # die eine andere Version behauptet als das Paket daneben.
  #
  # Das lief lange auseinander, weil es von Hand nachgezogen wurde: die
  # beiden App-Locks jedes Mal, packages/shared nie. Dessen Lock stand bei
  # v0.69.0 noch auf 0.1.0.
  lock="${pkg%package.json}package-lock.json"
  if [[ -f "$lock" ]]; then
    echo "→ $lock"
    python3 - "$lock" "$NEW_VERSION" <<'PY'
import json, sys

path, version = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as fh:
    data = json.load(fh)

data["version"] = version
# Der Root-Eintrag in packages ist das Paket selbst.
root = data.get("packages", {}).get("")
if root is not None:
    root["version"] = version

with open(path, "w", encoding="utf-8") as fh:
    json.dump(data, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
PY
  fi
done

echo
echo "Version auf ${NEW_VERSION} gesetzt."

if [[ "$DO_TAG" -eq 0 ]]; then
  echo "(--no-tag) Kein Commit/Tag angelegt. Bitte CHANGELOG.md pflegen und selbst committen."
  exit 0
fi

echo
echo "Nächste Schritte:"
echo "  1) CHANGELOG.md: [Unreleased] → Abschnitt [${NEW_VERSION}] ziehen, ggf. ⚠️ Upgrade-Hinweise."
echo "  2) Danach Enter drücken zum Committen+Taggen (oder Ctrl-C zum Abbrechen)."
read -r _

git add VERSION apps/api/src/version.ts apps/worker/version.py \
        apps/api/package.json apps/frontend/package.json packages/shared/package.json \
        apps/api/package-lock.json apps/frontend/package-lock.json \
        packages/shared/package-lock.json \
        CHANGELOG.md
git commit -m "chore(release): v${NEW_VERSION}"
git tag -a "v${NEW_VERSION}" -m "Lumio v${NEW_VERSION}"

echo
echo "Commit + Tag v${NEW_VERSION} angelegt. Pushen mit:"
echo "  git push && git push --tags"
