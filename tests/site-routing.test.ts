import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { Miniflare } from "miniflare";
import worker from "../src/worker";

let mf: Miniflare;
let CLICKS: any;

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    kvNamespaces: ["CLICKS"]
  });

  CLICKS = await mf.getKVNamespace("CLICKS");
});

beforeEach(async () => {
  const list = await CLICKS.list();
  await Promise.all(list.keys.map(key => CLICKS.delete(key.name)));
});

afterAll(async () => {
  await mf.dispose();
});

test("visit resolves site from host mapping", async () => {
  const request = new Request("https://smle.mocha.app/visit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.12",
      "user-agent": "test-agent"
    },
    body: JSON.stringify({
      vendor: "test-vendor",
      page: "profile",
      tier: "basic"
    })
  });

  const env = {
    CLICKS,
    SITE_MAP_JSON: "{\"smle.mocha.app\":\"startmyloveengine\"}"
  } as any;

  const response = await worker.fetch(request, env);
  expect(response.status).toBe(204);
});

test("visit rejects unknown site when multiple sites configured", async () => {
  const request = new Request("https://unknown.example/visit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.12",
      "user-agent": "test-agent"
    },
    body: JSON.stringify({
      vendor: "test-vendor",
      page: "profile",
      tier: "basic"
    })
  });

  const env = {
    CLICKS,
    SITE_ALLOWLIST: "startmyloveengine,othersite"
  } as any;

  const response = await worker.fetch(request, env);
  expect(response.status).toBe(400);
});

test("stats rejects site not in allowlist", async () => {
  const request = new Request(
    "https://example.com/api/stats?site=unknownsite&range=7d",
    {
      headers: { Authorization: "Bearer test-secret" }
    }
  );

  const env = {
    CLICKS,
    ANALYTICS_API_TOKEN: "test-secret",
    SITE_ALLOWLIST: "startmyloveengine,othersite"
  } as any;

  const response = await worker.fetch(request, env);
  expect(response.status).toBe(404);
});
