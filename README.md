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
