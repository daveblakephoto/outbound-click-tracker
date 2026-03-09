import { afterEach, expect, test, vi } from "vitest";
import worker from "../src/worker";

const makeRequest = (range = "7d") =>
  new Request(`https://example.com/api/stats?site=StartMyLoveEngine&range=${range}`, {
    headers: { Authorization: "Bearer test-secret" }
  });

const makeEnv = () =>
  ({
    ANALYTICS_API_TOKEN: "test-secret",
    ANALYTICS_ENGINE_ACCOUNT_ID: "acct",
    ANALYTICS_ENGINE_API_TOKEN: "token",
    ANALYTICS_ENGINE_DATASET: "analytics_events"
  }) as any;

afterEach(() => {
  vi.restoreAllMocks();
});

test("returns current stats from Analytics Engine", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
    async (_url, init) => {
      const sql = String(init?.body || "");
      if (sql.includes("blob1 = 'click'")) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                vendor: "dave-blake",
                click_type: "website",
                date: today,
                count: 3
              }
            ]
          })
        } as any;
      }
      if (sql.includes("blob1 = 'view'") && sql.includes("GROUP BY vendor, page")) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                vendor: "dave-blake",
                page: "profile",
                plan_observed: "featured",
                legacy_tier: "",
                city: "brisbane",
                agency_slug: "viviens-brisbane",
                page_type: "agency-rates",
                count: 4
              }
            ]
          })
        } as any;
      }
      if (sql.includes("blob1 = 'view'") && sql.includes("GROUP BY date")) {
        return {
          ok: true,
          json: async () => ({ data: [{ date: today, count: 4 }] })
        } as any;
      }
      if (sql.includes("blob1 = 'unique_view'")) {
        return {
          ok: true,
          json: async () => ({ data: [{ vendor: "dave-blake", date: today, count: 3 }] })
        } as any;
      }
      return {
        ok: true,
        json: async () => ({ data: [] })
      } as any;
    }
  );

  const response = await worker.fetch(makeRequest(), makeEnv());
  fetchSpy.mockRestore();

  expect(response.status).toBe(200);

  const json = await response.json();
  expect(json.dataSource).toBe("ae");
  expect(response.headers.get("X-Data-Source")).toBe("ae");
  expect(json.vendors.length).toBeGreaterThan(0);
  const vendor = json.vendors.find((row: any) => row.vendor === "dave-blake");
  expect(vendor.plan).toBe("featured");
  expect(Array.isArray(vendor.placementsActive)).toBe(true);
  expect(vendor.website).toBe(3);
});

test("includes event funnel breakdown when event rows exist", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
    async (_url, init) => {
      const sql = String(init?.body || "");
      if (sql.includes("blob1 = 'event'")) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                vendor: "dave-blake",
                page: "models-contact",
                event_type: "submit",
                event_name: "db_contact_form_submit_success",
                date: today,
                event_context: JSON.stringify({
                  custom: {
                    funnel_step: "submit_success",
                    pathway: "aspiring",
                    timeline: "2-4-weeks"
                  }
                }),
                count: 3
              },
              {
                vendor: "dave-blake",
                page: "models-contact",
                event_type: "error",
                event_name: "db_contact_form_submit_error",
                date: today,
                event_context: JSON.stringify({
                  custom: {
                    funnel_step: "submit_error",
                    error_type: "client_validation",
                    field_name: "age"
                  }
                }),
                count: 2
              }
            ]
          })
        } as any;
      }
      if (sql.includes("GROUP BY source_host, source_env, record_type")) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                source_host: "staging.dave-blake.com",
                source_env: "staging",
                record_type: "event",
                count: 5
              },
              {
                source_host: "staging.dave-blake.com",
                source_env: "staging",
                record_type: "referrer",
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

  const response = await worker.fetch(makeRequest(), makeEnv());
  fetchSpy.mockRestore();

  expect(response.status).toBe(200);
  const json = await response.json();
  expect(json.events.total).toBe(5);
  expect(
    json.events.byName.some(
      (row: any) =>
        row.eventName === "db_contact_form_submit_success" && row.count === 3
    )
  ).toBe(true);
  expect(
    json.events.errors.byType.some(
      (row: any) => row.errorType === "client_validation" && row.count === 2
    )
  ).toBe(true);
  expect(
    json.events.byPathway.some(
      (row: any) => row.pathway === "aspiring" && row.count === 3
    )
  ).toBe(true);
  expect(
    json.events.bySourceHost.some(
      (row: any) => row.sourceHost === "staging.dave-blake.com" && row.count === 7
    )
  ).toBe(true);
  expect(
    json.events.bySourceEnvironment.some(
      (row: any) => row.sourceEnvironment === "staging" && row.count === 7
    )
  ).toBe(true);
});

test("clamps unique views to total views", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
    async (_url, init) => {
      const sql = String(init?.body || "");
      if (sql.includes("blob1 = 'view'") && sql.includes("GROUP BY vendor, page")) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                vendor: "dave-blake",
                page: "profile",
                plan_observed: "featured",
                legacy_tier: "",
                city: "",
                agency_slug: "",
                page_type: "",
                count: 2
              }
            ]
          })
        } as any;
      }
      if (sql.includes("blob1 = 'view'") && sql.includes("GROUP BY date")) {
        return {
          ok: true,
          json: async () => ({ data: [{ date: today, count: 2 }] })
        } as any;
      }
      if (sql.includes("blob1 = 'unique_view'")) {
        return {
          ok: true,
          json: async () => ({ data: [{ vendor: "dave-blake", date: today, count: 5 }] })
        } as any;
      }
      return {
        ok: true,
        json: async () => ({ data: [] })
      } as any;
    }
  );

  const response = await worker.fetch(makeRequest(), makeEnv());
  fetchSpy.mockRestore();

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

  const response = await worker.fetch(request, makeEnv());
  expect(response.status).toBe(405);
});

test("returns CORS headers on /api/stats preflight for local dashboard origin", async () => {
  const request = new Request(
    "https://example.com/api/stats?site=StartMyLoveEngine&range=7d",
    {
      method: "OPTIONS",
      headers: {
        Origin: "http://127.0.0.1:5500",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Authorization"
      }
    }
  );

  const response = await worker.fetch(request, makeEnv());
  expect(response.status).toBe(204);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
    "http://127.0.0.1:5500"
  );
  expect(response.headers.get("Access-Control-Allow-Methods")).toContain("GET");
});

test("includes CORS headers on unauthorized /api/stats", async () => {
  const request = new Request(
    "https://example.com/api/stats?site=StartMyLoveEngine&range=7d",
    {
      headers: {
        Origin: "https://smle.mocha.app"
      }
    }
  );

  const response = await worker.fetch(request, makeEnv());
  expect(response.status).toBe(401);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
    "https://smle.mocha.app"
  );
});

test("includes CORS headers on successful /api/stats for mocha dashboard origin", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
    async (_url, init) => {
      const sql = String(init?.body || "");
      if (sql.includes("blob1 = 'view'") && sql.includes("GROUP BY date")) {
        return {
          ok: true,
          json: async () => ({ data: [{ date: today, count: 1 }] })
        } as any;
      }
      return {
        ok: true,
        json: async () => ({ data: [] })
      } as any;
    }
  );

  const request = new Request(
    "https://example.com/api/stats?site=StartMyLoveEngine&range=7d",
    {
      headers: {
        Authorization: "Bearer test-secret",
        Origin: "https://smle.mocha.app"
      }
    }
  );

  const response = await worker.fetch(request, makeEnv());
  fetchSpy.mockRestore();

  expect(response.status).toBe(200);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
    "https://smle.mocha.app"
  );
});

test("requires site parameter", async () => {
  const request = new Request("https://example.com/api/stats?range=7d", {
    headers: { Authorization: "Bearer test-secret" }
  });

  const response = await worker.fetch(request, makeEnv());
  expect(response.status).toBe(400);
});

test("rejects invalid range", async () => {
  const request = new Request(
    "https://example.com/api/stats?site=StartMyLoveEngine&range=1y",
    {
      headers: { Authorization: "Bearer test-secret" }
    }
  );

  const response = await worker.fetch(request, makeEnv());
  expect(response.status).toBe(400);
});

test("rejects invalid source_host", async () => {
  const request = new Request(
    "https://example.com/api/stats?site=StartMyLoveEngine&range=7d&source_host=bad host",
    {
      headers: { Authorization: "Bearer test-secret" }
    }
  );

  const response = await worker.fetch(request, makeEnv());
  expect(response.status).toBe(400);
  expect(await response.text()).toBe("Invalid source_host");
});

test("applies source_host filter to analytics engine queries", async () => {
  const sqlStatements: string[] = [];
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
    async (_url, init) => {
      sqlStatements.push(String(init?.body || ""));
      return {
        ok: true,
        json: async () => ({ data: [] })
      } as any;
    }
  );

  const request = new Request(
    "https://example.com/api/stats?site=StartMyLoveEngine&range=7d&source_host=staging.dave-blake.com",
    {
      headers: { Authorization: "Bearer test-secret" }
    }
  );

  const response = await worker.fetch(request, makeEnv());
  fetchSpy.mockRestore();

  expect(response.status).toBe(200);
  expect(
    sqlStatements.some(sql => sql.includes("AND blob16 = 'staging.dave-blake.com'"))
  ).toBe(true);
  expect(sqlStatements.some(sql => sql.includes("AND blob17 = 'production'"))).toBe(
    true
  );
});

test("applies environment filter and traffic mode to analytics engine queries", async () => {
  const sqlStatements: string[] = [];
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
    async (_url, init) => {
      sqlStatements.push(String(init?.body || ""));
      return {
        ok: true,
        json: async () => ({ data: [] })
      } as any;
    }
  );

  const request = new Request(
    "https://example.com/api/stats?site=StartMyLoveEngine&range=7d&environment=staging&traffic=all",
    {
      headers: { Authorization: "Bearer test-secret" }
    }
  );

  const response = await worker.fetch(request, makeEnv());
  fetchSpy.mockRestore();

  expect(response.status).toBe(200);
  expect(
    sqlStatements.some(sql => sql.includes("AND blob17 = 'staging'"))
  ).toBe(true);
  expect(
    sqlStatements.some(sql => sql.includes("AND blob17 = 'production'"))
  ).toBe(false);
});

test("rejects range larger than 90d", async () => {
  const request = new Request(
    "https://example.com/api/stats?site=StartMyLoveEngine&range=180d",
    {
      headers: { Authorization: "Bearer test-secret" }
    }
  );

  const response = await worker.fetch(request, makeEnv());
  expect(response.status).toBe(400);
  expect(await response.text()).toMatch(/Max range is 90 days/);
});

test("returns 503 when analytics engine is unconfigured", async () => {
  const response = await worker.fetch(makeRequest(), {
    ANALYTICS_API_TOKEN: "test-secret"
  } as any);

  expect(response.status).toBe(503);
  expect(response.headers.get("X-Data-Warning")).toBe("ae_unconfigured");
  const json = await response.json();
  expect(json.dataSource).toBe("ae");
  expect(json.dataWarning).toBe("ae_unconfigured");
});

test("returns 503 when analytics engine query fails", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: false,
    status: 422,
    text: async () => "sql parser error"
  } as any);

  const response = await worker.fetch(makeRequest(), makeEnv());
  fetchSpy.mockRestore();

  expect(response.status).toBe(503);
  expect(response.headers.get("X-Data-Source")).toBe("ae");
  expect(response.headers.get("X-Data-Warning")).toBe("ae_failed");
  const json = await response.json();
  expect(json.dataSource).toBe("ae");
  expect(json.dataWarning).toBe("ae_failed");
});

test("returns tier views from observed legacy tiers", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
    async (_url, init) => {
      const sql = String(init?.body || "");
      if (sql.includes("blob1 = 'view'") && sql.includes("GROUP BY vendor, page")) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                vendor: "dave-blake",
                page: "profile",
                plan_observed: "featured",
                legacy_tier: "spotlight",
                city: "",
                agency_slug: "",
                page_type: "",
                count: 4
              },
              {
                vendor: "dave-blake",
                page: "profile",
                plan_observed: "featured",
                legacy_tier: "featured",
                city: "",
                agency_slug: "",
                page_type: "",
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

  const response = await worker.fetch(makeRequest(), makeEnv());
  fetchSpy.mockRestore();

  expect(response.status).toBe(200);

  const json = await response.json();
  expect(json.tierViews.spotlight).toBe(4);
  expect(json.tierViews.featured).toBe(2);
  expect(json.tierViews.basic).toBe(0);
  expect(json.tierViews.unpaid).toBe(0);
});
