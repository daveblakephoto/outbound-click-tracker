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

test("rejects invalid vendor slugs", async () => {
  const request = new Request(
    "https://example.com/click?vendor=Bad_Vendor&type=website&to=https://startmyloveengine.com",
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
