import { expect, test } from "vitest";
import worker from "../src/worker";

const makeEnv = (writes: any[] = []) =>
  ({
    ANALYTICS_ENGINE: {
      writeDataPoint(point: any) {
        writes.push(point);
      }
    }
  }) as any;

test("metadata-enforced site maps tier to unknown plan + placement", async () => {
  const writes: any[] = [];
  const payload = {
    vendor: "unknown-vendor",
    page: "profile",
    tier: "spotlight",
    referrer: "https://startmyloveengine.com/spotlight",
    url: "https://startmyloveengine.com/vendors/unknown-vendor"
  };

  const request = new Request("https://example.com/visit", {
    method: "POST",
    headers: {
      Origin: "https://startmyloveengine.com",
      "Content-Type": "application/json",
      "cf-connecting-ip": "203.0.113.11",
      "user-agent": "test-agent"
    },
    body: JSON.stringify(payload)
  });

  const response = await worker.fetch(request, makeEnv(writes));

  expect(response.status).toBe(204);
  const view = writes.find(point => point?.blobs?.[0] === "view");
  expect(view).toBeTruthy();
  expect(view.blobs[4]).toBe("unknown");
  expect(view.blobs[5]).toBe("spotlight");

  const placementEvents = writes.filter(
    point => point?.blobs?.[0] === "placement_view"
  );
  expect(placementEvents.length).toBeGreaterThanOrEqual(1);
  expect(placementEvents.some(point => point.blobs[7] === "spotlight")).toBe(true);
});

test("returns CORS headers on /visit preflight", async () => {
  const origin = "https://startmyloveengine.com";
  const request = new Request("https://example.com/visit", {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST"
    }
  });

  const response = await worker.fetch(request, {} as any);

  expect(response.status).toBe(204);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
    "POST, OPTIONS"
  );
  expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
    "Content-Type, Authorization"
  );
  expect(response.headers.get("Access-Control-Max-Age")).toBe("86400");
});

test("includes CORS headers on /visit errors", async () => {
  const origin = "https://www.startmyloveengine.com";
  const request = new Request("https://example.com/visit", {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json"
    },
    body: "{"
  });

  const response = await worker.fetch(request, makeEnv([]));

  expect(response.status).toBe(400);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
});
