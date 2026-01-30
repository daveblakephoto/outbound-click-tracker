import worker from "../src/worker";

export const FIXED_NOW = new Date("2026-02-15T12:00:00.000Z");

export const formatDate = (date = FIXED_NOW) =>
  date.toISOString().slice(0, 10);

export const postVisit = async (
  env,
  vendor,
  {
    tier = "featured",
    page = "profile",
    origin = "https://startmyloveengine.com",
    referrer = "https://startmyloveengine.com/spotlight",
    url = `https://startmyloveengine.com/vendors/${vendor}`,
    ip = "203.0.113.10",
    userAgent = "test-agent"
  } = {}
) => {
  const request = new Request("https://example.com/visit", {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "cf-connecting-ip": ip,
      "user-agent": userAgent
    },
    body: JSON.stringify({
      vendor,
      page,
      tier,
      referrer,
      url
    })
  });

  return worker.fetch(request, env);
};

export const triggerClick = async (
  env,
  vendor,
  { type = "website", to = "https://startmyloveengine.com" } = {}
) => {
  const request = new Request(
    `https://example.com/click?vendor=${vendor}&type=${type}&to=${encodeURIComponent(
      to
    )}`,
    { method: "GET" }
  );

  return worker.fetch(request, env);
};

export const getStats = async (env, range = "7d") => {
  const request = new Request(
    `https://example.com/api/stats?site=StartMyLoveEngine&range=${range}`,
    {
      headers: { Authorization: `Bearer ${env.ANALYTICS_API_TOKEN}` }
    }
  );

  const response = await worker.fetch(request, env);
  return response.json();
};

export const seedDailyData = async (kv, entries) => {
  await Promise.all(
    entries.map(([key, value]) => kv.put(key, String(value)))
  );
};

export const runCron = async (env, cronNow = FIXED_NOW.toISOString()) => {
  const cronEnv = { ...env, CRON_NOW: cronNow };
  await worker.scheduled({} as any, cronEnv);
};

export const exportVendorCSV = async (env, vendor, range = "28d") => {
  const request = new Request(
    `https://example.com/api/export/vendor.csv?vendor=${vendor}&range=${range}`,
    {
      headers: { Authorization: `Bearer ${env.ANALYTICS_API_TOKEN}` }
    }
  );

  const response = await worker.fetch(request, env);
  const csv = await response.text();

  const lines = csv.trim().split("\n");
  const header = lines.shift()?.split(",") || [];
  const rows = lines.map(line => {
    const [date, views, uniqueViews, website, instagram, ctr] =
      line.split(",");
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
