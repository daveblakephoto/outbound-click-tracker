import { afterAll, beforeAll, expect, test, vi } from "vitest";
import worker from "../src/worker";

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-02-02T10:00:00.000Z"));
});

afterAll(() => {
  vi.useRealTimers();
});

test("rate limits /visit after threshold", async () => {
  const env = {
    RATE_LIMIT_PER_MINUTE: 1,
    ANALYTICS_SITE: "startmyloveengine",
    ANALYTICS_ENGINE: { writeDataPoint() {} }
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

test("POST click is accepted with server-side signing enabled", async () => {
  const secret = "super-secret";
  const env = {
    CLICK_SIGNING_SECRET: secret,
    ANALYTICS_SITE: "startmyloveengine",
    ANALYTICS_ENGINE: { writeDataPoint() {} }
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
    CLICK_SIGNING_SECRET: "super-secret",
    ANALYTICS_SITE: "startmyloveengine",
    ANALYTICS_ENGINE: { writeDataPoint() {} }
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
