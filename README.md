# click-tracker

Fast, local, deterministic tests for a Cloudflare Workers click tracker using Vitest + Miniflare + Wrangler.

## Scripts

- `npm test` - run tests once
- `npm run test:watch` - watch mode
- `npm run dev` - local dev server (Wrangler)
- `npm run deploy` - deploy to Cloudflare
- `npm run dashboard:sync` - import latest `Analytics Dashboard*.zip` from `~/Downloads` into `dashboard-app/`
- `npm run dashboard:watch` - keep watching `~/Downloads` and auto-import new dashboard zips

## Notes

- Set `ANALYTICS_API_TOKEN` as a Wrangler secret for `/api/stats` auth.
- Optional env vars: `CLICK_SIGNING_SECRET`, `RATE_LIMIT_PER_MINUTE`, `ANALYTICS_CACHE`, `VENDOR_ALLOWLIST`, `VISIT_PAGE_ALLOWLIST`.
- Multi-site routing: set `SITE_MAP_JSON` (hostname -> site slug) and `SITE_ALLOWLIST` (CSV) to attribute events per brand/site when using a shared Worker endpoint.
- Abuse protection: rate limiting is enabled by default at **60 requests/minute per IP**. Set `RATE_LIMIT_PER_MINUTE=0` to disable.
- Click signing: `POST /click` is signed **server-side only**; the worker computes an internal signature after validating origin/referrer. If the secret is missing, `POST /click` returns 503. **GET /click is deprecated and disabled (410).**
- POST /click hardening: requires an allowed `Origin` and `Referer` (from `contracts/analytics.contract.json` allowlist).
- Cache scoping: when `ANALYTICS_CACHE=1`, cache keys include a hash of the Authorization token.
- AE-only mode: this worker writes and reads analytics from Cloudflare Analytics Engine only; KV/R2 rollup paths are removed.
- Temporary local dashboard CORS is enabled for `http://127.0.0.1:5500` and `http://localhost:5500` for rapid testing. Remove both origins before final production cutover.

## API contract

- Source of truth: `contracts/analytics.contract.json` (enums, CORS allowlists, regex) and `contracts/analytics.openapi.yaml` (HTTP surface).
- Runtime discovery:
  - `GET /schema` — returns contract JSON plus resolved/normalized allowlists (cached 1h).
  - `GET /openapi` — returns OpenAPI YAML (cached 1h).
  - `GET /api/health/analytics-engine` — auth-protected AE probe (no-store).
- Producers (startmyloveengine site) should import the contract at build time; consumers (mocha dashboard) may cache `/schema` for up to 1h.
- Change policy: additive-only within a minor version; breaking changes require a major bump and a deprecation window.

### Optional post-deploy smoke check

- Run `npm run smoke` (uses `scripts/smoke-check.sh`) with `BASE_URL` set to your deployed hostname.
- Verifies `/schema` returns the expected `apiVersion` and populated allowlists, and `/openapi` contains the `/visit` path.
- Add this as a post-deploy step in GitHub Actions or Cloudflare Build (e.g., deploy command `npm run deploy && BASE_URL=https://go.startmyloveengine.com npm run smoke`).

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

## Mocha Dashboard Sync

The script at `scripts/mocha-dashboard-zip-sync.mjs` mirrors your Mocha dashboard zip export into `dashboard-app/`.

- Default zip pattern: `Analytics Dashboard*.zip`
- Default source folder: `~/Downloads`
- Default target folder: `./dashboard-app`
- State file: `./.cache/dashboard-zip-sync-state.json` (prevents duplicate re-import)

Examples:

- One-shot import from newest matching zip:
  - `npm run dashboard:sync`
- Watch mode (auto-import on new zip saves):
  - `npm run dashboard:watch`
- Import a specific zip path:
  - `node scripts/mocha-dashboard-zip-sync.mjs --zip "/Users/daveblake/Downloads/Analytics Dashboard (1).zip"`
