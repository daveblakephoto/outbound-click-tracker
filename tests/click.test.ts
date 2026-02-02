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

test("increments click counts", async () => {
  const request = new Request(
    "https://example.com/click?vendor=test-vendor&type=website&to=https://startmyloveengine.com",
    { method: "GET" }
  );

  const env = { CLICKS } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(302); // redirect is success
});

test("accepts POST click payloads", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const request = new Request("https://example.com/click", {
    method: "POST",
    headers: {
      Origin: "https://startmyloveengine.com",
      Referer: "https://startmyloveengine.com/spotlight",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      vendor: "test-vendor",
      type: "website",
      url: "https://startmyloveengine.com/vendors/test-vendor"
    })
  });

  const env = { CLICKS, CLICK_SIGNING_SECRET: "secret" } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(204);
  expect(await CLICKS.get(`test-vendor:website:${today}`)).toBe("1");
});

test("includes CORS headers on POST click", async () => {
  const origin = "https://startmyloveengine.com";
  const request = new Request("https://example.com/click", {
    method: "POST",
    headers: {
      Origin: origin,
      Referer: "https://startmyloveengine.com/profile",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      vendor: "test-vendor",
      type: "website",
      url: "https://startmyloveengine.com/vendors/test-vendor"
    })
  });

  const env = { CLICKS, CLICK_SIGNING_SECRET: "secret" } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(204);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
});

test("rejects POST click with invalid origin", async () => {
  const request = new Request("https://example.com/click", {
    method: "POST",
    headers: {
      Origin: "https://evil.example",
      Referer: "https://evil.example/page",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      vendor: "test-vendor",
      type: "website",
      url: "https://startmyloveengine.com/vendors/test-vendor"
    })
  });

  const env = { CLICKS, CLICK_SIGNING_SECRET: "secret" } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(403);
});

test("rejects non-GET/POST requests", async () => {
  const request = new Request(
    "https://example.com/click?vendor=test-vendor&type=website&to=https://startmyloveengine.com",
    { method: "PUT" }
  );

  const env = { CLICKS } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(405);
});

test("rejects missing parameters", async () => {
  const request = new Request("https://example.com/click?vendor=test-vendor", {
    method: "GET"
  });

  const env = { CLICKS } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(400);
});

test("rejects invalid vendor slugs", async () => {
  const request = new Request(
    "https://example.com/click?vendor=Bad_Vendor&type=website&to=https://startmyloveengine.com",
    { method: "GET" }
  );

  const env = { CLICKS } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(400);
});

test("rejects invalid click types", async () => {
  const request = new Request(
    "https://example.com/click?vendor=test-vendor&type=twitter&to=https://startmyloveengine.com",
    { method: "GET" }
  );

  const env = { CLICKS } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(400);
});

test("rejects invalid destination URLs", async () => {
  const request = new Request(
    "https://example.com/click?vendor=test-vendor&type=website&to=not-a-url",
    { method: "GET" }
  );

  const env = { CLICKS } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(400);
});

test("rejects non-https destinations", async () => {
  const request = new Request(
    "https://example.com/click?vendor=test-vendor&type=website&to=http://startmyloveengine.com",
    { method: "GET" }
  );

  const env = { CLICKS } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(400);
});

test("blocks disallowed destination domains", async () => {
  const request = new Request(
    "https://example.com/click?vendor=test-vendor&type=website&to=https://evil.example",
    { method: "GET" }
  );

  const env = { CLICKS } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(403);
});

test("rejects allow-list bypass with trailing dot", async () => {
  const request = new Request(
    "https://example.com/click?vendor=test-vendor&type=website&to=https://startmyloveengine.com.",
    { method: "GET" }
  );

  const env = { CLICKS } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(403);
});

test("rejects allow-list bypass with suffix trick", async () => {
  const request = new Request(
    "https://example.com/click?vendor=test-vendor&type=website&to=https://instagram.com.evil",
    { method: "GET" }
  );

  const env = { CLICKS } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(403);
});

test("rejects destination URLs with credentials", async () => {
  const request = new Request(
    "https://example.com/click?vendor=test-vendor&type=website&to=https://user:pass@startmyloveengine.com",
    { method: "GET" }
  );

  const env = { CLICKS } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(400);
});

test("rejects overly long parameters", async () => {
  const vendor = "a".repeat(65);
  const destination = `https://startmyloveengine.com/${"b".repeat(2049)}`;
  const request = new Request(
    `https://example.com/click?vendor=${vendor}&type=website&to=${encodeURIComponent(destination)}`,
    { method: "GET" }
  );

  const env = { CLICKS } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(400);
});

test("allows kacper-goodtimes.com destinations", async () => {
  const request = new Request(
    "https://example.com/click?vendor=test-vendor&type=website&to=https://www.kacper-goodtimes.com/",
    { method: "GET" }
  );

  const env = { CLICKS } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(302);
});
