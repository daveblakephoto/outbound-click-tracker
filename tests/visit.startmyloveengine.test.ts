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
    vendor: "dave-blake",
    page: "profile",
    tier: "featured",
    referrer: "https://startmyloveengine.com/spotlight",
    url: "https://startmyloveengine.com/vendors/dave-blake"
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
  expect(await CLICKS.get(`tview:dave-blake:featured:${today}`)).toBe("1");
  expect(await CLICKS.get(`planview:featured:${today}`)).toBe("1");
  expect(await CLICKS.get(`planview:dave-blake:featured:${today}`)).toBe("1");
});

test("accepts unknown vendor and assigns unknown plan", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    vendor: "unknown-vendor",
    page: "profile",
    tier: "basic",
    referrer: "https://startmyloveengine.com/spotlight",
    url: "https://startmyloveengine.com/vendors/unknown-vendor"
  };

  const request = new Request("https://example.com/visit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.11",
      "user-agent": "test-agent"
    },
    body: JSON.stringify(payload)
  });

  const env = { CLICKS } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(204);
  expect(await CLICKS.get(`view:unknown-vendor:${today}`)).toBe("1");
  expect(await CLICKS.get(`planview:unknown:${today}`)).toBe("1");
  expect(await CLICKS.get(`planview:unknown-vendor:unknown:${today}`)).toBe("1");
});

test("returns CORS headers on /visit preflight", async () => {
  const origin = "https://startmyloveengine.com";
  const request = new Request("https://example.com/visit", {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST"
    }
  });

  const env = { CLICKS } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(204);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
    "POST, OPTIONS"
  );
  expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
    "Content-Type, Authorization"
  );
  expect(response.headers.get("Access-Control-Max-Age")).toBe("86400");
});

test("includes CORS headers on /visit errors", async () => {
  const origin = "https://www.startmyloveengine.com";
  const request = new Request("https://example.com/visit", {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json"
    },
    body: "{"
  });

  const env = { CLICKS } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(400);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
});
