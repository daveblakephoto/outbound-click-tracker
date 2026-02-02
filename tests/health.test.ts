import { expect, test } from "vitest";
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
  expect(json.status).toBe("unconfigured");
});
