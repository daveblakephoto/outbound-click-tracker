import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { Miniflare } from "miniflare";
import worker from "../src/worker";

async function getNum(kv: any, key: string) {
  const value = await kv.get(key);
  return value ? parseInt(value, 10) : 0;
}

describe("scheduled rollup (daily -> monthly)", () => {
  let mf: Miniflare;
  let CLICKS: any;
  let ARCHIVE: any;
  let SNAPSHOTS: any;
  const cronNow = "2026-02-15T12:00:00.000Z";

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok'); } }",
      kvNamespaces: ["CLICKS", "CLICKS_ARCHIVE"],
      r2Buckets: ["CLICKS_SNAPSHOTS"]
    });
    CLICKS = await mf.getKVNamespace("CLICKS");
    ARCHIVE = await mf.getKVNamespace("CLICKS_ARCHIVE");
    SNAPSHOTS = await mf.getR2Bucket("CLICKS_SNAPSHOTS");
  });

  beforeEach(async () => {
    const kvs = [CLICKS, ARCHIVE];
    for (const kv of kvs) {
      const list = await kv.list();
      await Promise.all(list.keys.map(key => kv.delete(key.name)));
    }

    const objects = await SNAPSHOTS.list();
    await Promise.all(objects.objects.map(obj => SNAPSHOTS.delete(obj.key)));
  });

  afterAll(async () => {
    await mf.dispose();
  });

  test("rolls up keys older than 28 days and deletes the original daily keys", async () => {
    const oldDate = "2025-11-30";
    const newDate = "2025-12-10";

    const oldKey = `vendor-a:website:${oldDate}`;
    const newKey = `vendor-a:website:${newDate}`;

    await CLICKS.put(oldKey, "7");
    await CLICKS.put(newKey, "3");

    const env = { CLICKS, CRON_NOW: cronNow } as any;

    await worker.scheduled({} as any, env);

    const month = oldDate.slice(0, 7);
    const rollupKey = `rollup:vendor-a:website:${month}`;

    expect(await getNum(CLICKS, rollupKey)).toBe(7);
    expect(await CLICKS.get(oldKey)).toBeNull();

    expect(await getNum(CLICKS, newKey)).toBe(3);
  });

  test("accumulates multiple old daily keys into the same monthly rollup", async () => {
    const d1 = "2025-11-01";
    const d2 = "2025-11-15";
    const month = "2025-11";

    await CLICKS.put(`vendor-b:instagram:${d1}`, "2");
    await CLICKS.put(`vendor-b:instagram:${d2}`, "5");

    const env = { CLICKS, CRON_NOW: cronNow } as any;

    await worker.scheduled({} as any, env);

    const rollupKey = `rollup:vendor-b:instagram:${month}`;
    expect(await getNum(CLICKS, rollupKey)).toBe(7);

    expect(await CLICKS.get(`vendor-b:instagram:${d1}`)).toBeNull();
    expect(await CLICKS.get(`vendor-b:instagram:${d2}`)).toBeNull();
  });

  test("keeps current and previous two months intact including the cutoff boundary", async () => {
    const boundaryDate = "2025-12-01";
    const key = `vendor-c:website:${boundaryDate}`;

    await CLICKS.put(key, "9");

    const env = { CLICKS, CRON_NOW: cronNow } as any;

    await worker.scheduled({} as any, env);

    expect(await getNum(CLICKS, key)).toBe(9);

    const month = boundaryDate.slice(0, 7);
    const rollupKey = `rollup:vendor-c:website:${month}`;
    expect(await CLICKS.get(rollupKey)).toBeNull();
  });

  test("does not double-count if the cron runs twice", async () => {
    const oldDate = "2025-11-20";
    const month = "2025-11";
    const dailyKey = `vendor-d:website:${oldDate}`;
    const rollupKey = `rollup:vendor-d:website:${month}`;

    await CLICKS.put(dailyKey, "4");

    const env = { CLICKS, CRON_NOW: cronNow } as any;

    await worker.scheduled({} as any, env);
    await worker.scheduled({} as any, env);

    expect(await getNum(CLICKS, rollupKey)).toBe(4);
    expect(await CLICKS.get(dailyKey)).toBeNull();
  });

  test("ignores non-daily keys and malformed keys", async () => {
    await CLICKS.put("weirdkey", "10");
    await CLICKS.put("rollup:vendor-x:website:2025-12", "99");
    await CLICKS.put("vendor:eek:too:many:parts", "123");

    const env = { CLICKS, CRON_NOW: cronNow } as any;

    await worker.scheduled({} as any, env);

    expect(await getNum(CLICKS, "weirdkey")).toBe(10);
    expect(await getNum(CLICKS, "rollup:vendor-x:website:2025-12")).toBe(99);
    expect(await getNum(CLICKS, "vendor:eek:too:many:parts")).toBe(123);
  });

  test("handles multiple vendors + types correctly", async () => {
    await CLICKS.put("a:website:2025-10-01", "1");
    await CLICKS.put("a:instagram:2025-10-01", "2");
    await CLICKS.put("b:website:2025-10-15", "3");

    const env = { CLICKS, CRON_NOW: cronNow } as any;

    await worker.scheduled({} as any, env);

    expect(await getNum(CLICKS, "rollup:a:website:2025-10")).toBe(1);
    expect(await getNum(CLICKS, "rollup:a:instagram:2025-10")).toBe(2);
    expect(await getNum(CLICKS, "rollup:b:website:2025-10")).toBe(3);

    expect(await CLICKS.get("a:website:2025-10-01")).toBeNull();
    expect(await CLICKS.get("a:instagram:2025-10-01")).toBeNull();
    expect(await CLICKS.get("b:website:2025-10-15")).toBeNull();
  });

  test("rolls up tier view counters", async () => {
    const oldDate = "2025-11-05";
    const month = "2025-11";

    await CLICKS.put(`tview:featured:${oldDate}`, "6");
    await CLICKS.put(`tview:vendor-z:featured:${oldDate}`, "3");

    const env = { CLICKS, CRON_NOW: cronNow } as any;

    await worker.scheduled({} as any, env);

    expect(await getNum(CLICKS, `rollup:tview:featured:${month}`)).toBe(6);
    expect(await getNum(CLICKS, `rollup:tview:vendor-z:featured:${month}`)).toBe(3);
    expect(await CLICKS.get(`tview:featured:${oldDate}`)).toBeNull();
    expect(await CLICKS.get(`tview:vendor-z:featured:${oldDate}`)).toBeNull();
  });

  test("archives daily keys before deletion when archive KV is present", async () => {
    await CLICKS.put("vendor-g:website:2025-10-03", "8");

    const env = { CLICKS, CLICKS_ARCHIVE: ARCHIVE, CRON_NOW: cronNow } as any;

    await worker.scheduled({} as any, env);

    expect(await ARCHIVE.get("vendor-g:website:2025-10-03")).toBe("8");
    expect(await CLICKS.get("vendor-g:website:2025-10-03")).toBeNull();
  });

  test("writes monthly CSV snapshots to R2 when enabled", async () => {
    await CLICKS.put("vendor-h:website:2025-10-04", "5");
    await CLICKS.put("vendor-h:instagram:2025-10-05", "2");

    const env = {
      CLICKS,
      CLICKS_ARCHIVE: ARCHIVE,
      CLICKS_SNAPSHOTS: SNAPSHOTS,
      CRON_NOW: cronNow
    } as any;

    await worker.scheduled({} as any, env);

    const listed = await SNAPSHOTS.list({ prefix: "smle/snapshots/2025-10/" });
    expect(listed.objects.length).toBe(1);

    const object = await SNAPSHOTS.get(listed.objects[0].key);
    expect(listed.objects[0].key.startsWith("smle/snapshots/2025-10/")).toBe(
      true
    );
    const csv = await object.text();
    expect(csv).toContain("vendor,type,date,count");
    expect(csv).toContain("vendor-h,website,2025-10-04,5");
    expect(csv).toContain("vendor-h,instagram,2025-10-05,2");
  });

  test("skips rollup when a lock is present", async () => {
    await CLICKS.put("vendor-e:website:2025-10-01", "6");
    await CLICKS.put("rollup:lock", "locked");

    const env = { CLICKS, CRON_NOW: cronNow } as any;

    await worker.scheduled({} as any, env);

    expect(await getNum(CLICKS, "vendor-e:website:2025-10-01")).toBe(6);
    expect(await getNum(CLICKS, "rollup:vendor-e:website:2025-10")).toBe(0);
  });

  test("releases the lock after a successful run", async () => {
    await CLICKS.put("vendor-f:website:2025-10-02", "1");

    const env = { CLICKS, CRON_NOW: cronNow } as any;

    await worker.scheduled({} as any, env);

    expect(await CLICKS.get("rollup:lock")).toBeNull();
  });
});
