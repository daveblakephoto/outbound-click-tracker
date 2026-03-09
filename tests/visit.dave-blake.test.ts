import { expect, test } from "vitest";
import worker from "../src/worker";

const makeEnv = (writes: any[] = []) =>
  ({
    SITE_ALLOWLIST: "startmyloveengine,dave-blake.com",
    ANALYTICS_ENGINE: {
      writeDataPoint(point: any) {
        writes.push(point);
      }
    }
  }) as any;

test("records city, agency_slug, and page_type in analytics blobs", async () => {
  const analyticsWrites: any[] = [];
  const payload = {
    site: "dave-blake.com",
    vendor: "dave-blake",
    page: "agency-rates",
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

  const response = await worker.fetch(request, makeEnv(analyticsWrites));

  expect(response.status).toBe(204);
  const viewEvent = analyticsWrites.find(point => point?.blobs?.[0] === "view");
  expect(viewEvent).toBeTruthy();
  expect(viewEvent.blobs[1]).toBe("dave-blake.com");
  expect(viewEvent.blobs[4]).toBe("unknown");
  expect(viewEvent.blobs[5]).toBe("");
  expect(viewEvent.blobs[12]).toBe("brisbane");
  expect(viewEvent.blobs[13]).toBe("viviens-brisbane");
  expect(viewEvent.blobs[14]).toBe("agency-rates");
  expect(viewEvent.blobs[15]).toBe("dave-blake.com");
  expect(viewEvent.blobs[16]).toBe("production");
  expect(viewEvent.blobs[17]).toBe("desktop");
  expect(viewEvent.blobs[18]).toBe("internal");
  const viewContext = JSON.parse(viewEvent.blobs[19]);
  expect(viewContext.sourcePath).toBe("/models/agency-rates/");
  expect(viewContext.sourceQuery).toBe("agency=VIVBNE26");
  expect(viewContext.referrerDomain).toBe("dave-blake.com");
  expect(viewContext.platform).toBe("unknown");
});

test("records localhost source context and mobile device class", async () => {
  const analyticsWrites: any[] = [];
  const payload = {
    site: "dave-blake.com",
    vendor: "dave-blake",
    page: "agency-rates",
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

  const response = await worker.fetch(request, makeEnv(analyticsWrites));

  expect(response.status).toBe(204);
  const viewEvent = analyticsWrites.find(point => point?.blobs?.[0] === "view");
  expect(viewEvent).toBeTruthy();
  expect(viewEvent.blobs[15]).toBe("localhost");
  expect(viewEvent.blobs[16]).toBe("local");
  expect(viewEvent.blobs[17]).toBe("mobile");
  expect(viewEvent.blobs[18]).toBe("direct");
  const viewContext = JSON.parse(viewEvent.blobs[19]);
  expect(viewContext.sourcePath).toBe("/models/agency-rates/");
  expect(viewContext.sourceQuery).toBe("agency=VIVBNE26&utm_medium=email");
  expect(viewContext.platform).toBe("ios");
});

test("classifies loopback IP source host as local", async () => {
  const analyticsWrites: any[] = [];
  const payload = {
    site: "dave-blake.com",
    vendor: "dave-blake",
    page: "agency-rates",
    page_type: "agency-rates",
    url: "http://127.0.0.1:4321/models/agency-rates/?agency=VIVBNE26"
  };

  const request = new Request("https://example.com/visit", {
    method: "POST",
    headers: {
      Origin: "http://127.0.0.1:4321",
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.21",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)"
    },
    body: JSON.stringify(payload)
  });

  const response = await worker.fetch(request, makeEnv(analyticsWrites));

  expect(response.status).toBe(204);
  const viewEvent = analyticsWrites.find(point => point?.blobs?.[0] === "view");
  expect(viewEvent).toBeTruthy();
  expect(viewEvent.blobs[15]).toBe("127.0.0.1");
  expect(viewEvent.blobs[16]).toBe("local");
});

test("payload referrer empty does not fall back to request Referer header", async () => {
  const analyticsWrites: any[] = [];
  const payload = {
    site: "dave-blake.com",
    vendor: "vivbne26",
    page: "agency-rates",
    city: "brisbane",
    agency_slug: "viviens-brisbane",
    page_type: "agency-rates",
    url: "https://staging.dave-blake.com/models/agency-rates/?agency=VIVBNE26",
    referrer: "",
    custom_context: {
      agency_code: "VIVBNE26",
      campaign: "email-march",
      rank: 1
    }
  };

  const request = new Request("https://example.com/visit", {
    method: "POST",
    headers: {
      Origin: "https://staging.dave-blake.com",
      Referer: "https://staging.dave-blake.com/",
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.20",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)"
    },
    body: JSON.stringify(payload)
  });

  const response = await worker.fetch(request, makeEnv(analyticsWrites));
  expect(response.status).toBe(204);

  const viewEvent = analyticsWrites.find(point => point?.blobs?.[0] === "view");
  expect(viewEvent).toBeTruthy();
  expect(viewEvent.blobs[18]).toBe("direct");
  const viewContext = JSON.parse(viewEvent.blobs[19]);
  expect(viewContext.platform).toBe("macos");
  expect(viewContext.referrerDomain).toBe("");
  expect(viewContext.custom.agency_code).toBe("VIVBNE26");
  expect(viewContext.custom.campaign).toBe("email-march");
  expect(viewContext.custom.rank).toBe("1");

  const refEvent = analyticsWrites.find(
    point => point?.blobs?.[0] === "referrer"
  );
  expect(refEvent).toBeUndefined();
});

test("falls back to single Analytics Engine index when dual-index write fails", async () => {
  const writes: any[] = [];
  const payload = {
    site: "dave-blake.com",
    vendor: "vivbne26",
    page: "agency-rates",
    city: "brisbane",
    agency_slug: "viviens-brisbane",
    page_type: "agency-rates",
    url: "https://dave-blake.com/models/agency-rates/?agency=VIVBNE26",
    referrer: "https://dave-blake.com/models/"
  };

  const request = new Request("https://example.com/visit", {
    method: "POST",
    headers: {
      Origin: "https://dave-blake.com",
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.16",
      "user-agent": "test-agent"
    },
    body: JSON.stringify(payload)
  });

  const env = {
    SITE_ALLOWLIST: "startmyloveengine,dave-blake.com",
    ANALYTICS_ENGINE: {
      writeDataPoint(point: any) {
        if (Array.isArray(point.indexes) && point.indexes.length !== 1) {
          throw new Error("AE index mismatch: expected single index");
        }
        writes.push(point);
      }
    }
  } as any;

  const response = await worker.fetch(request, env);
  expect(response.status).toBe(204);
  expect(writes.length).toBeGreaterThan(0);
  for (const point of writes) {
    expect(point.indexes.length).toBe(1);
  }
});

test("non-metadata sites default to unknown plan without tier", async () => {
  const analyticsWrites: any[] = [];
  const payload = {
    site: "dave-blake.com",
    vendor: "unknown-vendor",
    page: "agency-rates",
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

  const response = await worker.fetch(request, makeEnv(analyticsWrites));

  expect(response.status).toBe(204);
  const viewEvent = analyticsWrites.find(point => point?.blobs?.[0] === "view");
  expect(viewEvent.blobs[4]).toBe("unknown");
  expect(viewEvent.blobs[5]).toBe("");
});

test("unique view is de-duplicated for same IP + user agent + vendor", async () => {
  const writes: any[] = [];
  const payload = {
    site: "dave-blake.com",
    vendor: "vivbne26",
    page: "agency-rates",
    url: "https://dave-blake.com/models/agency-rates/?agency=VIVBNE26"
  };

  const makeRequest = () =>
    new Request("https://example.com/visit", {
      method: "POST",
      headers: {
        Origin: "https://dave-blake.com",
        "Content-Type": "application/json",
        "cf-connecting-ip": "203.0.113.19",
        "user-agent": "Mozilla/5.0"
      },
      body: JSON.stringify(payload)
    });

  const env = makeEnv(writes);
  const first = await worker.fetch(makeRequest(), env);
  const second = await worker.fetch(makeRequest(), env);

  expect(first.status).toBe(204);
  expect(second.status).toBe(204);
  expect(writes.filter(point => point?.blobs?.[0] === "unique_view")).toHaveLength(1);
  expect(writes.filter(point => point?.blobs?.[0] === "view")).toHaveLength(2);
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

  const response = await worker.fetch(request, {} as any);

  expect(response.status).toBe(204);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
});

test("returns 503 when Analytics Engine binding is missing on /visit", async () => {
  const request = new Request("https://example.com/visit", {
    method: "POST",
    headers: {
      Origin: "https://dave-blake.com",
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.12",
      "user-agent": "test-agent"
    },
    body: JSON.stringify({
      site: "dave-blake.com",
      vendor: "dave-blake",
      page: "agency-rates",
      url: "https://dave-blake.com/models/agency-rates/?agency=VIVBNE26"
    })
  });

  const response = await worker.fetch(request, {
    SITE_ALLOWLIST: "startmyloveengine,dave-blake.com"
  } as any);

  expect(response.status).toBe(503);
});
