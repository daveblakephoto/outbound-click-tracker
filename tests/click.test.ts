import { expect, test } from "vitest";
import worker from "../src/worker";

const makePostRequest = (
  bodyOverrides: Record<string, unknown> = {},
  headerOverrides: Record<string, string> = {}
) =>
  new Request("https://example.com/click", {
    method: "POST",
    headers: {
      Origin: "https://startmyloveengine.com",
      Referer: "https://startmyloveengine.com/profile",
      "Content-Type": "application/json",
      ...headerOverrides
    },
    body: JSON.stringify({
      vendor: "test-vendor",
      type: "website",
      url: "https://startmyloveengine.com/vendors/test-vendor",
      ...bodyOverrides
    })
  });

test("POST click writes Analytics Engine event", async () => {
  const writes: any[] = [];
  const env = {
    CLICK_SIGNING_SECRET: "secret",
    ANALYTICS_ENGINE: {
      writeDataPoint(point: any) {
        writes.push(point);
      }
    }
  } as any;

  const response = await worker.fetch(makePostRequest(), env);

  expect(response.status).toBe(204);
  expect(writes.length).toBe(1);
  expect(writes[0].blobs[0]).toBe("click");
  expect(writes[0].blobs[2]).toBe("test-vendor");
  expect(writes[0].blobs[6]).toBe("website");
});

test("POST click fails when Analytics Engine binding is missing", async () => {
  const env = { CLICK_SIGNING_SECRET: "secret" } as any;

  const response = await worker.fetch(makePostRequest(), env);
  expect(response.status).toBe(503);
});

test("POST click includes CORS headers", async () => {
  const origin = "https://startmyloveengine.com";
  const env = {
    CLICK_SIGNING_SECRET: "secret",
    ANALYTICS_ENGINE: { writeDataPoint() {} }
  } as any;

  const response = await worker.fetch(
    makePostRequest({}, { Origin: origin }),
    env
  );

  expect(response.status).toBe(204);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
});

test("POST click accepts preview subdomain origin", async () => {
  const origin = "https://preview.dave-blake.com";
  const env = {
    CLICK_SIGNING_SECRET: "secret",
    ANALYTICS_ENGINE: { writeDataPoint() {} }
  } as any;

  const response = await worker.fetch(
    makePostRequest({}, { Origin: origin, Referer: `${origin}/portfolio/motion/` }),
    env
  );

  expect(response.status).toBe(204);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
});

test("POST click accepts main subdomain origin", async () => {
  const origin = "https://main.dave-blake.com";
  const env = {
    CLICK_SIGNING_SECRET: "secret",
    ANALYTICS_ENGINE: { writeDataPoint() {} }
  } as any;

  const response = await worker.fetch(
    makePostRequest({}, { Origin: origin, Referer: `${origin}/portfolio/motion/` }),
    env
  );

  expect(response.status).toBe(204);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
});

test("POST click rejects missing parameters", async () => {
  const env = {
    CLICK_SIGNING_SECRET: "secret",
    ANALYTICS_ENGINE: { writeDataPoint() {} }
  } as any;
  const request = new Request("https://example.com/click", {
    method: "POST",
    headers: {
      Origin: "https://startmyloveengine.com",
      Referer: "https://startmyloveengine.com/profile",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ type: "website" })
  });

  const response = await worker.fetch(request, env);
  expect(response.status).toBe(400);
});

test("POST click rejects invalid vendor slugs", async () => {
  const env = {
    CLICK_SIGNING_SECRET: "secret",
    ANALYTICS_ENGINE: { writeDataPoint() {} }
  } as any;

  const response = await worker.fetch(
    makePostRequest({ vendor: "Bad_Vendor" }),
    env
  );

  expect(response.status).toBe(400);
});

test("POST click rejects invalid click types", async () => {
  const env = {
    CLICK_SIGNING_SECRET: "secret",
    ANALYTICS_ENGINE: { writeDataPoint() {} }
  } as any;

  const response = await worker.fetch(
    makePostRequest({ type: "twitter" }),
    env
  );

  expect(response.status).toBe(400);
});

test("POST click rejects invalid origin", async () => {
  const env = {
    CLICK_SIGNING_SECRET: "secret",
    ANALYTICS_ENGINE: { writeDataPoint() {} }
  } as any;

  const response = await worker.fetch(
    makePostRequest(
      {},
      {
        Origin: "https://evil.example",
        Referer: "https://evil.example/page"
      }
    ),
    env
  );

  expect(response.status).toBe(403);
});

test("POST click rejects missing referrer", async () => {
  const env = {
    CLICK_SIGNING_SECRET: "secret",
    ANALYTICS_ENGINE: { writeDataPoint() {} }
  } as any;

  const request = new Request("https://example.com/click", {
    method: "POST",
    headers: {
      Origin: "https://startmyloveengine.com",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      vendor: "test-vendor",
      type: "website",
      url: "https://startmyloveengine.com/vendors/test-vendor"
    })
  });

  const response = await worker.fetch(request, env);
  expect(response.status).toBe(403);
});

test("GET click is disabled", async () => {
  const request = new Request(
    "https://example.com/click?vendor=test-vendor&type=website&to=https://startmyloveengine.com",
    { method: "GET" }
  );

  const response = await worker.fetch(request, {} as any);
  const json = await response.json();

  expect(response.status).toBe(410);
  expect(json.error).toMatch(/Legacy click tracking disabled/i);
});

test("rejects non-POST/OPTIONS requests", async () => {
  const request = new Request("https://example.com/click", {
    method: "PUT"
  });

  const response = await worker.fetch(request, {} as any);

  expect(response.status).toBe(405);
});
