import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
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
  await CLICKS.put(`dave-blake:website:${today}`, "3");

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
  expect(json.dataSource).toBe("kv");
  expect(response.headers.get("X-Data-Source")).toBe("kv");
  expect(json.vendors.length).toBeGreaterThan(0);
  const vendor = json.vendors.find((row: any) => row.vendor === "dave-blake");
  expect(vendor.plan).toBe("featured");
  expect(Array.isArray(vendor.placementsActive)).toBe(true);
});

test("clamps unique views to total views", async () => {
  const today = new Date().toISOString().slice(0, 10);
  await CLICKS.put(`view:dave-blake:${today}`, "2");
  await CLICKS.put(`uview:dave-blake:${today}`, "5");

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
  const vendor = json.vendors.find((row: any) => row.vendor === "dave-blake");
  expect(vendor.views).toBe(2);
  expect(vendor.uniqueViews).toBe(2);

  const dailyViews = json.dailyViews.find(
    (row: any) => row.date === today
  );
  const dailyUnique = json.dailyUniqueViews.find(
    (row: any) => row.date === today
  );
  expect(dailyViews.total).toBe(2);
  expect(dailyUnique.total).toBe(2);
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

test("rejects range larger than 90d", async () => {
  const request = new Request(
    "https://example.com/api/stats?site=StartMyLoveEngine&range=180d",
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
  expect(await response.text()).toMatch(/Max range is 90 days/);
});

test("falls back to KV when analytics engine fails", async () => {
  const today = new Date().toISOString().slice(0, 10);
  await CLICKS.put(`dave-blake:website:${today}`, "2");

  const request = new Request(
    "https://example.com/api/stats?site=StartMyLoveEngine&range=7d",
    {
      headers: { Authorization: "Bearer test-secret" }
    }
  );

  const env = {
    CLICKS,
    ANALYTICS_API_TOKEN: "test-secret",
    ANALYTICS_ENGINE_ACCOUNT_ID: "acct",
    ANALYTICS_ENGINE_API_TOKEN: "token",
    ANALYTICS_ENGINE_DATASET: "analytics_events"
  } as any;

  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => "sql parser error"
    } as any);

  const response = await worker.fetch(request, env);
  fetchSpy.mockRestore();

  expect(response.status).toBe(200);
  expect(response.headers.get("X-Data-Source")).toBe("kv");
  expect(response.headers.get("X-Data-Warning")).toBe("ae_failed");
  const json = await response.json();
  expect(json.dataSource).toBe("kv");
  expect(json.dataWarning).toBe("ae_failed");
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
  await CLICKS.put(`plcview:dave-blake:spotlight:${today}`, "3");
  await CLICKS.put(`plcview:dave-blake:home:${today}`, "1");

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

  const vendor = json.vendors.find((row: any) => row.vendor === "dave-blake");
  expect(vendor.placements).toEqual([
    { placement: "spotlight", count: 3 },
    { placement: "home", count: 1 }
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
        vendor: "nahid-kholghi",
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
        vendor: "dave-blake",
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
  const ok = json.vendors.find((row: any) => row.vendor === "nahid-kholghi");
  const mismatch = json.vendors.find((row: any) => row.vendor === "dave-blake");

  expect(unknown.plan).toBe("unknown");
  expect(unknown.metaStatus).toBe("missing");

  expect(ok.plan).toBe("basic");
  expect(ok.metaStatus).toBe("ok");

  expect(mismatch.plan).toBe("featured");
  expect(mismatch.metaStatus).toBe("mismatch");
});
