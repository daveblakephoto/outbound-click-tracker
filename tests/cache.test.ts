import { afterEach, beforeEach, expect, test, vi } from "vitest";
import worker from "../src/worker";

const makeCache = () => {
  const store = new Map<string, Response>();
  const keyFor = (request: Request | string) => {
    if (typeof request === "string") return `GET:${request}`;
    return `${request.method}:${request.url}`;
  };
  return {
    match: async (request: Request | string) => {
      const key = keyFor(request);
      const cached = store.get(key);
      return cached ? cached.clone() : undefined;
    },
    put: async (request: Request | string, response: Response) => {
      const key = keyFor(request);
      store.set(key, response.clone());
    }
  };
};

beforeEach(() => {
  vi.stubGlobal("caches", { default: makeCache() });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const env = {
  ANALYTICS_API_TOKEN: "test-secret",
  ANALYTICS_ENGINE_ACCOUNT_ID: "acct",
  ANALYTICS_ENGINE_API_TOKEN: "token",
  ANALYTICS_ENGINE_DATASET: "analytics_events",
  ANALYTICS_CACHE: "1"
} as any;

test("stats response caches when enabled", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ data: [] })
  } as any);

  const request = new Request(
    "https://example.com/api/stats?site=StartMyLoveEngine&range=7d",
    {
      headers: { Authorization: "Bearer test-secret" }
    }
  );

  const first = await worker.fetch(request, env);
  expect(first.status).toBe(200);
  expect(first.headers.get("X-Cache")).toBe("MISS");

  const second = await worker.fetch(request, env);
  expect(second.status).toBe(200);
  expect(second.headers.get("X-Cache")).toBe("HIT");
  expect(fetchSpy).toHaveBeenCalledTimes(7);
});

test("export response caches when enabled", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ data: [] })
  } as any);

  const request = new Request(
    "https://example.com/api/export/vendor.csv?vendor=dave-blake&range=7d&site=StartMyLoveEngine",
    {
      headers: { Authorization: "Bearer test-secret" }
    }
  );

  const first = await worker.fetch(request, env);
  expect(first.status).toBe(200);
  expect(first.headers.get("X-Cache")).toBe("MISS");

  const second = await worker.fetch(request, env);
  expect(second.status).toBe(200);
  expect(second.headers.get("X-Cache")).toBe("HIT");
  expect(fetchSpy).toHaveBeenCalledTimes(3);
});

test("cache keys are scoped by auth token", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ data: [] })
  } as any);

  const envA = {
    ...env,
    ANALYTICS_API_TOKEN: "token-a"
  } as any;

  const envB = {
    ...env,
    ANALYTICS_API_TOKEN: "token-b"
  } as any;

  const requestA = new Request(
    "https://example.com/api/stats?site=StartMyLoveEngine&range=7d",
    {
      headers: { Authorization: "Bearer token-a" }
    }
  );

  const requestB = new Request(
    "https://example.com/api/stats?site=StartMyLoveEngine&range=7d",
    {
      headers: { Authorization: "Bearer token-b" }
    }
  );

  const first = await worker.fetch(requestA, envA);
  expect(first.status).toBe(200);
  expect(first.headers.get("X-Cache")).toBe("MISS");

  const second = await worker.fetch(requestB, envB);
  expect(second.status).toBe(200);
  expect(second.headers.get("X-Cache")).toBe("MISS");

  const third = await worker.fetch(requestB, envB);
  expect(third.status).toBe(200);
  expect(third.headers.get("X-Cache")).toBe("HIT");

  expect(fetchSpy).toHaveBeenCalledTimes(14);
});
