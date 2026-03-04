import { expect, test } from "vitest";
import worker from "../src/worker";

test("/schema exposes contract fields", async () => {
  const req = new Request("https://example.com/schema", {
    headers: { Origin: "https://startmyloveengine.com" }
  });
  const res = await worker.fetch(req, {} as any);
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toContain("application/json");
  const json = await res.json();
  expect(json.apiVersion).toBe("1.0.0");
  expect(json.allowedPages).toContain("profile");
  expect(json.resolved.vendorSlugRegex).toBe("^[a-z0-9-]+$");
  expect(json.responses.stats.dataSource).toContain("cache");
  expect(json.responses.stats.dataSource).not.toContain("kv");
  expect(json.responses.stats.dataWarning).toBe("string");
  expect(json.responses.health.status).toContain("ok");
  expect(json.diagnostics.healthEndpoint).toBe("/api/health/analytics-engine");
});

test("legacy tier payload maps to plan and placement for analytics writes", async () => {
  const writes: any[] = [];
  const req = new Request("https://example.com/visit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.21",
      "user-agent": "test-agent"
    },
    body: JSON.stringify({
      vendor: "unknown-vendor",
      page: "profile",
      tier: "spotlight"
    })
  });

  const res = await worker.fetch(req, {
    ANALYTICS_ENGINE: {
      writeDataPoint(point: any) {
        writes.push(point);
      }
    }
  } as any);

  expect(res.status).toBe(204);
  const view = writes.find(point => point?.blobs?.[0] === "view");
  expect(view).toBeTruthy();
  expect(view.blobs[4]).toBe("unknown");
  expect(view.blobs[5]).toBe("spotlight");
  const placement = writes.find(point => point?.blobs?.[0] === "placement_view");
  expect(placement?.blobs?.[7]).toBe("spotlight");
});

test("rejects invalid plan", async () => {
  const req = new Request("https://example.com/visit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.22",
      "user-agent": "test-agent"
    },
    body: JSON.stringify({
      vendor: "vendor-basic",
      page: "profile",
      plan: "pro"
    })
  });

  const res = await worker.fetch(req, {
    ANALYTICS_ENGINE: { writeDataPoint() {} }
  } as any);
  expect(res.status).toBe(400);
});

test("rejects invalid placements", async () => {
  const req = new Request("https://example.com/visit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.23",
      "user-agent": "test-agent"
    },
    body: JSON.stringify({
      vendor: "vendor-basic",
      page: "profile",
      plan: "basic",
      placements: ["bad-slot"]
    })
  });

  const res = await worker.fetch(req, {
    ANALYTICS_ENGINE: { writeDataPoint() {} }
  } as any);
  expect(res.status).toBe(400);
});

test("/openapi returns yaml content", async () => {
  const req = new Request("https://example.com/openapi", {
    headers: { Origin: "https://startmyloveengine.com" }
  });
  const res = await worker.fetch(req, {} as any);
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toContain("text/yaml");
  const text = await res.text();
  expect(text).toContain("/visit:");
  expect(text).toContain("StartMyLoveEngine Analytics API");
  expect(text).toContain("/api/health/analytics-engine");
  expect(text).not.toContain("enum: [ae, kv, cache]");
});
