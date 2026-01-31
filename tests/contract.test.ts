import { beforeAll, beforeEach, afterAll, expect, test } from "vitest";
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

test("/schema exposes contract fields", async () => {
  const req = new Request("https://example.com/schema", {
    headers: { Origin: "https://startmyloveengine.com" }
  });
  const res = await worker.fetch(req, { CLICKS } as any);
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toContain("application/json");
  const json = await res.json();
  expect(json.apiVersion).toBe("1.0.0");
  expect(json.allowedPages).toContain("profile");
  expect(json.resolved.vendorSlugRegex).toBe("^[a-z0-9-]+$");
});

test("legacy tier payload maps to plan and placement", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const req = new Request("https://example.com/visit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.21",
      "user-agent": "test-agent"
    },
    body: JSON.stringify({
      vendor: "unknown-vendor",
      page: "profile",
      tier: "spotlight"
    })
  });

  const res = await worker.fetch(req, { CLICKS } as any);
  expect(res.status).toBe(204);
  expect(await CLICKS.get(`tview:spotlight:${today}`)).toBe("1");
  expect(await CLICKS.get(`planview:unknown:${today}`)).toBe("1");
  expect(await CLICKS.get(`plcview:spotlight:${today}`)).toBe("1");
});

test("rejects invalid plan", async () => {
  const req = new Request("https://example.com/visit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.22",
      "user-agent": "test-agent"
    },
    body: JSON.stringify({
      vendor: "vendor-basic",
      page: "profile",
      plan: "pro"
    })
  });

  const res = await worker.fetch(req, { CLICKS } as any);
  expect(res.status).toBe(400);
});

test("rejects invalid placements", async () => {
  const req = new Request("https://example.com/visit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.23",
      "user-agent": "test-agent"
    },
    body: JSON.stringify({
      vendor: "vendor-basic",
      page: "profile",
      plan: "basic",
      placements: ["bad-slot"]
    })
  });

  const res = await worker.fetch(req, { CLICKS } as any);
  expect(res.status).toBe(400);
});

test("/openapi returns yaml content", async () => {
  const req = new Request("https://example.com/openapi", {
    headers: { Origin: "https://startmyloveengine.com" }
  });
  const res = await worker.fetch(req, { CLICKS } as any);
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toContain("text/yaml");
  const text = await res.text();
  expect(text).toContain("/visit:");
  expect(text).toContain("StartMyLoveEngine Analytics API");
});
