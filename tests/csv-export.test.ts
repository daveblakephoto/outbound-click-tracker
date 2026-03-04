import { afterEach, expect, test, vi } from "vitest";
import worker from "../src/worker";

const requestFor = (range = "28d") =>
  new Request(
    `https://example.com/api/export/vendor.csv?vendor=dave-blake&range=${range}&site=StartMyLoveEngine`,
    {
      headers: { Authorization: "Bearer test-secret" }
    }
  );

const makeEnv = () =>
  ({
    ANALYTICS_API_TOKEN: "test-secret",
    ANALYTICS_ENGINE_ACCOUNT_ID: "acct",
    ANALYTICS_ENGINE_API_TOKEN: "token",
    ANALYTICS_ENGINE_DATASET: "analytics_events"
  }) as any;

const parseCsv = (csv: string) => {
  const lines = csv.trim().split("\n");
  const header = lines.shift()?.split(",") || [];
  const rows = lines.map(line => {
    const [date, views, uniqueViews, website, instagram, ctr] = line.split(",");
    return {
      date,
      views: Number(views),
      unique_views: Number(uniqueViews),
      website_clicks: Number(website),
      instagram_clicks: Number(instagram),
      ctr
    };
  });
  return { header, rows };
};

afterEach(() => {
  vi.restoreAllMocks();
});

test("csv format integrity for 28d export", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ data: [] })
  } as any);

  const response = await worker.fetch(requestFor("28d"), makeEnv());
  fetchSpy.mockRestore();

  expect(response.status).toBe(200);
  const { header, rows } = parseCsv(await response.text());

  expect(header.join(",")).toBe(
    "date,views,unique_views,website_clicks,instagram_clicks,ctr"
  );

  let previous = "";
  for (const row of rows) {
    expect(row.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    if (previous) {
      expect(row.date >= previous).toBe(true);
    }
    previous = row.date;
  }
});

test("ctr calculation is correct per row", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
    async (_url, init) => {
      const sql = String(init?.body || "");
      if (sql.includes("blob1 = 'view'")) {
        return {
          ok: true,
          json: async () => ({ data: [{ date: today, count: 4 }] })
        } as any;
      }
      if (sql.includes("blob1 = 'click'")) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { date: today, click_type: "website", count: 1 },
              { date: today, click_type: "instagram", count: 1 }
            ]
          })
        } as any;
      }
      return {
        ok: true,
        json: async () => ({ data: [] })
      } as any;
    }
  );

  const response = await worker.fetch(requestFor("28d"), makeEnv());
  fetchSpy.mockRestore();

  expect(response.status).toBe(200);
  const { rows } = parseCsv(await response.text());
  const row = rows.find(entry => entry.date === today);
  expect(row).toBeTruthy();
  const clicks = row.website_clicks + row.instagram_clicks;
  const expected = row.views > 0 ? (clicks / row.views).toFixed(4) : "0.0000";
  expect(row.ctr).toBe(expected);
});

test("7d export has no gaps or future dates", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ data: [] })
  } as any);

  const response = await worker.fetch(requestFor("7d"), makeEnv());
  fetchSpy.mockRestore();

  expect(response.status).toBe(200);
  const { rows } = parseCsv(await response.text());
  expect(rows).toHaveLength(7);

  const today = new Date().toISOString().slice(0, 10);
  let previous = "";
  for (const row of rows) {
    expect(row.date <= today).toBe(true);
    if (previous) {
      const prev = new Date(`${previous}T00:00:00.000Z`);
      prev.setUTCDate(prev.getUTCDate() + 1);
      expect(row.date).toBe(prev.toISOString().slice(0, 10));
    }
    previous = row.date;
  }
});

test("rejects range larger than 90d", async () => {
  const response = await worker.fetch(requestFor("180d"), makeEnv());
  expect(response.status).toBe(400);
  expect(await response.text()).toMatch(/Max range is 90 days/);
});

test("returns 503 when analytics engine export is unconfigured", async () => {
  const response = await worker.fetch(requestFor("7d"), {
    ANALYTICS_API_TOKEN: "test-secret"
  } as any);

  expect(response.status).toBe(503);
  expect(response.headers.get("X-Data-Warning")).toBe("ae_unconfigured");
});

test("returns 503 when analytics engine export fails", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: false,
    status: 422,
    text: async () => "sql parser error"
  } as any);

  const response = await worker.fetch(requestFor("7d"), makeEnv());
  fetchSpy.mockRestore();

  expect(response.status).toBe(503);
  expect(response.headers.get("X-Data-Source")).toBe("ae");
  expect(response.headers.get("X-Data-Warning")).toBe("ae_failed");
});
