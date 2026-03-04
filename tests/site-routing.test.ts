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

test("visit resolves site from allowed origin mapping on shared host", async () => {
  const points: any[] = [];
  const request = new Request("https://go.startmyloveengine.com/visit", {
    method: "POST",
    headers: {
      Origin: "https://dave-blake.com",
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.13",
      "user-agent": "test-agent"
    },
    body: JSON.stringify({
      vendor: "test-vendor",
      page: "agency-rates",
      tier: "featured"
    })
  });

  const env = {
    CLICKS,
    ANALYTICS_ENGINE: {
      writeDataPoint: (point: any) => points.push(point)
    },
    SITE_MAP_JSON:
      "{\"go.startmyloveengine.com\":\"startmyloveengine\",\"dave-blake.com\":\"dave-blake.com\"}"
  } as any;

  const response = await worker.fetch(request, env);
  expect(response.status).toBe(204);
  expect(points.length).toBeGreaterThan(0);
  expect(points.some(point => point?.blobs?.[1] === "dave-blake.com")).toBe(
    true
  );
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

test("stats accepts dotted site slug when allowlisted", async () => {
  const request = new Request(
    "https://example.com/api/stats?site=dave-blake.com&range=7d",
    {
      headers: { Authorization: "Bearer test-secret" }
    }
  );

  const env = {
    CLICKS,
    ANALYTICS_API_TOKEN: "test-secret",
    SITE_ALLOWLIST: "startmyloveengine,dave-blake.com"
  } as any;

  const response = await worker.fetch(request, env);
  expect(response.status).toBe(200);
});

test("stats for non-metadata site derives plan from observed events", async () => {
  const visit = new Request("https://example.com/visit", {
    method: "POST",
    headers: {
      Origin: "https://dave-blake.com",
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.22",
      "user-agent": "test-agent"
    },
    body: JSON.stringify({
      site: "dave-blake.com",
      vendor: "vivbne26",
      page: "agency-rates",
      tier: "featured",
      plan: "featured"
    })
  });

  const env = {
    CLICKS,
    ANALYTICS_API_TOKEN: "test-secret",
    SITE_ALLOWLIST: "startmyloveengine,dave-blake.com"
  } as any;

  const visitResponse = await worker.fetch(visit, env);
  expect(visitResponse.status).toBe(204);

  const statsRequest = new Request(
    "https://example.com/api/stats?site=dave-blake.com&range=7d",
    {
      headers: { Authorization: "Bearer test-secret" }
    }
  );
  const statsResponse = await worker.fetch(statsRequest, env);
  expect(statsResponse.status).toBe(200);
  const json = await statsResponse.json();
  const vendor = json.vendors.find((row: any) => row.vendor === "vivbne26");
  expect(vendor).toBeTruthy();
  expect(vendor.plan).toBe("featured");
  expect(vendor.metaStatus).toBe("n/a");
});
