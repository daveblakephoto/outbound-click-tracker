import { expect, test } from "vitest";
import worker from "../src/worker";

test("blocks stats without secret", async () => {
  const request = new Request(
    "https://example.com/api/stats?site=StartMyLoveEngine&range=7d"
  );

  const env = {
    ANALYTICS_API_TOKEN: "test-secret"
  } as any;

  const response = await worker.fetch(request, env);
  expect(response.status).toBe(401);
});

test("blocks export without secret", async () => {
  const request = new Request(
    "https://example.com/api/export/vendor.csv?site=StartMyLoveEngine&vendor=test-vendor&range=7d"
  );

  const env = {
    ANALYTICS_API_TOKEN: "test-secret"
  } as any;

  const response = await worker.fetch(request, env);
  expect(response.status).toBe(401);
});

test("allows stats without secret when ALLOW_UNAUTH_STATS=1", async () => {
  const request = new Request(
    "https://example.com/api/stats?site=StartMyLoveEngine&range=7d"
  );

  const env = {
    ALLOW_UNAUTH_STATS: "1",
    ANALYTICS_ENGINE_ACCOUNT_ID: "acct",
    ANALYTICS_ENGINE_API_TOKEN: "token",
    ANALYTICS_ENGINE_DATASET: "analytics_events"
  } as any;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({
      ok: true,
      json: async () => ({ data: [] })
    } as any)) as any;
  try {
    const response = await worker.fetch(request, env);
    expect(response.status).toBe(200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("allows export without secret when ALLOW_UNAUTH_STATS=1", async () => {
  const request = new Request(
    "https://example.com/api/export/vendor.csv?site=StartMyLoveEngine&vendor=test-vendor&range=7d"
  );

  const env = {
    ALLOW_UNAUTH_STATS: "1",
    ANALYTICS_ENGINE_ACCOUNT_ID: "acct",
    ANALYTICS_ENGINE_API_TOKEN: "token",
    ANALYTICS_ENGINE_DATASET: "analytics_events"
  } as any;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({
      ok: true,
      json: async () => ({ data: [] })
    } as any)) as any;
  try {
    const response = await worker.fetch(request, env);
    expect(response.status).toBe(200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
