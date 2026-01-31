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
  const vendor = json.vendors.find((row: any) => row.vendor === "test-vendor");
  expect(vendor.plan).toBe("featured");
  expect(Array.isArray(vendor.placementsActive)).toBe(true);
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

test("returns placement counts per vendor", async () => {
  const today = new Date().toISOString().slice(0, 10);
  await CLICKS.put(`plcview:vendor-basic:spotlight:${today}`, "3");
  await CLICKS.put(`plcview:vendor-basic:editor_pick:${today}`, "1");

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
  const json = await response.json();

  const vendor = json.vendors.find((row: any) => row.vendor === "vendor-basic");
  expect(vendor.placements).toEqual([
    { placement: "spotlight", count: 3 },
    { placement: "editor_pick", count: 1 }
  ]);
});

test("returns metaStatus for vendors", async () => {
  const request = new Request("https://example.com/visit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.12",
      "user-agent": "test-agent"
    },
    body: JSON.stringify({
      vendor: "unknown-vendor",
      page: "profile",
      tier: "basic"
    })
  });

  const env = {
    CLICKS,
    ANALYTICS_API_TOKEN: "test-secret"
  } as any;

  await worker.fetch(request, env);

  await worker.fetch(
    new Request("https://example.com/visit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-connecting-ip": "203.0.113.13",
        "user-agent": "test-agent"
      },
      body: JSON.stringify({
        vendor: "vendor-basic",
        page: "profile",
        tier: "basic"
      })
    }),
    env
  );

  await worker.fetch(
    new Request("https://example.com/visit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-connecting-ip": "203.0.113.14",
        "user-agent": "test-agent"
      },
      body: JSON.stringify({
        vendor: "test-vendor",
        page: "profile",
        tier: "basic"
      })
    }),
    env
  );

  const statsRequest = new Request(
    "https://example.com/api/stats?site=StartMyLoveEngine&range=7d",
    {
      headers: { Authorization: "Bearer test-secret" }
    }
  );

  const response = await worker.fetch(statsRequest, env);
  const json = await response.json();

  const unknown = json.vendors.find((row: any) => row.vendor === "unknown-vendor");
  const ok = json.vendors.find((row: any) => row.vendor === "vendor-basic");
  const mismatch = json.vendors.find((row: any) => row.vendor === "test-vendor");

  expect(unknown.plan).toBe("unknown");
  expect(unknown.metaStatus).toBe("missing");

  expect(ok.plan).toBe("basic");
  expect(ok.metaStatus).toBe("ok");

  expect(mismatch.plan).toBe("featured");
  expect(mismatch.metaStatus).toBe("mismatch");
});
