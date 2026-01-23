import { afterEach, beforeEach, expect, test } from "vitest";
import { Miniflare } from "miniflare";
import worker from "../src/worker";

let mf: Miniflare;

beforeEach(async () => {
  mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    kvNamespaces: ["CLICKS"]
  });

  globalThis.CLICKS = await mf.getKVNamespace("CLICKS");
});

afterEach(async () => {
  await mf.dispose();
});

test("blocks stats without secret", async () => {
  const request = new Request(
    "https://example.com/api/stats?site=StartMyLoveEngine&range=7d"
  );

  const env = {
    CLICKS: globalThis.CLICKS,
    ANALYTICS_API_TOKEN: "test-secret"
  } as any;

  const response = await worker.fetch(request, env);
  expect(response.status).toBe(401);
});
