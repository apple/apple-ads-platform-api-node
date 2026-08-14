#!/usr/bin/env bash
set -euo pipefail

#prints the full semantic version of the library
#minor version is the spec version, patch version tracks non-spec changes

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

SPEC_VERSION="$(cat "$ROOT_DIR/spec.version")"
PATCH_VERSION="$(cat "$ROOT_DIR/patch.version")"

MINOR="${SPEC_VERSION##*-}"

echo "1.${MINOR}.${PATCH_VERSION}"