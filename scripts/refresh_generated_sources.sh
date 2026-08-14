#!/usr/bin/env bash
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "Usage: $0 <spec-version> <path-to-openapi-spec>"
  exit 1
fi

SPEC_VERSION="$1"
SPEC_FILE="$2"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

[ -d "$ROOT_DIR/.generated" ] && rm -rf "$ROOT_DIR/.generated"
mkdir -p "$ROOT_DIR/.generated"

[ -d "$ROOT_DIR/src/api" ] && rm -rf "$ROOT_DIR/src/api"
[ -d "$ROOT_DIR/src/model" ] && rm -rf "$ROOT_DIR/src/model"

openapi-generator-cli generate \
  -i "$SPEC_FILE" \
  -g typescript-axios \
  -o "$ROOT_DIR/.generated" \
  -p disallowAdditionalPropertiesIfNotPresent=false \
  -p hideGenerationTimestamp=true \
  -p stringEnums=true \
  -p withSeparateModelsAndApi=true \
  -p apiPackage=api \
  -p modelPackage=model \
  -t "$ROOT_DIR/generator/templates" \
  --openapi-normalizer REF_AS_PARENT_IN_ALLOF=true \

mkdir -p "$ROOT_DIR/src"

cp "$ROOT_DIR/.generated/base.ts" "$ROOT_DIR/src/"
cp "$ROOT_DIR/.generated/common.ts" "$ROOT_DIR/src/"
cp "$ROOT_DIR/.generated/configuration.ts" "$ROOT_DIR/src/"
cp -a "$ROOT_DIR/.generated/api" "$ROOT_DIR/src"
sed 's|\./api/|./|g' "$ROOT_DIR/.generated/api.ts" > "$ROOT_DIR/src/api/index.ts"
cp -a "$ROOT_DIR/.generated/model" "$ROOT_DIR/src"

PREV_SPEC_VERSION=$(cat "$ROOT_DIR/spec.version" 2>/dev/null || true)
echo "${SPEC_VERSION##*-}" > "$ROOT_DIR/spec.version"
if [ "${SPEC_VERSION##*-}" != "${PREV_SPEC_VERSION##*-}" ]; then
  echo "0" > "$ROOT_DIR/patch.version" # reset patch version upon updates to spec version
fi

rm -rf "$ROOT_DIR/.generated"