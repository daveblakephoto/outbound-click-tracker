import { expect, test, vi } from "vitest";
import worker from "../src/worker";

test("analytics engine health returns unconfigured when missing env", async () => {
  const request = new Request(
    "https://example.com/api/health/analytics-engine",
    {
      headers: { Authorization: "Bearer test-secret" }
    }
  );

  const env = {
    ANALYTICS_API_TOKEN: "test-secret"
  } as any;

  const response = await worker.fetch(request, env);
  expect(response.status).toBe(503);

  const json = await response.json();
  expect(json.status).toBe("degraded");
  expect(json.lastError).toBe("unconfigured");
  expect(json.checkedAt).toBeTruthy();
});

test("analytics engine health returns ok when query succeeds", async () => {
  const request = new Request(
    "https://example.com/api/health/analytics-engine",
    {
      headers: { Authorization: "Bearer test-secret" }
    }
  );

  const env = {
    ANALYTICS_API_TOKEN: "test-secret",
    ANALYTICS_ENGINE_ACCOUNT_ID: "acct",
    ANALYTICS_ENGINE_API_TOKEN: "token",
    ANALYTICS_ENGINE_DATASET: "analytics_events"
  } as any;

  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] })
    } as any);

  const response = await worker.fetch(request, env);
  fetchSpy.mockRestore();

  expect(response.status).toBe(200);
  const json = await response.json();
  expect(json.status).toBe("ok");
  expect(typeof json.latencyMs).toBe("number");
});

test("analytics engine health returns degraded on query failure", async () => {
  const request = new Request(
    "https://example.com/api/health/analytics-engine",
    {
      headers: { Authorization: "Bearer test-secret" }
    }
  );

  const env = {
    ANALYTICS_API_TOKEN: "test-secret",
    ANALYTICS_ENGINE_ACCOUNT_ID: "acct",
    ANALYTICS_ENGINE_API_TOKEN: "token",
    ANALYTICS_ENGINE_DATASET: "analytics_events"
  } as any;

  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "boom"
    } as any);

  const response = await worker.fetch(request, env);
  fetchSpy.mockRestore();

  expect(response.status).toBe(503);
  const json = await response.json();
  expect(json.status).toBe("degraded");
  expect(json.lastError).toMatch(/boom/);
});
