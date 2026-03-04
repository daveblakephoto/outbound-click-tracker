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

test("records city, agency_slug, and page_type in analytics blobs", async () => {
  const analyticsWrites: any[] = [];
  const payload = {
    site: "dave-blake.com",
    vendor: "dave-blake",
    page: "agency-rates",
    tier: "featured",
    city: "brisbane",
    agency_slug: "viviens-brisbane",
    page_type: "agency-rates",
    referrer: "https://dave-blake.com/models/",
    url: "https://dave-blake.com/models/agency-rates/?agency=VIVBNE26"
  };

  const request = new Request("https://example.com/visit", {
    method: "POST",
    headers: {
      Origin: "https://dave-blake.com",
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.12",
      "user-agent": "test-agent"
    },
    body: JSON.stringify(payload)
  });

  const env = {
    CLICKS,
    SITE_ALLOWLIST: "startmyloveengine,dave-blake.com",
    ANALYTICS_ENGINE: {
      writeDataPoint(point) {
        analyticsWrites.push(point);
      }
    }
  } as any;

  const response = await worker.fetch(request, env);

  expect(response.status).toBe(204);
  const viewEvent = analyticsWrites.find(point => point?.blobs?.[0] === "view");
  expect(viewEvent).toBeTruthy();
  expect(viewEvent.blobs[1]).toBe("dave-blake.com");
  expect(viewEvent.blobs[4]).toBe("featured");
  expect(viewEvent.blobs[12]).toBe("brisbane");
  expect(viewEvent.blobs[13]).toBe("viviens-brisbane");
  expect(viewEvent.blobs[14]).toBe("agency-rates");
  expect(viewEvent.blobs[15]).toBe("dave-blake.com");
  expect(viewEvent.blobs[16]).toBe("production");
  expect(viewEvent.blobs[17]).toBe("desktop");
  expect(viewEvent.blobs[18]).toBe("internal");
});

test("records localhost source context and mobile device class", async () => {
  const analyticsWrites: any[] = [];
  const payload = {
    site: "dave-blake.com",
    vendor: "dave-blake",
    page: "agency-rates",
    tier: "featured",
    city: "brisbane",
    agency_slug: "viviens-brisbane",
    page_type: "agency-rates",
    url: "http://localhost:4321/models/agency-rates/?agency=VIVBNE26&utm_medium=email"
  };

  const request = new Request("https://example.com/visit", {
    method: "POST",
    headers: {
      Origin: "http://localhost:4321",
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.15",
      "user-agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15"
    },
    body: JSON.stringify(payload)
  });

  const env = {
    CLICKS,
    SITE_ALLOWLIST: "startmyloveengine,dave-blake.com",
    ANALYTICS_ENGINE: {
      writeDataPoint(point) {
        analyticsWrites.push(point);
      }
    }
  } as any;

  const response = await worker.fetch(request, env);

  expect(response.status).toBe(204);
  const viewEvent = analyticsWrites.find(point => point?.blobs?.[0] === "view");
  expect(viewEvent).toBeTruthy();
  expect(viewEvent.blobs[15]).toBe("localhost");
  expect(viewEvent.blobs[16]).toBe("localhost");
  expect(viewEvent.blobs[17]).toBe("mobile");
  expect(viewEvent.blobs[18]).toBe("email");
});

test("non-metadata sites keep provided plan for unknown vendors", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    site: "dave-blake.com",
    vendor: "unknown-vendor",
    page: "agency-rates",
    tier: "featured",
    plan: "featured",
    referrer: "https://dave-blake.com/models/agency-rates/",
    url: "https://dave-blake.com/models/agency-rates/?agency=VIVBNE26"
  };

  const request = new Request("https://example.com/visit", {
    method: "POST",
    headers: {
      Origin: "https://dave-blake.com",
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.14",
      "user-agent": "test-agent"
    },
    body: JSON.stringify(payload)
  });

  const env = {
    CLICKS,
    SITE_ALLOWLIST: "startmyloveengine,dave-blake.com"
  } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(204);
  expect(await CLICKS.get(`planview:featured:${today}`)).toBe("1");
  expect(await CLICKS.get(`planview:unknown-vendor:featured:${today}`)).toBe(
    "1"
  );
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

test("returns CORS headers for dave-blake.com origin on /visit preflight", async () => {
  const origin = "https://dave-blake.com";
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
