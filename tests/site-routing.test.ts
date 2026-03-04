import { afterEach, expect, test, vi } from "vitest";
import worker from "../src/worker";

const baseEnv = {
  ANALYTICS_API_TOKEN: "test-secret",
  ANALYTICS_ENGINE_ACCOUNT_ID: "acct",
  ANALYTICS_ENGINE_API_TOKEN: "token",
  ANALYTICS_ENGINE_DATASET: "analytics_events"
} as const;

afterEach(() => {
  vi.restoreAllMocks();
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

  const writes: any[] = [];
  const env = {
    SITE_MAP_JSON: "{\"smle.mocha.app\":\"startmyloveengine\"}",
    ANALYTICS_ENGINE: {
      writeDataPoint: (point: any) => writes.push(point)
    }
  } as any;

  const response = await worker.fetch(request, env);
  expect(response.status).toBe(204);
  expect(writes.some(point => point?.blobs?.[1] === "startmyloveengine")).toBe(true);
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
    SITE_ALLOWLIST: "startmyloveengine,othersite",
    ANALYTICS_ENGINE: { writeDataPoint() {} }
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
    ...baseEnv,
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

  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ data: [] })
  } as any);

  const env = {
    ...baseEnv,
    SITE_ALLOWLIST: "startmyloveengine,dave-blake.com"
  } as any;

  const response = await worker.fetch(request, env);
  fetchSpy.mockRestore();

  expect(response.status).toBe(200);
  expect(response.headers.get("X-Data-Source")).toBe("ae");
});

test("stats for non-metadata site derives plan from observed events", async () => {
  const statsRequest = new Request(
    "https://example.com/api/stats?site=dave-blake.com&range=7d",
    {
      headers: { Authorization: "Bearer test-secret" }
    }
  );

  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
    async (_url, init) => {
      const sql = String(init?.body || "");
      if (sql.includes("blob1 = 'view'") && sql.includes("GROUP BY vendor, page")) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                vendor: "vivbne26",
                page: "agency-rates",
                plan_observed: "featured",
                legacy_tier: "",
                city: "brisbane",
                agency_slug: "viviens-brisbane",
                page_type: "agency-rates",
                count: 2
              }
            ]
          })
        } as any;
      }
      return {
        ok: true,
        json: async () => ({ data: [] })
      } as any;
    }
  );

  const env = {
    ...baseEnv,
    SITE_ALLOWLIST: "startmyloveengine,dave-blake.com"
  } as any;

  const statsResponse = await worker.fetch(statsRequest, env);
  fetchSpy.mockRestore();

  expect(statsResponse.status).toBe(200);
  const json = await statsResponse.json();
  const vendor = json.vendors.find((row: any) => row.vendor === "vivbne26");
  expect(vendor).toBeTruthy();
  expect(vendor.plan).toBe("featured");
  expect(vendor.metaStatus).toBe("n/a");
});
