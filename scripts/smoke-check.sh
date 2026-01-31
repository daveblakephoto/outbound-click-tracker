#!/usr/bin/env bash
set -euo pipefail

# Simple post-deploy smoke test.
# Requires curl and jq.
#
# Usage:
#   BASE_URL=https://go.startmyloveengine.com ./scripts/smoke-check.sh
#
# Defaults to production domain.

BASE_URL="${BASE_URL:-https://go.startmyloveengine.com}"
EXPECTED_VERSION="${EXPECTED_VERSION:-1.0.0}"

echo "Smoke: hitting ${BASE_URL}/schema"
SCHEMA_JSON="$(curl -fsS "${BASE_URL}/schema")"

API_VERSION="$(printf '%s' "$SCHEMA_JSON" | jq -r '.apiVersion')"
if [[ "$API_VERSION" != "$EXPECTED_VERSION" ]]; then
  echo "❌ apiVersion mismatch: expected ${EXPECTED_VERSION}, got ${API_VERSION}"
  exit 1
fi

printf '%s' "$SCHEMA_JSON" | jq -e '.resolved.allowedPages | length > 0' >/dev/null
printf '%s' "$SCHEMA_JSON" | jq -e '.resolved.allowedPlans | length > 0' >/dev/null

echo "Smoke: hitting ${BASE_URL}/openapi"
OPENAPI="$(curl -fsS -H "Accept: text/yaml" "${BASE_URL}/openapi")"
echo "$OPENAPI" | grep -q "/visit:" || { echo "❌ openapi missing /visit path"; exit 1; }

echo "✅ smoke checks passed"
