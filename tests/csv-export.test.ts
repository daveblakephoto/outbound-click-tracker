import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { Miniflare } from "miniflare";
import {
  FIXED_NOW,
  exportVendorCSV,
  formatDate,
  getStats,
  seedDailyData
} from "./helpers";

let mf: Miniflare;
let CLICKS: any;

const getDateOffset = days => {
  const d = new Date(FIXED_NOW);
  d.setDate(d.getDate() + days);
  return formatDate(d);
};

beforeAll(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);

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
});

afterAll(async () => {
  vi.useRealTimers();
  await mf.dispose();
});

test("csv format integrity for 28d export", async () => {
  const env = {
    CLICKS,
    ANALYTICS_API_TOKEN: "test-secret"
  } as any;

  const { header, rows } = await exportVendorCSV(env, "dave-blake", "28d");

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

test("csv vs api parity for seeded data", async () => {
  const env = {
    CLICKS,
    ANALYTICS_API_TOKEN: "test-secret"
  } as any;

  const day1 = getDateOffset(-27);
  await seedDailyData(CLICKS, [
    [`view:dave-blake:${day1}`, 5],
    [`uview:dave-blake:${day1}`, 3],
    [`dave-blake:website:${day1}`, 2],
    [`dave-blake:instagram:${day1}`, 1]
  ]);

  const { rows } = await exportVendorCSV(env, "dave-blake", "28d");
  const stats = await getStats(env, "28d");
  const vendor = stats.vendors.find(row => row.vendor === "dave-blake");

  const sum = rows.reduce(
    (acc, row) => {
      acc.views += row.views;
      acc.website += row.website_clicks;
      acc.instagram += row.instagram_clicks;
      return acc;
    },
    { views: 0, website: 0, instagram: 0 }
  );

  expect(sum.views).toBe(vendor.views);
  expect(sum.website).toBe(vendor.website);
  expect(sum.instagram).toBe(vendor.instagram);
});

test("ctr calculation is correct per row", async () => {
  const env = {
    CLICKS,
    ANALYTICS_API_TOKEN: "test-secret"
  } as any;

  const day1 = getDateOffset(-27);
  await seedDailyData(CLICKS, [
    [`view:dave-blake:${day1}`, 4],
    [`dave-blake:website:${day1}`, 1],
    [`dave-blake:instagram:${day1}`, 1]
  ]);

  const { rows } = await exportVendorCSV(env, "dave-blake", "28d");
  for (const row of rows) {
    const clicks = row.website_clicks + row.instagram_clicks;
    const expected =
      row.views > 0 ? (clicks / row.views).toFixed(4) : "0.0000";
    expect(row.ctr).toBe(expected);
  }
});

test("missing clicks yield ctr 0.0000", async () => {
  const env = {
    CLICKS,
    ANALYTICS_API_TOKEN: "test-secret"
  } as any;

  const day1 = getDateOffset(-27);
  await seedDailyData(CLICKS, [
    [`view:dave-blake:${day1}`, 5],
    [`uview:dave-blake:${day1}`, 5]
  ]);

  const { rows } = await exportVendorCSV(env, "dave-blake", "28d");
  const row = rows.find(entry => entry.date === day1);

  expect(row.website_clicks).toBe(0);
  expect(row.instagram_clicks).toBe(0);
  expect(row.ctr).toBe("0.0000");
});

test("7d export has no gaps or future dates", async () => {
  const env = {
    CLICKS,
    ANALYTICS_API_TOKEN: "test-secret"
  } as any;

  const { rows } = await exportVendorCSV(env, "dave-blake", "7d");
  expect(rows).toHaveLength(7);

  const today = formatDate();
  let previous = "";
  for (const row of rows) {
    expect(row.date <= today).toBe(true);
    if (previous) {
      const prev = new Date(previous);
      prev.setDate(prev.getDate() + 1);
      expect(row.date).toBe(formatDate(prev));
    }
    previous = row.date;
  }
});
