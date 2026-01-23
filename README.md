# click-tracker

Fast, local, deterministic tests for a Cloudflare Workers click tracker using Vitest + Miniflare + Wrangler.

## Scripts

- `npm test` - run tests once
- `npm run test:watch` - watch mode
- `npm run dev` - local dev server (Wrangler)
- `npm run deploy` - deploy to Cloudflare

## Notes

- Update `wrangler.toml` with your real KV namespace IDs.
- Set `CLICK_SECRET` in your environment or Wrangler secrets for `/stats`.
- Cron rollup keeps daily keys for the current month and the previous two months, then rolls older days into monthly keys (`rollup:vendor:type:YYYY-MM`).
- Tests can force cron time via `CRON_NOW` (ISO timestamp) passed to `scheduled()` for deterministic rollup behavior.
- Optional R2 snapshots write monthly CSVs to `CLICKS_SNAPSHOTS` under `snapshots/YYYY-MM/` for audit and vendor exports.
