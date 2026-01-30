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

test("returns current stats", async () => {
  const today = new Date().toISOString().slice(0, 10);
  await CLICKS.put(`test-vendor:website:${today}`, "3");

  const request = new Request(
    "https://example.com/api/stats?site=StartMyLoveEngine&range=7d",
    {
      headers: { Authorization: "Bearer test-secret" }
    }
  );

  const env = {
    CLICKS,
    ANALYTICS_API_TOKEN: "test-secret"
  } as any;

  const response = await worker.fetch(request, env);
  expect(response.status).toBe(200);

  const json = await response.json();
  expect(json.vendors.length).toBeGreaterThan(0);
});

test("rejects non-GET requests", async () => {
  const request = new Request(
    "https://example.com/api/stats?site=StartMyLoveEngine&range=7d",
    { method: "POST" }
  );

  const env = {
    CLICKS,
    ANALYTICS_API_TOKEN: "test-secret"
  } as any;

  const response = await worker.fetch(request, env);
  expect(response.status).toBe(405);
});

test("requires site parameter", async () => {
  const request = new Request("https://example.com/api/stats?range=7d", {
    headers: { Authorization: "Bearer test-secret" }
  });

  const env = {
    CLICKS,
    ANALYTICS_API_TOKEN: "test-secret"
  } as any;

  const response = await worker.fetch(request, env);
  expect(response.status).toBe(400);
});

test("rejects invalid range", async () => {
  const request = new Request(
    "https://example.com/api/stats?site=StartMyLoveEngine&range=1y",
    {
      headers: { Authorization: "Bearer test-secret" }
    }
  );

  const env = {
    CLICKS,
    ANALYTICS_API_TOKEN: "test-secret"
  } as any;

  const response = await worker.fetch(request, env);
  expect(response.status).toBe(400);
});

test("returns tier views", async () => {
  const today = new Date().toISOString().slice(0, 10);
  await CLICKS.put(`tview:spotlight:${today}`, "4");
  await CLICKS.put(`tview:featured:${today}`, "2");

  const request = new Request(
    "https://example.com/api/stats?site=StartMyLoveEngine&range=7d",
    {
      headers: { Authorization: "Bearer test-secret" }
    }
  );

  const env = {
    CLICKS,
    ANALYTICS_API_TOKEN: "test-secret"
  } as any;

  const response = await worker.fetch(request, env);
  expect(response.status).toBe(200);

  const json = await response.json();
  expect(json.tierViews.spotlight).toBe(4);
  expect(json.tierViews.featured).toBe(2);
  expect(json.tierViews.basic).toBe(0);
  expect(json.tierViews.unpaid).toBe(0);
});
