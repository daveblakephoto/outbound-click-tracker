import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { Miniflare } from "miniflare";
import worker from "../src/worker";

let mf: Miniflare;
let CLICKS: any;

const hmacHex = async (secret: string, payload: string) => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload)
  );
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
};

beforeAll(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-02-02T10:00:00.000Z"));

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
  vi.useRealTimers();
  await mf.dispose();
});

test("rate limits /visit after threshold", async () => {
  const env = {
    CLICKS,
    RATE_LIMIT_PER_MINUTE: 1,
    ANALYTICS_SITE: "startmyloveengine"
  } as any;

  const body = JSON.stringify({
    vendor: "dave-blake",
    page: "profile",
    tier: "featured"
  });

  const makeRequest = () =>
    new Request("https://example.com/visit", {
      method: "POST",
      headers: {
        Origin: "https://startmyloveengine.com",
        "Content-Type": "application/json",
        "cf-connecting-ip": "203.0.113.10",
        "user-agent": "test-agent"
      },
      body
    });

  const first = await worker.fetch(makeRequest(), env);
  expect(first.status).toBe(204);

  const second = await worker.fetch(makeRequest(), env);
  expect(second.status).toBe(429);
});

test("signed click accepted and invalid signature rejected", async () => {
  const secret = "super-secret";
  const env = {
    CLICKS,
    CLICK_SIGNING_SECRET: secret,
    ANALYTICS_SITE: "startmyloveengine"
  } as any;

  const vendor = "dave-blake";
  const type = "website";
  const to = "https://startmyloveengine.com";
  const payload = `${vendor}|${type}|${to}`;
  const sig = await hmacHex(secret, payload);

  const okRequest = new Request(
    `https://example.com/click?vendor=${vendor}&type=${type}&to=${encodeURIComponent(
      to
    )}&sig=${sig}`
  );

  const okResponse = await worker.fetch(okRequest, env);
  expect(okResponse.status).toBe(302);

  const badRequest = new Request(
    `https://example.com/click?vendor=${vendor}&type=${type}&to=${encodeURIComponent(
      to
    )}&sig=bad`
  );

  const badResponse = await worker.fetch(badRequest, env);
  expect(badResponse.status).toBe(401);
});

test("POST click is accepted with server-side signing enabled", async () => {
  const secret = "super-secret";
  const env = {
    CLICKS,
    CLICK_SIGNING_SECRET: secret,
    ANALYTICS_SITE: "startmyloveengine"
  } as any;

  const vendor = "dave-blake";
  const type = "website";
  const url = "https://startmyloveengine.com";

  const okRequest = new Request("https://example.com/click", {
    method: "POST",
    headers: {
      Origin: "https://startmyloveengine.com",
      Referer: "https://startmyloveengine.com/profile",
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.55",
      "user-agent": "test-agent"
    },
    body: JSON.stringify({ vendor, type, url })
  });

  const okResponse = await worker.fetch(okRequest, env);
  expect(okResponse.status).toBe(204);
});

test("POST click rejects missing referrer", async () => {
  const env = {
    CLICKS,
    CLICK_SIGNING_SECRET: "super-secret",
    ANALYTICS_SITE: "startmyloveengine"
  } as any;

  const request = new Request("https://example.com/click", {
    method: "POST",
    headers: {
      Origin: "https://startmyloveengine.com",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      vendor: "dave-blake",
      type: "website",
      url: "https://startmyloveengine.com"
    })
  });

  const response = await worker.fetch(request, env);
  expect(response.status).toBe(403);
});
