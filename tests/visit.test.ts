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

test("increments tier view counters on visit", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    vendor: "test-vendor",
    page: "profile",
    tier: "featured",
    referrer: "https://startmyloveengine.com/spotlight",
    url: "https://startmyloveengine.com/vendors/test-vendor"
  };

  const request = new Request("https://example.com/visit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.10",
      "user-agent": "test-agent"
    },
    body: JSON.stringify(payload)
  });

  const env = { CLICKS } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(204);
  expect(await CLICKS.get(`tview:featured:${today}`)).toBe("1");
  expect(await CLICKS.get(`tview:test-vendor:featured:${today}`)).toBe("1");
});
