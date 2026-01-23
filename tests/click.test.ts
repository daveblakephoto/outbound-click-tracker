import { afterEach, beforeEach, expect, test } from "vitest";
import { Miniflare } from "miniflare";
import worker from "../src/worker";

let mf: Miniflare;

beforeEach(async () => {
  mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    kvNamespaces: ["CLICKS"]
  });

  globalThis.CLICKS = await mf.getKVNamespace("CLICKS");
});

afterEach(async () => {
  await mf.dispose();
});

test("increments click counts", async () => {
  const request = new Request(
    "https://example.com/click?vendor=test-vendor&type=website&to=https://startmyloveengine.com",
    { method: "GET" }
  );

  const env = { CLICKS: globalThis.CLICKS } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(302); // redirect is success
});

test("rejects non-GET requests", async () => {
  const request = new Request(
    "https://example.com/click?vendor=test-vendor&type=website&to=https://startmyloveengine.com",
    { method: "POST" }
  );

  const env = { CLICKS: globalThis.CLICKS } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(405);
});

test("rejects missing parameters", async () => {
  const request = new Request("https://example.com/click?vendor=test-vendor", {
    method: "GET"
  });

  const env = { CLICKS: globalThis.CLICKS } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(400);
});

test("rejects invalid vendor slugs", async () => {
  const request = new Request(
    "https://example.com/click?vendor=Bad_Vendor&type=website&to=https://startmyloveengine.com",
    { method: "GET" }
  );

  const env = { CLICKS: globalThis.CLICKS } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(400);
});

test("rejects invalid click types", async () => {
  const request = new Request(
    "https://example.com/click?vendor=test-vendor&type=twitter&to=https://startmyloveengine.com",
    { method: "GET" }
  );

  const env = { CLICKS: globalThis.CLICKS } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(400);
});

test("rejects invalid destination URLs", async () => {
  const request = new Request(
    "https://example.com/click?vendor=test-vendor&type=website&to=not-a-url",
    { method: "GET" }
  );

  const env = { CLICKS: globalThis.CLICKS } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(400);
});

test("rejects non-https destinations", async () => {
  const request = new Request(
    "https://example.com/click?vendor=test-vendor&type=website&to=http://startmyloveengine.com",
    { method: "GET" }
  );

  const env = { CLICKS: globalThis.CLICKS } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(400);
});

test("blocks disallowed destination domains", async () => {
  const request = new Request(
    "https://example.com/click?vendor=test-vendor&type=website&to=https://evil.example",
    { method: "GET" }
  );

  const env = { CLICKS: globalThis.CLICKS } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(403);
});

test("rejects allow-list bypass with trailing dot", async () => {
  const request = new Request(
    "https://example.com/click?vendor=test-vendor&type=website&to=https://startmyloveengine.com.",
    { method: "GET" }
  );

  const env = { CLICKS: globalThis.CLICKS } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(403);
});

test("rejects allow-list bypass with suffix trick", async () => {
  const request = new Request(
    "https://example.com/click?vendor=test-vendor&type=website&to=https://instagram.com.evil",
    { method: "GET" }
  );

  const env = { CLICKS: globalThis.CLICKS } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(403);
});

test("rejects destination URLs with credentials", async () => {
  const request = new Request(
    "https://example.com/click?vendor=test-vendor&type=website&to=https://user:pass@startmyloveengine.com",
    { method: "GET" }
  );

  const env = { CLICKS: globalThis.CLICKS } as any;
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

  const env = { CLICKS: globalThis.CLICKS } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(400);
});
