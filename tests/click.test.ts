import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { Miniflare } from "miniflare";
import worker from "../src/worker";

let mf: Miniflare;
let CLICKS: any;

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

test("POST click increments counts", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const env = { CLICKS, CLICK_SIGNING_SECRET: "secret" } as any;

  const response = await worker.fetch(makePostRequest(), env);

  expect(response.status).toBe(204);
  expect(await CLICKS.get(`test-vendor:website:${today}`)).toBe("1");
});

test("POST click includes CORS headers", async () => {
  const origin = "https://startmyloveengine.com";
  const env = { CLICKS, CLICK_SIGNING_SECRET: "secret" } as any;

  const response = await worker.fetch(
    makePostRequest({}, { Origin: origin }),
    env
  );

  expect(response.status).toBe(204);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
});

test("POST click rejects missing parameters", async () => {
  const env = { CLICKS, CLICK_SIGNING_SECRET: "secret" } as any;
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
  const env = { CLICKS, CLICK_SIGNING_SECRET: "secret" } as any;

  const response = await worker.fetch(
    makePostRequest({ vendor: "Bad_Vendor" }),
    env
  );

  expect(response.status).toBe(400);
});

test("POST click rejects invalid click types", async () => {
  const env = { CLICKS, CLICK_SIGNING_SECRET: "secret" } as any;

  const response = await worker.fetch(
    makePostRequest({ type: "twitter" }),
    env
  );

  expect(response.status).toBe(400);
});

test("POST click rejects invalid origin", async () => {
  const env = { CLICKS, CLICK_SIGNING_SECRET: "secret" } as any;

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
  const env = { CLICKS, CLICK_SIGNING_SECRET: "secret" } as any;

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

  const env = { CLICKS } as any;
  const response = await worker.fetch(request, env);
  const json = await response.json();

  expect(response.status).toBe(410);
  expect(json.error).toMatch(/Legacy click tracking disabled/i);
});

test("rejects non-POST/OPTIONS requests", async () => {
  const request = new Request("https://example.com/click", {
    method: "PUT"
  });

  const env = { CLICKS } as any;
  const response = await worker.fetch(request, env);

  expect(response.status).toBe(405);
});
