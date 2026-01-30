import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { Miniflare } from "miniflare";
import worker from "../src/worker";
import {
  FIXED_NOW,
  formatDate,
  getStats,
  postVisit,
  runCron,
  seedDailyData,
  triggerClick
} from "./helpers";

let mf: Miniflare;
let CLICKS: any;
let SNAPSHOTS: any;

beforeAll(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);

  mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    kvNamespaces: ["CLICKS"],
    r2Buckets: ["CLICKS_SNAPSHOTS"]
  });

  CLICKS = await mf.getKVNamespace("CLICKS");
  SNAPSHOTS = await mf.getR2Bucket("CLICKS_SNAPSHOTS");
});

beforeEach(async () => {
  const list = await CLICKS.list();
  await Promise.all(list.keys.map(key => CLICKS.delete(key.name)));

  const objects = await SNAPSHOTS.list();
  await Promise.all(objects.objects.map(obj => SNAPSHOTS.delete(obj.key)));
});

afterAll(async () => {
  vi.useRealTimers();
  await mf.dispose();
});

test("visit counting increments views and de-duplicates unique views", async () => {
  const env = { CLICKS } as any;
  const date = formatDate();

  await postVisit(env, "vendor-a");
  await postVisit(env, "vendor-a");

  expect(await CLICKS.get(`view:vendor-a:${date}`)).toBe("2");
  expect(await CLICKS.get(`uview:vendor-a:${date}`)).toBe("1");
});

test("clicks correlate with visits in stats", async () => {
  const env = {
    CLICKS,
    ANALYTICS_API_TOKEN: "test-secret"
  } as any;

  await postVisit(env, "vendor-b");
  await triggerClick(env, "vendor-b");

  const stats = await getStats(env, "7d");
  const vendor = stats.vendors.find(row => row.vendor === "vendor-b");

  expect(vendor.views).toBe(1);
  expect(vendor.website + vendor.instagram).toBeGreaterThanOrEqual(1);
});

test("range outputs stay consistent for 7d", async () => {
  const env = {
    CLICKS,
    ANALYTICS_API_TOKEN: "test-secret"
  } as any;

  const stats = await getStats(env, "7d");
  expect(stats.daily).toHaveLength(7);
  expect(stats.dailyViews).toHaveLength(7);
  expect(stats.dailyUniqueViews).toHaveLength(7);
});

test("rollup preserves daily totals", async () => {
  const env = { CLICKS } as any;
  const d1 = "2025-11-10";
  const d2 = "2025-11-11";
  const month = "2025-11";
  const sum = 5;

  await seedDailyData(CLICKS, [
    [`vendor-roll:website:${d1}`, 2],
    [`vendor-roll:website:${d2}`, 3]
  ]);

  await runCron(env);

  expect(await CLICKS.get(`rollup:vendor-roll:website:${month}`)).toBe(
    String(sum)
  );
});

test("raw snapshot CSV parity with stats views", async () => {
  const env = {
    CLICKS,
    CLICKS_SNAPSHOTS: SNAPSHOTS,
    ANALYTICS_API_TOKEN: "test-secret",
    CRON_DRY_RUN: "1"
  } as any;

  await seedDailyData(CLICKS, [
    ["view:vendor-csv:2025-11-29", 2],
    ["view:vendor-csv:2025-11-30", 3]
  ]);

  await runCron(env);

  const listed = await SNAPSHOTS.list({
    prefix: "smle/snapshots-raw/2025-11/"
  });
  expect(listed.objects.length).toBeGreaterThan(0);

  const object = await SNAPSHOTS.get(listed.objects[0].key);
  const csv = await object.text();
  const lines = csv.trim().split("\n").slice(1);
  const sum = lines.reduce((acc, line) => {
    const [key, value] = line.split(",");
    if (key.startsWith("view:vendor-csv:")) {
      return acc + parseInt(value, 10);
    }
    return acc;
  }, 0);

  const stats = await getStats(env, "90d");
  const vendor = stats.vendors.find(row => row.vendor === "vendor-csv");
  expect(vendor.views).toBe(sum);
});
