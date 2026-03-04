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
