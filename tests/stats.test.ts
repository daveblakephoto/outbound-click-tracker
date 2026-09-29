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
                event_name: "db_contact_form_submit_attempt",
                date: today,
                event_environment: "production",
                event_context: JSON.stringify({
                  custom: {
                    funnel_step: "submit_attempt",
                    pathway: "represented",
                    timeline: "1-3-months",
                    referral_source: "Viviens Brisbane",
                    representation: "Viviens",
                    session_id: "sess_attr_2",
                    first_touch_source: "google",
                    last_touch_source: "google",
                    first_touch_landing_page: "/models/contact",
                    first_touch_utm_source: "google",
                    event_ts_client: `${today}T07:50:00.000Z`
                  }
                }),
                count: 4
              },
              {
                vendor: "dave-blake",
                page: "models-contact",
                event_type: "submit",
                event_name: "db_contact_form_submit_success",
                date: today,
                event_environment: "production",
                event_context: JSON.stringify({
                  custom: {
                    funnel_step: "submit_success",
                    pathway: "represented",
                    timeline: "1-3-months",
                    referral_source: "Viviens Brisbane",
                    representation: "Viviens",
                    session_id: "sess_attr_2",
                    first_touch_source: "google",
                    last_touch_source: "google",
                    first_touch_landing_page: "/models/contact",
                    first_touch_utm_source: "google",
                    event_ts_client: `${today}T08:20:00.000Z`
                  }
                }),
                count: 2
              },
              {
                vendor: "dave-blake",
                page: "models-contact",
                event_type: "submit",
                event_name: "db_contact_form_submit_success",
                date: today,
                event_environment: "production",
                event_context: JSON.stringify({
                  custom: {
                    funnel_step: "submit_success",
                    pathway: "aspiring",
                    timeline: "2-4-weeks",
                    session_id: "sess_attr_1",
                    first_touch_source: "instagram",
                    last_touch_source: "direct",
                    first_touch_landing_page: "/models",
                    first_touch_utm_source: "instagram",
                    event_ts_client: `${today}T08:00:00.000Z`
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
                event_environment: "production",
                event_context: JSON.stringify({
                  custom: {
                    funnel_step: "submit_error",
                    error_type: "client_validation",
                    field_name: "age",
                    session_id: "sess_attr_1",
                    first_touch_source: "instagram",
                    last_touch_source: "direct",
                    first_touch_landing_page: "/models",
                    first_touch_utm_source: "instagram",
                    event_ts_client: `${today}T08:05:00.000Z`
                  }
                }),
                count: 2
              },
              {
                vendor: "dave-blake",
                page: "articles-top-modelling-agencies-in-brisbane-how-to-get-signed",
                event_type: "click",
                event_name: "db_outbound_click",
                date: today,
                event_environment: "production",
                event_context: JSON.stringify({
                  custom: {
                    funnel_step: "outbound_click",
                    target_domain: "viviensmodels.com.au",
                    outbound_kind: "external"
                  }
                }),
                count: 1
              },
              {
                vendor: "dave-blake",
                page: "articles",
                event_type: "custom",
                event_name: "db_scroll_depth",
                date: today,
                event_environment: "production",
                event_context: JSON.stringify({
                  custom: {
                    funnel_step: "scroll_depth",
                    scroll_depth_pct: 50,
                    session_id: "sess_attr_1",
                    first_touch_source: "instagram",
                    last_touch_source: "direct",
                    first_touch_landing_page: "/models",
                    first_touch_utm_source: "instagram",
                    event_ts_client: `${today}T08:10:00.000Z`
                  }
                }),
                count: 1
              },
              {
                vendor: "dave-blake",
                page: "articles",
                event_type: "custom",
                event_name: "db_engaged_time",
                date: today,
                event_environment: "production",
                event_context: JSON.stringify({
                  custom: {
                    funnel_step: "engaged_time",
                    engaged_time_seconds: 30,
                    session_id: "sess_attr_1",
                    first_touch_source: "instagram",
                    last_touch_source: "direct",
                    first_touch_landing_page: "/models",
                    first_touch_utm_source: "instagram",
                    event_ts_client: `${today}T08:12:00.000Z`
                  }
                }),
                count: 1
              },
              {
                vendor: "dave-blake",
                page: "articles",
                event_type: "click",
                event_name: "db_nav_click",
                date: today,
                event_environment: "production",
                event_context: JSON.stringify({
                  custom: {
                    funnel_step: "nav_click",
                    nav_area: "header_nav",
                    session_id: "sess_attr_1",
                    first_touch_source: "instagram",
                    last_touch_source: "direct",
                    first_touch_landing_page: "/models",
                    first_touch_utm_source: "instagram",
                    event_ts_client: `${today}T08:15:00.000Z`
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
  expect(json.events.total).toBe(16);
  expect(
    json.events.byName.some(
      (row: any) =>
        row.eventName === "db_contact_form_submit_success" && row.count === 5
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
  expect(
    json.events.byTargetDomain.some(
      (row: any) => row.targetDomain === "viviensmodels.com.au" && row.count === 1
    )
  ).toBe(true);
  expect(
    json.events.byOutboundKind.some(
      (row: any) => row.outboundKind === "external" && row.count === 1
    )
  ).toBe(true);
  expect(
    json.events.byScrollDepth.some(
      (row: any) => row.scrollDepth === "50" && row.count === 1
    )
  ).toBe(true);
  expect(
    json.events.byEngagedTimeSeconds.some(
      (row: any) => row.engagedTimeSeconds === "30" && row.count === 1
    )
  ).toBe(true);
  expect(
    json.events.byNavArea.some(
      (row: any) => row.navArea === "header_nav" && row.count === 2
    )
  ).toBe(true);
  expect(
    json.events.attribution.byFirstTouchSource.some(
      (row: any) => row.source === "instagram" && row.count === 1
    )
  ).toBe(true);
  expect(
    json.events.attribution.byLastTouchSource.some(
      (row: any) => row.source === "direct" && row.count === 1
    )
  ).toBe(true);
  expect(json.events.attribution.sessionsWithConversion).toBe(2);
  expect(json.events.leads.total).toBe(5);
  expect(
    json.events.leads.byType.some(
      (row: any) => row.leadType === "model_test" && row.count === 5
    )
  ).toBe(true);
  expect(json.events.referralAgencies.totals.attempts).toBe(4);
  expect(json.events.referralAgencies.totals.successes).toBe(5);
  expect(
    json.events.referralAgencies.byAgency.some(
      (row: any) =>
        row.agency === "viviens" &&
        row.attempts === 4 &&
        row.successes === 2
    )
  ).toBe(true);
});

test("includes agency vendor contact click-through metrics", async () => {
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
                page: "agency-rates",
                event_type: "click",
                event_name: "db_agency_rates_cta_click",
                date: today,
                event_environment: "production",
                event_context: JSON.stringify({
                  custom: {
                    funnel_step: "agency_rates_cta_click",
                    to_path: "/models/contact/",
                    vendor: "viviens",
                    agency_slug: "viviens-brisbane",
                    session_id: "sess_agency_1"
                  }
                }),
                count: 3
              },
              {
                vendor: "dave-blake",
                page: "agency-rates",
                event_type: "click",
                event_name: "db_agency_rates_cta_click",
                date: today,
                event_environment: "production",
                event_context: JSON.stringify({
                  custom: {
                    funnel_step: "agency_rates_cta_click",
                    to_path: "/contact/",
                    vendor: "viviens",
                    agency_slug: "viviens-brisbane",
                    session_id: "sess_agency_2"
                  }
                }),
                count: 2
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
                vendor: "viviens",
                page: "agency-rates",
                plan_observed: "featured",
                legacy_tier: "",
                city: "brisbane",
                agency_slug: "viviens-brisbane",
                page_type: "agency-rates",
                count: 10
              }
            ]
          })
        } as any;
      }
      if (sql.includes("blob1 = 'view'") && sql.includes("GROUP BY date")) {
        return {
          ok: true,
          json: async () => ({ data: [{ date: today, count: 10 }] })
        } as any;
      }
      if (sql.includes("blob1 = 'unique_view'")) {
        return {
          ok: true,
          json: async () => ({ data: [{ vendor: "viviens", date: today, count: 8 }] })
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
  const vendor = json.vendors.find((row: any) => row.vendor === "viviens");
  expect(vendor).toBeTruthy();
  expect(vendor.views).toBe(10);
  expect(vendor.modelContactClicks).toBe(3);
  expect(vendor.modelContactCtr).toBe(30);
  expect(vendor.outboundLeakageRate).toBe(0);
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

test("aggregates verified leads, CTA clicks and funnel without counting test sessions", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const row = (event_name: string, session_id: string, custom: Record<string, unknown> = {}) => ({
    vendor: "dave-blake",
    page: event_name === "db_cta_click" ? "models-digitals" : "models-contact",
    event_type: event_name.includes("error") ? "error" : "custom",
    event_name,
    date: today,
    event_environment: "production",
    event_context: JSON.stringify({ custom: { session_id, ...custom } }),
    count: 1
  });
  const source = {
    first_touch_source: "www.google.com",
    first_touch_landing_page: "/models/digitals/?utm_source=ignored",
    first_touch_utm_campaign: "spring"
  };
  const rows = [
    row("db_cta_click", "session-a", { cta_id: "brisbane_digitals_hero_enquiry", ...source }),
    row("db_cta_click", "session-a", { cta_id: "brisbane_digitals_hero_enquiry", ...source }),
    row("db_contact_form_view", "session-a", source),
    row("db_contact_form_start", "session-a", source),
    row("db_contact_form_validation_error", "session-a", source),
    row("db_contact_form_submit_error", "session-a", source),
    row("db_contact_form_submit_success", "session-a", source),
    row("db_contact_form_submit_success", "session-b", {
      first_touch_source: "direct",
      first_touch_landing_page: "/articles/top-modelling-agencies-in-brisbane-how-to-get-signed/"
    }),
    row("db_cta_click", "session-test", {
      cta_id: "brisbane_digitals_hero_enquiry", is_test_traffic: "true"
    }),
    row("db_contact_form_submit_success", "session-test", {
      ...source, is_test_traffic: "true"
    }),
    row("db_cta_click", "session-missing", { cta_id: "invalid CTA!" }),
    row("db_contact_form_submit_success", "session-missing")
  ];
  const statements: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const sql = String(init?.body || "");
    statements.push(sql);
    return { ok: true, json: async () => ({ data: sql.includes("blob1 = 'event'") ? rows : [] }) } as any;
  });

  const request = new Request(
    "https://example.com/api/stats?site=dave-blake.com&range=7d&environment=production&traffic=production&source_host=dave-blake.com",
    { headers: { Authorization: "Bearer test-secret" } }
  );
  const response = await worker.fetch(request, {
    ...makeEnv(), SITE_ALLOWLIST: "startmyloveengine,dave-blake.com"
  });
  const json = await response.json() as any;
  expect(response.status).toBe(200);
  expect(json.events.verifiedLeads).toMatchObject({ total: 3, observedSessions: 3 });
  expect(json.events.verifiedLeads.byFirstTouchSource).toEqual([
    { source: "www.google.com", count: 1 },
    { source: "direct", count: 1 },
    { source: "unknown", count: 1 }
  ]);
  expect(json.events.verifiedLeads.byFirstTouchLandingPage).toContainEqual({
    path: "/models/digitals/", leads: 1
  });
  expect(json.events.verifiedLeads.byFirstTouchUtmCampaign).toContainEqual({
    campaign: "spring", count: 1
  });
  expect(json.events.ctaClicks).toContainEqual({
    ctaId: "brisbane_digitals_hero_enquiry", clicks: 2
  });
  expect(json.events.ctaClicks).toContainEqual({ ctaId: "unknown", clicks: 1 });
  expect(json.events.funnel).toMatchObject({
    observedSessions: 3,
    eventCounts: {
      ctaClicks: 3, formViews: 1, formStarts: 1, validationErrors: 1,
      submitErrors: 1, verifiedLeads: 3
    },
    observedSessionCounts: { ctaClicks: 2, verifiedLeads: 3 }
  });
  expect(json.events.leads.total).toBe(3);
  expect(statements.filter(sql => sql.includes("blob1 = 'event'")).every(sql =>
    sql.includes("blob16 = 'dave-blake.com'") &&
    (sql.match(/AND blob17 = 'production'/g) || []).length === 1
  )).toBe(true);
});

test("test traffic on the production host appears only in the test slice", async () => {
  const today = new Date().toISOString().slice(0, 10);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => ({
    ok: true,
    json: async () => ({ data: String(init?.body || "").includes("blob1 = 'event'") ? [{
      vendor: "dave-blake", page: "models-contact", event_type: "submit",
      event_name: "db_contact_form_submit_success", date: today,
      event_environment: "production", count: 1,
      event_context: JSON.stringify({ custom: {
        session_id: "session-test", is_test_traffic: "true",
        first_touch_source: "utm:analytics_smoke"
      } })
    }, {
      vendor: "dave-blake", page: "models-contact", event_type: "view",
      event_name: "db_contact_form_view", date: today,
      event_environment: "production", count: 1,
      event_context: JSON.stringify({ custom: { session_id: "session-test" } })
    }] : [] })
  } as any));
  const env = { ...makeEnv(), SITE_ALLOWLIST: "startmyloveengine,dave-blake.com" };
  const request = (traffic: string) => new Request(
    `https://example.com/api/stats?site=dave-blake.com&range=7d&environment=production&traffic=${traffic}`,
    { headers: { Authorization: "Bearer test-secret" } }
  );
  const production = await (await worker.fetch(request("production"), env)).json() as any;
  const testData = await (await worker.fetch(request("test"), env)).json() as any;
  expect(production.events.verifiedLeads.total).toBe(0);
  expect(production.events.verifiedLeads.byFirstTouchSource).toEqual([]);
  expect(production.events.funnel.eventCounts.formViews).toBe(0);
  expect(testData.events.verifiedLeads.total).toBe(1);
  expect(testData.events.funnel.eventCounts.formViews).toBe(1);
  expect(testData.events.verifiedLeads.byFirstTouchSource).toEqual([
    { source: "utm:analytics_smoke", count: 1 }
  ]);
});

test("malformed event context is grouped as unknown without exposing identifiers", async () => {
  const today = new Date().toISOString().slice(0, 10);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => ({
    ok: true,
    json: async () => ({ data: String(init?.body || "").includes("blob1 = 'event'") ? [{
      vendor: "dave-blake", page: "models-contact", event_type: "submit",
      event_name: "db_contact_form_submit_success", date: today,
      event_environment: "production", count: 1, event_context: "{invalid"
    }] : [] })
  } as any));
  const response = await worker.fetch(makeRequest(), makeEnv());
  const json = await response.json() as any;
  expect(response.status).toBe(200);
  expect(json.events.verifiedLeads.total).toBe(1);
  expect(json.events.verifiedLeads.observedSessions).toBe(0);
  expect(json.events.verifiedLeads.byFirstTouchSource).toEqual([
    { source: "unknown", count: 1 }
  ]);
  expect(json.events.verifiedLeads.byFirstTouchLandingPage).toEqual([
    { path: "unknown", leads: 1 }
  ]);
});

test("new decision fields are empty on an empty stats range", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true, json: async () => ({ data: [] })
  } as any);
  const response = await worker.fetch(makeRequest(), makeEnv());
  const json = await response.json() as any;
  expect(json.events.verifiedLeads).toMatchObject({
    total: 0, observedSessions: 0, byFirstTouchSource: [],
    byFirstTouchLandingPage: [], byFirstTouchUtmCampaign: []
  });
  expect(json.events.ctaClicks).toEqual([]);
  expect(json.events.funnel.eventCounts.verifiedLeads).toBe(0);
  expect(json.events.funnel.observedSessionCounts.verifiedLeads).toBe(0);
});

test("classifies a mixed session consistently in every test traffic aggregate", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const row = (name: string, session: string, custom: Record<string, unknown>) => ({
    page: "models-contact", event_type: "custom", event_name: name, date: today,
    event_environment: "production", count: 1,
    event_context: JSON.stringify({ custom: { session_id: session, ...custom } })
  });
  const rows = [
    row("db_cta_click", "mixed-session-123", { cta_id: "mixed_cta" }),
    row("db_contact_form_submit_success", "mixed-session-123", {
      is_test_traffic: "true", first_touch_source: "audit"
    }),
    row("db_contact_form_submit_success", "real-session-123", { first_touch_source: "search" })
  ];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => ({
    ok: true, json: async () => ({ data: String(init?.body).includes("blob1 = 'event'") ? rows : [] })
  } as any));
  const env = { ...makeEnv(), SITE_ALLOWLIST: "startmyloveengine,dave-blake.com" };
  const stats = async (traffic: string) => (await (await worker.fetch(new Request(
    `https://example.com/api/stats?site=dave-blake.com&range=7d&traffic=${traffic}`,
    { headers: { Authorization: "Bearer test-secret" } }
  ), env)).json()) as any;
  const production = await stats("production");
  const testData = await stats("test");
  expect(production.events.byTestTraffic).toEqual([{ trafficType: "production", count: 1 }]);
  expect(production.events.ctaClicks).toEqual([]);
  expect(production.events.verifiedLeads).toMatchObject({ total: 1, observedSessions: 1 });
  expect(production.behaviour.quality.observedSessions).toBe(1);
  expect(testData.events.byTestTraffic).toEqual([{ trafficType: "test", count: 2 }]);
  expect(testData.events.ctaClicks).toEqual([{ ctaId: "mixed_cta", clicks: 1 }]);
  expect(testData.events.verifiedLeads).toMatchObject({ total: 1, observedSessions: 1 });
  expect(testData.behaviour.quality.observedSessions).toBe(1);
});

test("legacy empty environment rows stay out of production reporting", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const rows = ["", "staging", "production"].map((event_environment, i) => ({
    page: "models-contact", event_type: "submit",
    event_name: "db_contact_form_submit_success", date: today,
    event_environment, count: 1,
    event_context: JSON.stringify({ custom: {
      session_id: `environment-${i}`, first_touch_source: event_environment || "legacy"
    } })
  }));
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => ({
    ok: true, json: async () => ({ data: String(init?.body).includes("blob1 = 'event'") ? rows : [] })
  } as any));
  const env = { ...makeEnv(), SITE_ALLOWLIST: "startmyloveengine,dave-blake.com" };
  const stats = async (traffic: string) => (await (await worker.fetch(new Request(
    `https://example.com/api/stats?site=dave-blake.com&range=7d&traffic=${traffic}`,
    { headers: { Authorization: "Bearer test-secret" } }
  ), env)).json()) as any;
  const production = await stats("production");
  const testData = await stats("test");
  expect(production.events.verifiedLeads.total).toBe(1);
  expect(production.events.byTestTraffic).toEqual([{ trafficType: "production", count: 1 }]);
  expect(testData.events.verifiedLeads.total).toBe(2);
  expect(testData.events.byTestTraffic).toEqual([{ trafficType: "test", count: 2 }]);
  expect(production.behaviour.quality.excludedTestEstimate).toBe(2);
});

test("keeps case and characters after position 96 in stored lead attribution", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const campaigns = ["Spring", "spring", `${"C".repeat(96)}A`, `${"C".repeat(96)}B`, "__proto__", "constructor"];
  const rows = campaigns.map((campaign, index) => ({
    page: "models-contact", event_type: "submit",
    event_name: "db_contact_form_submit_success", date: today,
    event_environment: "production", count: 1,
    event_context: JSON.stringify({ custom: {
      session_id: `campaign-session-${index}`,
      first_touch_source: index % 2 ? "Google" : "google",
      first_touch_landing_page: index % 2 ? "/Campaign/" : "/campaign/",
      first_touch_utm_campaign: campaign
    } })
  }));
  rows.push({
    page: "models-digitals", event_type: "click", event_name: "db_cta_click",
    date: today, event_environment: "production", count: 1,
    event_context: JSON.stringify({ custom: { session_id: "cta-constructor", cta_id: "constructor" } })
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => ({
    ok: true,
    json: async () => ({ data: String(init?.body).includes("blob1 = 'event'") ? rows : [] })
  } as any));
  const response = await worker.fetch(new Request(
    "https://example.com/api/stats?site=dave-blake.com&range=7d&traffic=production",
    { headers: { Authorization: "Bearer test-secret" } }
  ), { ...makeEnv(), SITE_ALLOWLIST: "startmyloveengine,dave-blake.com" });
  const json = await response.json() as any;
  expect(response.status).toBe(200);
  expect(json.events.verifiedLeads).toMatchObject({ total: 6, observedSessions: 6 });
  expect(json.events.verifiedLeads.byFirstTouchUtmCampaign).toHaveLength(6);
  for (const campaign of campaigns) {
    expect(json.events.verifiedLeads.byFirstTouchUtmCampaign).toContainEqual({ campaign, count: 1 });
  }
  expect(json.events.verifiedLeads.byFirstTouchSource).toEqual([
    { source: "google", count: 3 }, { source: "Google", count: 3 }
  ]);
  expect(json.events.verifiedLeads.byFirstTouchLandingPage).toEqual([
    { path: "/campaign/", leads: 3 }, { path: "/Campaign/", leads: 3 }
  ]);
  expect(json.events.ctaClicks).toContainEqual({ ctaId: "constructor", clicks: 1 });
});

test("keeps the live stats response fields and behaviour shape", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true, json: async () => ({ data: [] })
  } as any);
  const json = await (await worker.fetch(makeRequest(), makeEnv())).json() as any;
  const liveTopLevel = ["site", "environment", "sourceHostFilter", "environmentFilter",
    "trafficMode", "endpointHost", "range", "contractVersion", "generatedAt",
    "vendors", "daily", "dailyViews", "dailyUniqueViews", "tierViews", "behaviour",
    "events", "dataSource"];
  expect(Object.keys(json).sort()).toEqual(liveTopLevel.sort());
  expect(Object.keys(json.behaviour).sort()).toEqual([
    "version", "measurement", "quality", "funnel", "landingPages", "sources",
    "pathways", "errors", "transitions", "limitations"
  ].sort());
  expect(json.behaviour.measurement).toBe("observed_sessions_not_verified_leads");
  const liveEventFields = ["total", "byName", "byType", "byPage", "byFunnelStep",
    "byNextStep", "byPathway", "byTimeline", "bySourcePath", "byTargetDomain",
    "byOutboundKind", "byScrollDepth", "byEngagedTimeSeconds", "byNavArea",
    "bySourceHost", "bySourceEnvironment", "bySourceHostAndType",
    "bySourceEnvironmentAndType", "byTestTraffic", "byAccessOutcome", "leads",
    "referralAgencies", "errors", "daily", "dailyByName", "sessions", "attribution"];
  for (const field of liveEventFields) expect(json.events).toHaveProperty(field);
  expect(json.events).toHaveProperty("verifiedLeads");
  expect(json.events).toHaveProperty("ctaClicks");
  expect(json.events).toHaveProperty("funnel");
});
