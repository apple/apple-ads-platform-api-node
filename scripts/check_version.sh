#!/usr/bin/env bash
set -euo pipefail

# Fails if package.json "version" does not match the output of lib_version.sh.
# Run `npm run sync-version` to reconcile.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

EXPECTED="$(bash "$SCRIPT_DIR/lib_version.sh")"
ACTUAL="$(node -p "require('$ROOT_DIR/package.json').version")"

if [[ "$EXPECTED" != "$ACTUAL" ]]; then
  echo "Version mismatch:" >&2
  echo "  package.json:    $ACTUAL" >&2
  echo "  lib_version.sh:  $EXPECTED" >&2
  echo "Run 'npm run sync-version' to reconcile." >&2
  exit 1
fi

echo "Version OK: $ACTUAL"