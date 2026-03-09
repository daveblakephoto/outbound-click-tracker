import { expect, test } from "vitest";
import worker from "../src/worker";

const makeEnv = (writes: any[] = [], overrides: Record<string, unknown> = {}) =>
  ({
    SITE_ALLOWLIST: "startmyloveengine,dave-blake.com",
    ANALYTICS_ENGINE: {
      writeDataPoint(point: any) {
        writes.push(point);
      }
    },
    ...overrides
  }) as any;

test("records generic event payload in analytics blobs", async () => {
  const writes: any[] = [];
  const request = new Request("https://example.com/event", {
    method: "POST",
    headers: {
      Origin: "https://dave-blake.com",
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.44",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)"
    },
    body: JSON.stringify({
      event_schema_version: "event_v1",
      site: "dave-blake.com",
      vendor: "dave-blake",
      event_name: "db_contact_form_submit_success",
      event_type: "submit",
      page: "models-contact",
      session_id: "mfs_abc123456",
      custom_context: {
        source_path: "models-contact",
        funnel_step: "submit_success",
        redirected: true
      },
      referrer: "https://dave-blake.com/models/rates/",
      url: "https://dave-blake.com/models/contact/?submitted=1"
    })
  });

  const response = await worker.fetch(request, makeEnv(writes));
  expect(response.status).toBe(204);

  const eventWrite = writes.find(point => point?.blobs?.[0] === "event");
  expect(eventWrite).toBeTruthy();
  expect(eventWrite.blobs[1]).toBe("dave-blake.com");
  expect(eventWrite.blobs[2]).toBe("dave-blake");
  expect(eventWrite.blobs[3]).toBe("models-contact");
  expect(eventWrite.blobs[6]).toBe("submit");
  expect(eventWrite.blobs[7]).toBe("db_contact_form_submit_success");
  expect(eventWrite.blobs[15]).toBe("dave-blake.com");
  expect(eventWrite.blobs[16]).toBe("production");
  expect(eventWrite.blobs[17]).toBe("desktop");
  expect(eventWrite.blobs[18]).toBe("internal");

  const context = JSON.parse(eventWrite.blobs[19]);
  expect(context.sourcePath).toBe("/models/contact/");
  expect(context.custom.event_name).toBe("db_contact_form_submit_success");
  expect(context.custom.event_type).toBe("submit");
  expect(context.custom.session_id).toBe("mfs_abc123456");
});

test("uses top-level source_env and is_test_traffic when custom_context omits them", async () => {
  const writes: any[] = [];
  const request = new Request("https://example.com/event", {
    method: "POST",
    headers: {
      Origin: "https://dave-blake.com",
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.45",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)"
    },
    body: JSON.stringify({
      event_schema_version: "event_v1",
      site: "dave-blake.com",
      vendor: "dave-blake",
      event_name: "db_models_page_view",
      event_type: "view",
      page: "models-index",
      session_id: "mfs_top_level_env_123",
      source_env: "staging",
      is_test_traffic: true,
      custom_context: {
        funnel_step: "models_page_view"
      },
      referrer: "https://dave-blake.com/",
      url: "https://dave-blake.com/models/"
    })
  });

  const response = await worker.fetch(request, makeEnv(writes));
  expect(response.status).toBe(204);

  const eventWrite = writes.find(point => point?.blobs?.[0] === "event");
  expect(eventWrite).toBeTruthy();
  expect(eventWrite.blobs[16]).toBe("staging");
  const context = JSON.parse(eventWrite.blobs[19]);
  expect(context.custom.source_env).toBe("staging");
  expect(context.custom.is_test_traffic).toBe("true");
});

test("optional analytics events can be disabled without blocking critical events", async () => {
  const writes: any[] = [];
  const env = makeEnv(writes, {
    ANALYTICS_OPTIONAL_EVENTS_ENABLED: "0"
  });

  const optionalRequest = new Request("https://example.com/event", {
    method: "POST",
    headers: {
      Origin: "https://dave-blake.com",
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.49",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)"
    },
    body: JSON.stringify({
      site: "dave-blake.com",
      vendor: "dave-blake",
      event_name: "db_scroll_depth",
      event_type: "custom",
      page: "home",
      session_id: "mfs_optional_disabled_1",
      custom_context: {
        scroll_depth_pct: 50
      }
    })
  });

  const optionalResponse = await worker.fetch(optionalRequest, env);
  expect(optionalResponse.status).toBe(202);
  expect(optionalResponse.headers.get("X-Event-Skipped")).toBe("optional-disabled");
  expect(writes.filter(point => point?.blobs?.[0] === "event").length).toBe(0);

  const criticalRequest = new Request("https://example.com/event", {
    method: "POST",
    headers: {
      Origin: "https://dave-blake.com",
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.49",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)"
    },
    body: JSON.stringify({
      site: "dave-blake.com",
      vendor: "dave-blake",
      event_name: "db_contact_form_submit_success",
      event_type: "submit",
      page: "models-contact",
      session_id: "mfs_optional_disabled_2"
    })
  });

  const criticalResponse = await worker.fetch(criticalRequest, env);
  expect(criticalResponse.status).toBe(204);
  expect(writes.filter(point => point?.blobs?.[0] === "event").length).toBe(1);
});

test("optional analytics events support deterministic sampling", async () => {
  const writes: any[] = [];
  const env = makeEnv(writes, {
    ANALYTICS_OPTIONAL_EVENTS_ENABLED: "1",
    ANALYTICS_OPTIONAL_EVENT_SAMPLE_RATE: "0"
  });
  const request = new Request("https://example.com/event", {
    method: "POST",
    headers: {
      Origin: "https://dave-blake.com",
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.50",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)"
    },
    body: JSON.stringify({
      site: "dave-blake.com",
      vendor: "dave-blake",
      event_name: "db_engaged_time",
      event_type: "custom",
      page: "home",
      session_id: "mfs_optional_sample_0",
      custom_context: {
        engaged_time_seconds: 30
      }
    })
  });
  const response = await worker.fetch(request, env);
  expect(response.status).toBe(202);
  expect(response.headers.get("X-Event-Skipped")).toBe("optional-sampled");
  expect(writes.filter(point => point?.blobs?.[0] === "event").length).toBe(0);
});

test("keeps engagement keys in custom context even when context is dense", async () => {
  const writes: any[] = [];
  const denseContext: Record<string, string | number> = {};
  for (let i = 0; i < 40; i += 1) {
    denseContext[`k_${i}`] = `v_${i}`;
  }
  denseContext.scroll_depth_pct = 75;
  denseContext.engaged_time_seconds = 30;
  denseContext.funnel_step = "scroll_depth";
  denseContext.nav_area = "header";

  const request = new Request("https://example.com/event", {
    method: "POST",
    headers: {
      Origin: "https://dave-blake.com",
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.52",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)"
    },
    body: JSON.stringify({
      site: "dave-blake.com",
      vendor: "dave-blake",
      event_name: "db_scroll_depth",
      event_type: "custom",
      page: "home",
      session_id: "mfs_dense_context_1",
      custom_context: denseContext
    })
  });

  const response = await worker.fetch(request, makeEnv(writes));
  expect(response.status).toBe(204);
  const eventWrite = writes.find(point => point?.blobs?.[0] === "event");
  expect(eventWrite).toBeTruthy();
  const context = JSON.parse(eventWrite.blobs[19]);
  expect(context.custom.scroll_depth_pct).toBe("75");
  expect(context.custom.engaged_time_seconds).toBe("30");
  expect(context.custom.funnel_step).toBe("scroll_depth");
  expect(context.custom.nav_area).toBe("header");
});

test("dedupes repeated event_id within dedupe window", async () => {
  const writes: any[] = [];
  const payload = {
    event_schema_version: "event_v1",
    site: "dave-blake.com",
    vendor: "dave-blake",
    event_name: "db_cta_click",
    event_type: "click",
    page: "models-index",
    session_id: "mfs_dedupe_123456",
    event_id: "evt_dedupe_abc123",
    custom_context: {
      funnel_step: "models_page_cta_click",
      cta_id: "hero_rates"
    },
    url: "https://dave-blake.com/models/"
  };

  const req1 = new Request("https://example.com/event", {
    method: "POST",
    headers: {
      Origin: "https://dave-blake.com",
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.51",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)"
    },
    body: JSON.stringify(payload)
  });
  const req2 = new Request("https://example.com/event", {
    method: "POST",
    headers: {
      Origin: "https://dave-blake.com",
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.51",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)"
    },
    body: JSON.stringify(payload)
  });

  const first = await worker.fetch(req1, makeEnv(writes));
  const second = await worker.fetch(req2, makeEnv(writes));

  expect(first.status).toBe(204);
  expect(second.status).toBe(202);
  expect(second.headers.get("X-Event-Deduped")).toBe("1");
  expect(writes.filter(point => point?.blobs?.[0] === "event").length).toBe(1);
});

test("returns CORS headers on /event preflight", async () => {
  const origin = "https://dave-blake.com";
  const request = new Request("https://example.com/event", {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST"
    }
  });

  const response = await worker.fetch(request, {} as any);
  expect(response.status).toBe(204);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
    "POST, OPTIONS"
  );
});

test("rejects invalid event type", async () => {
  const request = new Request("https://example.com/event", {
    method: "POST",
    headers: {
      Origin: "https://dave-blake.com",
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.45",
      "user-agent": "test-agent"
    },
    body: JSON.stringify({
      site: "dave-blake.com",
      event_name: "db_models_page_view",
      event_type: "purchase",
      page: "models-index",
      session_id: "mfs_invalid_type_123"
    })
  });

  const response = await worker.fetch(request, makeEnv([]));
  expect(response.status).toBe(400);
  expect(await response.text()).toBe("Invalid event_type");
});

test("enforces optional event allowlists from env", async () => {
  const writes: any[] = [];
  const env = makeEnv(writes, {
    EVENT_PAGE_ALLOWLIST: "models-contact",
    EVENT_NAME_ALLOWLIST: "db_contact_form_submit_success"
  });

  const okRequest = new Request("https://example.com/event", {
    method: "POST",
    headers: {
      Origin: "https://dave-blake.com",
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.46",
      "user-agent": "test-agent"
    },
    body: JSON.stringify({
      site: "dave-blake.com",
      event_name: "db_contact_form_submit_success",
      event_type: "submit",
      page: "models-contact",
      session_id: "mfs_allow_123456"
    })
  });

  const badRequest = new Request("https://example.com/event", {
    method: "POST",
    headers: {
      Origin: "https://dave-blake.com",
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.47",
      "user-agent": "test-agent"
    },
    body: JSON.stringify({
      site: "dave-blake.com",
      event_name: "db_models_page_view",
      event_type: "view",
      page: "models-index",
      session_id: "mfs_allow_789012"
    })
  });

  const okResponse = await worker.fetch(okRequest, env);
  expect(okResponse.status).toBe(204);

  const badResponse = await worker.fetch(badRequest, env);
  expect(badResponse.status).toBe(400);
  expect(await badResponse.text()).toBe("Invalid page");
});
