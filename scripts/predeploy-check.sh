#!/usr/bin/env bash
set -euo pipefail

ENV_NAME="${1:-production}"
REQUIRED_SECRETS=("ANALYTICS_API_TOKEN" "CLICK_SIGNING_SECRET")

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required to run the predeploy check."
  exit 1
fi

secret_list="$(npx --no-install wrangler secret list --env "$ENV_NAME" 2>/dev/null || true)"
if [ -z "$secret_list" ]; then
  echo "Unable to list secrets for env '$ENV_NAME'."
  exit 1
fi

missing=0
for secret in "${REQUIRED_SECRETS[@]}"; do
  if ! echo "$secret_list" | grep -q "$secret"; then
    echo "Missing secret: $secret (env: $ENV_NAME)"
    missing=1
  fi
done

if [ "$missing" -ne 0 ]; then
  exit 1
fi
