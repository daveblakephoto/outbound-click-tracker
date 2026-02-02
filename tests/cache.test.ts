import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { Miniflare } from "miniflare";
import worker from "../src/worker";

let mf: Miniflare;
let CLICKS: any;

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
  vi.stubGlobal("caches", { default: makeCache() });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await mf.dispose();
});

test("stats response caches when enabled", async () => {
  const today = new Date().toISOString().slice(0, 10);
  await CLICKS.put(`dave-blake:website:${today}`, "2");

  const env = {
    CLICKS,
    ANALYTICS_API_TOKEN: "test-secret",
    ANALYTICS_CACHE: "1"
  } as any;

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
});

test("export response caches when enabled", async () => {
  const today = new Date().toISOString().slice(0, 10);
  await CLICKS.put(`view:dave-blake:${today}`, "1");

  const env = {
    CLICKS,
    ANALYTICS_API_TOKEN: "test-secret",
    ANALYTICS_CACHE: "1"
  } as any;

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
});
