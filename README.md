# click-tracker

Fast, local, deterministic tests for a Cloudflare Workers click tracker using Vitest + Miniflare + Wrangler.

## Scripts

- `npm test` - run tests once
- `npm run test:watch` - watch mode
- `npm run dev` - local dev server (Wrangler)
- `npm run deploy` - deploy to Cloudflare

## Notes

- Update `wrangler.toml` with your real KV namespace IDs.
- Set `ANALYTICS_API_TOKEN` as a Wrangler secret for `/api/stats` auth.
- Optional env vars: `CLICK_SIGNING_SECRET`, `RATE_LIMIT_PER_MINUTE`, `VENDOR_ALLOWLIST`, `VISIT_PAGE_ALLOWLIST`, `CRON_DRY_RUN`, `CRON_MAX_KEYS`.
- Cron rollup keeps daily keys for the current month and the previous two months, then rolls older days into monthly keys (`rollup:vendor:type:YYYY-MM`).
- Tests can force cron time via `CRON_NOW` (ISO timestamp) passed to `scheduled()` for deterministic rollup behavior.
- Optional R2 snapshots write monthly CSVs to `CLICKS_SNAPSHOTS` under `smle/snapshots/YYYY-MM/` plus raw key snapshots under `smle/snapshots-raw/YYYY-MM/`.

## How secrets are managed

Secrets are stored in Cloudflare’s Worker secret store and set via Wrangler for the production environment.

- Set or rotate secrets:
  - `wrangler secret put ANALYTICS_API_TOKEN --env production`
  - `wrangler secret put CLICK_SIGNING_SECRET --env production`
- Verify secrets before deploy:
  - `npm run predeploy`
- Restore after loss:
  - Re-run the `wrangler secret put ... --env production` commands above.

Deploys use `wrangler deploy --env production`, and the predeploy check will fail if required secrets are missing.
