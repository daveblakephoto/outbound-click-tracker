// Optional hardening features:
// - CLICK_SIGNING_SECRET enables HMAC-signed click URLs
// - RATE_LIMIT_PER_MINUTE enables per-IP rate limiting
// Both are disabled unless explicitly configured
import contractJson from "../contracts/analytics.contract.json" assert { type: "json" };
import { OPENAPI_YAML } from "../contracts/openapi-text";
import vendorMetadataRaw from "../config/vendor-metadata.json" assert { type: "json" };

// plan = billing tier (single value); placements = promotional surfaces (multi-value)

const CONTRACT = contractJson as {
  apiVersion: string;
  allowedPages: string[];
  allowedPlans: string[];
  allowedPlacements: string[];
  allowedClickTypes: string[];
  internalDomains: string[];
  vendorSlugRegex: string;
  defaultRanges: string[];
  cors: {
    visitAllowedOrigins: string[];
    exportAllowedOrigins: string[];
  };
};
const CONTRACT_VERSION = CONTRACT.apiVersion || "1.0.0";

const ANALYTICS_SITE_FALLBACK = "startmyloveengine";
const ANALYTICS_EVENT_TYPES = {
  CLICK: "click",
  VIEW: "view",
  UNIQUE_VIEW: "unique_view",
  PLACEMENT_VIEW: "placement_view",
  REFERRER: "referrer"
} as const;

type AnalyticsEventType =
  typeof ANALYTICS_EVENT_TYPES[keyof typeof ANALYTICS_EVENT_TYPES];

type AnalyticsEngineDataset = {
  writeDataPoint: (point: {
    indexes: string[];
    blobs?: string[];
    doubles?: number[];
  }) => void;
};

type AnalyticsEventFields = {
  eventType: AnalyticsEventType;
  site: string;
  vendor: string;
  page?: string;
  plan?: string;
  legacyTier?: string;
  clickType?: string;
  placement?: string;
  refScope?: "int" | "ext";
  refBucket?: string;
  date: string;
};

const ANALYTICS_BLOBS = {
  EVENT_TYPE: 0,
  SITE: 1,
  VENDOR: 2,
  PAGE: 3,
  PLAN: 4,
  LEGACY_TIER: 5,
  CLICK_TYPE: 6,
  PLACEMENT: 7,
  REF_SCOPE: 8,
  REF_BUCKET: 9,
  DATE: 10
} as const;

const ANALYTICS_BLOB_COUNT = 11;

const buildAnalyticsBlobs = (fields: AnalyticsEventFields) => {
  const blobs = new Array(ANALYTICS_BLOB_COUNT).fill("");
  blobs[ANALYTICS_BLOBS.EVENT_TYPE] = fields.eventType;
  blobs[ANALYTICS_BLOBS.SITE] = fields.site;
  blobs[ANALYTICS_BLOBS.VENDOR] = fields.vendor;
  blobs[ANALYTICS_BLOBS.PAGE] = fields.page || "";
  blobs[ANALYTICS_BLOBS.PLAN] = fields.plan || "";
  blobs[ANALYTICS_BLOBS.LEGACY_TIER] = fields.legacyTier || "";
  blobs[ANALYTICS_BLOBS.CLICK_TYPE] = fields.clickType || "";
  blobs[ANALYTICS_BLOBS.PLACEMENT] = fields.placement || "";
  blobs[ANALYTICS_BLOBS.REF_SCOPE] = fields.refScope || "";
  blobs[ANALYTICS_BLOBS.REF_BUCKET] = fields.refBucket || "";
  blobs[ANALYTICS_BLOBS.DATE] = fields.date;
  return blobs;
};

const writeAnalyticsEvent = (
  env: any,
  fields: AnalyticsEventFields
) => {
  const dataset = env.ANALYTICS_ENGINE as AnalyticsEngineDataset | undefined;
  if (!dataset) return;
  try {
    dataset.writeDataPoint({
      indexes: [fields.vendor || "unknown"],
      blobs: buildAnalyticsBlobs(fields),
      doubles: [1]
    });
  } catch (error) {
    if (env.DEBUG_STATS === "1") {
      console.warn("analytics:write-failed", error);
    }
  }
};

const parseSiteSlug = (value: unknown) => {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "";
  if (!/^[a-z0-9-]+$/.test(normalized)) return "";
  return normalized;
};

let siteConfigCache: {
  rawMap: string;
  rawAllowlist: string;
  rawFallback: string;
  config: {
    map: Record<string, string>;
    allowlist: Set<string>;
    fallbackSite: string;
  };
} | null = null;

const getSiteConfig = (env: any) => {
  const rawMap =
    typeof env.SITE_MAP_JSON === "string" ? env.SITE_MAP_JSON.trim() : "";
  const rawAllowlist =
    typeof env.SITE_ALLOWLIST === "string" ? env.SITE_ALLOWLIST.trim() : "";
  const rawFallback =
    typeof env.ANALYTICS_SITE === "string" ? env.ANALYTICS_SITE.trim() : "";

  if (
    siteConfigCache &&
    siteConfigCache.rawMap === rawMap &&
    siteConfigCache.rawAllowlist === rawAllowlist &&
    siteConfigCache.rawFallback === rawFallback
  ) {
    return siteConfigCache.config;
  }

  const map: Record<string, string> = {};
  const allowlist = new Set<string>();
  const fallbackSite =
    parseSiteSlug(rawFallback) || ANALYTICS_SITE_FALLBACK;

  if (rawAllowlist) {
    rawAllowlist
      .split(",")
      .map(item => parseSiteSlug(item))
      .filter(Boolean)
      .forEach(item => allowlist.add(item));
  }

  if (rawMap) {
    try {
      const parsed = JSON.parse(rawMap);
      if (parsed && typeof parsed === "object") {
        for (const [host, site] of Object.entries(parsed)) {
          const normalizedHost = normalizeHostname(String(host || ""));
          const normalizedSite = parseSiteSlug(site);
          if (!normalizedHost || !normalizedSite) continue;
          if (!isSafeHostname(normalizedHost)) continue;
          map[normalizedHost] = normalizedSite;
          allowlist.add(normalizedSite);
        }
      }
    } catch (error) {
      console.warn("site-map:invalid-json", error);
    }
  }

  if (fallbackSite) {
    allowlist.add(fallbackSite);
  }

  const config = { map, allowlist, fallbackSite };
  siteConfigCache = { rawMap, rawAllowlist, rawFallback, config };
  return config;
};

const isSiteAllowed = (env: any, site: string) => {
  const { allowlist } = getSiteConfig(env);
  return allowlist.has(site);
};

const resolveAnalyticsSite = (
  env: any,
  request?: Request,
  explicitSite?: string
) => {
  const { map, allowlist, fallbackSite } = getSiteConfig(env);
  if (explicitSite) {
    const normalized = parseSiteSlug(explicitSite);
    if (!normalized) return null;
    return allowlist.has(normalized) ? normalized : null;
  }

  let hostSite = "";
  if (request) {
    try {
      const hostname = normalizeHostname(new URL(request.url).hostname);
      hostSite = map[hostname] || "";
    } catch {
      hostSite = "";
    }
  }

  if (hostSite) {
    return hostSite;
  }

  if (allowlist.size === 1) {
    return Array.from(allowlist)[0] || fallbackSite;
  }

  return null;
};

const sqlString = (value: string) => `'${value.replace(/'/g, "''")}'`;

const getAnalyticsDatasetName = (env: any) => {
  if (typeof env.ANALYTICS_ENGINE_DATASET === "string") {
    return env.ANALYTICS_ENGINE_DATASET.trim();
  }
  return "";
};

const getAnalyticsDatasetIdentifier = (env: any) => {
  const datasetName = getAnalyticsDatasetName(env);
  if (!/^[A-Za-z0-9_]+$/.test(datasetName)) {
    throw new Error(
      "Analytics Engine dataset name must be alphanumeric/underscore"
    );
  }
  return datasetName;
};

const analyticsEngineConfigured = (env: any) =>
  Boolean(
    env.ANALYTICS_ENGINE_ACCOUNT_ID &&
      env.ANALYTICS_ENGINE_API_TOKEN &&
      getAnalyticsDatasetName(env)
  );

const analyticsEngineQuery = async (
  env: any,
  sql: string
): Promise<Record<string, unknown>[]> => {
  const accountId = env.ANALYTICS_ENGINE_ACCOUNT_ID;
  const apiToken = env.ANALYTICS_ENGINE_API_TOKEN;
  const dataset = getAnalyticsDatasetName(env);
  if (!accountId || !apiToken || !dataset) {
    throw new Error("Analytics Engine not configured");
  }
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`
      },
      body: sql
    }
  );
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Analytics Engine query failed (${response.status}): ${errorText}`
    );
  }
  const json = await response.json();
  const data = Array.isArray(json?.data) ? json.data : [];
  return data;
};

const buildStatsResponseFromAnalyticsEngine = async ({
  env,
  site,
  range,
  dates,
  statsTimingEnabled,
  statsRay
}: {
  env: any;
  site: string;
  range: string;
  dates: string[];
  statsTimingEnabled: boolean;
  statsRay?: string | null;
}) => {
  const datasetIdent = getAnalyticsDatasetIdentifier(env);
  const startDate = dates[0];
  const endDate = dates[dates.length - 1];
  const baseWhere = `WHERE blob2 = ${sqlString(site)} AND blob11 >= ${sqlString(
    startDate
  )} AND blob11 <= ${sqlString(endDate)}`;

  const timings: Record<string, number> = {};
  const timedQuery = async (label: string, sql: string) => {
    const start = performance.now();
    const data = await analyticsEngineQuery(env, `${sql} FORMAT JSON`);
    timings[label] = performance.now() - start;
    return data;
  };

  const [clickRows, viewRows, dailyViewRows, uniqueRows, placementRows, refRows] =
    await Promise.all([
      timedQuery(
        "clicks",
        `SELECT blob3 AS vendor, blob7 AS click_type, blob11 AS date, SUM(_sample_interval) AS count FROM ${datasetIdent} ${baseWhere} AND blob1 = ${sqlString(
          ANALYTICS_EVENT_TYPES.CLICK
        )} AND blob3 != '' GROUP BY vendor, click_type, date`
      ),
      timedQuery(
        "views",
        `SELECT blob3 AS vendor, blob4 AS page, blob6 AS tier, SUM(_sample_interval) AS count FROM ${datasetIdent} ${baseWhere} AND blob1 = ${sqlString(
          ANALYTICS_EVENT_TYPES.VIEW
        )} AND blob3 != '' GROUP BY vendor, page, tier`
      ),
      timedQuery(
        "daily_views",
        `SELECT blob11 AS date, SUM(_sample_interval) AS count FROM ${datasetIdent} ${baseWhere} AND blob1 = ${sqlString(
          ANALYTICS_EVENT_TYPES.VIEW
        )} GROUP BY date`
      ),
      timedQuery(
        "unique_views",
        `SELECT blob3 AS vendor, blob11 AS date, SUM(_sample_interval) AS count FROM ${datasetIdent} ${baseWhere} AND blob1 = ${sqlString(
          ANALYTICS_EVENT_TYPES.UNIQUE_VIEW
        )} AND blob3 != '' GROUP BY vendor, date`
      ),
      timedQuery(
        "placements",
        `SELECT blob3 AS vendor, blob8 AS placement, SUM(_sample_interval) AS count FROM ${datasetIdent} ${baseWhere} AND blob1 = ${sqlString(
          ANALYTICS_EVENT_TYPES.PLACEMENT_VIEW
        )} AND blob3 != '' GROUP BY vendor, placement`
      ),
      timedQuery(
        "referrers",
        `SELECT blob3 AS vendor, blob9 AS scope, blob10 AS bucket, SUM(_sample_interval) AS count FROM ${datasetIdent} ${baseWhere} AND blob1 = ${sqlString(
          ANALYTICS_EVENT_TYPES.REFERRER
        )} AND blob3 != '' GROUP BY vendor, scope, bucket`
      )
    ]);

  const toCount = (value: unknown) => {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.round(parsed);
  };

  const vendorAgg: Record<string, { website: number; instagram: number }> = {};
  const viewAgg: Record<string, number> = {};
  const uniqueAgg: Record<string, number> = {};
  const pageAgg: Record<string, Record<string, number>> = {};
  const refAgg: Record<
    string,
    { internal: Record<string, number>; external: Record<string, number> }
  > = {};
  const vendorTierSeen: Record<string, Set<string>> = {};
  const placementAgg: Record<string, Record<string, number>> = {};
  const tierViews = Object.fromEntries(
    Array.from(TIER_ALLOWLIST).map(tier => [tier, 0])
  );

  const dailyTotals = Object.fromEntries(dates.map(d => [d, 0]));
  const dailyViews = Object.fromEntries(dates.map(d => [d, 0]));
  const dailyUniqueViews = Object.fromEntries(dates.map(d => [d, 0]));

  for (const row of clickRows) {
    const vendor = String(row.vendor || "").trim();
    const clickType = String(row.click_type || "").trim().toLowerCase();
    const date = String(row.date || "").trim();
    if (!vendor || !ALLOWED_CLICK_TYPES.has(clickType)) continue;
    if (!(date in dailyTotals)) continue;
    const count = toCount(row.count);
    if (!count) continue;
    if (!vendorAgg[vendor]) {
      vendorAgg[vendor] = { website: 0, instagram: 0 };
    }
    vendorAgg[vendor][clickType] =
      (vendorAgg[vendor][clickType] || 0) + count;
    dailyTotals[date] += count;
  }

  for (const row of viewRows) {
    const vendor = String(row.vendor || "").trim();
    if (!vendor) continue;
    const page = String(row.page || "").trim();
    const tier = String(row.tier || "").trim();
    const count = toCount(row.count);
    if (!count) continue;
    viewAgg[vendor] = (viewAgg[vendor] || 0) + count;
    if (page) {
      if (!pageAgg[vendor]) pageAgg[vendor] = {};
      pageAgg[vendor][page] = (pageAgg[vendor][page] || 0) + count;
    }
    if (tier) {
      if (tierViews[tier] !== undefined) {
        tierViews[tier] += count;
      }
      if (!vendorTierSeen[vendor]) vendorTierSeen[vendor] = new Set();
      vendorTierSeen[vendor].add(tier);
    }
  }

  for (const row of dailyViewRows) {
    const date = String(row.date || "").trim();
    if (!(date in dailyViews)) continue;
    const count = toCount(row.count);
    if (!count) continue;
    dailyViews[date] += count;
  }

  for (const row of uniqueRows) {
    const vendor = String(row.vendor || "").trim();
    const date = String(row.date || "").trim();
    if (!vendor) continue;
    if (!(date in dailyUniqueViews)) continue;
    const count = toCount(row.count);
    if (!count) continue;
    uniqueAgg[vendor] = (uniqueAgg[vendor] || 0) + count;
    dailyUniqueViews[date] += count;
  }

  for (const row of placementRows) {
    const vendor = String(row.vendor || "").trim();
    const placement = String(row.placement || "").trim();
    if (!vendor || !placement) continue;
    const count = toCount(row.count);
    if (!count) continue;
    if (!placementAgg[vendor]) placementAgg[vendor] = {};
    placementAgg[vendor][placement] =
      (placementAgg[vendor][placement] || 0) + count;
  }

  for (const row of refRows) {
    const vendor = String(row.vendor || "").trim();
    const scope = String(row.scope || "").trim();
    const bucket = String(row.bucket || "").trim();
    if (!vendor || !bucket) continue;
    const count = toCount(row.count);
    if (!count) continue;
    if (!refAgg[vendor]) {
      refAgg[vendor] = { internal: {}, external: {} };
    }
    if (scope === "int") {
      refAgg[vendor].internal[bucket] =
        (refAgg[vendor].internal[bucket] || 0) + count;
    } else if (scope === "ext") {
      refAgg[vendor].external[bucket] =
        (refAgg[vendor].external[bucket] || 0) + count;
    }
  }

  const vendorsSet = new Set([
    ...Object.keys(vendorAgg),
    ...Object.keys(viewAgg),
    ...Object.keys(uniqueAgg),
    ...Object.keys(pageAgg),
    ...Object.keys(refAgg),
    ...Object.keys(placementAgg)
  ]);

  const vendors = Array.from(vendorsSet).map(vendor => {
    const clickCounts = vendorAgg[vendor] || {
      website: 0,
      instagram: 0
    };
    const pages = pageAgg[vendor] || {};
    const refs = refAgg[vendor] || { internal: {}, external: {} };
    const vendorMeta = getVendorMeta(vendor);
    const plan = getVendorPlan(vendor);
    const placementsActive = vendorMeta ? getActivePlacements(vendor) : [];
    const placementsCounts = Object.entries(placementAgg[vendor] || {})
      .sort((a, b) => b[1] - a[1])
      .map(([placement, count]) => ({ placement, count }));
    let metaStatus = "missing";
    if (vendorMeta) {
      metaStatus = "ok";
      const seen = vendorTierSeen[vendor];
      if (seen) {
        for (const tier of seen) {
          if (tier !== plan) {
            metaStatus = "mismatch";
            console.warn("stats:vendor-plan-mismatch", {
              vendor,
              plan,
              tier
            });
            break;
          }
        }
      }
    } else {
      console.warn("stats:vendor-missing", { vendor });
    }

    const topInternal = Object.entries(refs.internal)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([bucket, count]) => ({ bucket, count }));

    const topExternal = Object.entries(refs.external)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([domain, count]) => ({ domain, count }));

    const pagesBreakdown = Object.entries(pages)
      .sort((a, b) => b[1] - a[1])
      .map(([page, count]) => ({ page, count }));

    return {
      vendor,
      plan,
      placementsActive,
      placements: placementsCounts,
      metaStatus,
      website: clickCounts.website,
      instagram: clickCounts.instagram,
      views: viewAgg[vendor] || 0,
      uniqueViews: uniqueAgg[vendor] || 0,
      pages: pagesBreakdown,
      referrers: {
        internal: topInternal,
        external: topExternal
      }
    };
  });

  const daily = dates.map(date => ({
    date,
    total: dailyTotals[date] || 0
  }));
  const dailyViewTotals = dates.map(date => ({
    date,
    total: dailyViews[date] || 0
  }));
  const dailyUniqueViewTotals = dates.map(date => ({
    date,
    total: dailyUniqueViews[date] || 0
  }));

  const payload = {
    site,
    range,
    contractVersion: CONTRACT_VERSION,
    generatedAt: new Date().toISOString(),
    vendors,
    daily,
    dailyViews: dailyViewTotals,
    dailyUniqueViews: dailyUniqueViewTotals,
    tierViews
  };

  const responseHeaders = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });

  if (statsTimingEnabled) {
    const totalMs = Object.values(timings).reduce(
      (sum, value) => sum + value,
      0
    );
    const timingParts = Object.entries(timings).map(
      ([label, value]) => `${label};dur=${Math.round(value)}`
    );
    timingParts.push(`total;dur=${Math.round(totalMs)}`);
    responseHeaders.set("Server-Timing", timingParts.join(", "));
    console.log("stats:ae-timing", {
      site,
      range,
      cfRay: statsRay,
      ...Object.fromEntries(
        Object.entries(timings).map(([label, value]) => [
          label,
          Math.round(value)
        ])
      ),
      totalMs: Math.round(totalMs)
    });
  }

  return new Response(JSON.stringify(payload), { headers: responseHeaders });
};

const buildVendorCsvFromAnalyticsEngine = async ({
  env,
  site,
  vendor,
  dates
}: {
  env: any;
  site: string;
  vendor: string;
  dates: string[];
}) => {
  const datasetIdent = getAnalyticsDatasetIdentifier(env);
  const startDate = dates[0];
  const endDate = dates[dates.length - 1];
  const baseWhere = `WHERE blob2 = ${sqlString(site)} AND blob3 = ${sqlString(
    vendor
  )} AND blob11 >= ${sqlString(startDate)} AND blob11 <= ${sqlString(endDate)}`;

  const toCount = (value: unknown) => {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.round(parsed);
  };

  const [viewRows, uniqueRows, clickRows] = await Promise.all([
    analyticsEngineQuery(
      env,
      `SELECT blob11 AS date, SUM(_sample_interval) AS count FROM ${datasetIdent} ${baseWhere} AND blob1 = ${sqlString(
        ANALYTICS_EVENT_TYPES.VIEW
      )} GROUP BY date FORMAT JSON`
    ),
    analyticsEngineQuery(
      env,
      `SELECT blob11 AS date, SUM(_sample_interval) AS count FROM ${datasetIdent} ${baseWhere} AND blob1 = ${sqlString(
        ANALYTICS_EVENT_TYPES.UNIQUE_VIEW
      )} GROUP BY date FORMAT JSON`
    ),
    analyticsEngineQuery(
      env,
      `SELECT blob11 AS date, blob7 AS click_type, SUM(_sample_interval) AS count FROM ${datasetIdent} ${baseWhere} AND blob1 = ${sqlString(
        ANALYTICS_EVENT_TYPES.CLICK
      )} GROUP BY date, click_type FORMAT JSON`
    )
  ]);

  const perDate = Object.fromEntries(
    dates.map(date => [
      date,
      {
        views: 0,
        uniqueViews: 0,
        website: 0,
        instagram: 0
      }
    ])
  );

  for (const row of viewRows) {
    const date = String(row.date || "").trim();
    if (!(date in perDate)) continue;
    const count = toCount(row.count);
    if (!count) continue;
    perDate[date].views += count;
  }

  for (const row of uniqueRows) {
    const date = String(row.date || "").trim();
    if (!(date in perDate)) continue;
    const count = toCount(row.count);
    if (!count) continue;
    perDate[date].uniqueViews += count;
  }

  for (const row of clickRows) {
    const date = String(row.date || "").trim();
    if (!(date in perDate)) continue;
    const clickType = String(row.click_type || "").trim().toLowerCase();
    if (!ALLOWED_CLICK_TYPES.has(clickType)) continue;
    const count = toCount(row.count);
    if (!count) continue;
    perDate[date][clickType] += count;
  }

  const header =
    "date,views,unique_views,website_clicks,instagram_clicks,ctr\n";
  const rows = dates.map(date => {
    const entry = perDate[date];
    const clicks = entry.website + entry.instagram;
    const ctr =
      entry.views > 0 ? (clicks / entry.views).toFixed(4) : "0.0000";
    return [
      date,
      entry.views,
      entry.uniqueViews,
      entry.website,
      entry.instagram,
      ctr
    ].join(",");
  });

  return `${header}${rows.join("\n")}\n`;
};

type VendorMetadata = {
  version: number;
  generatedAt: string;
  vendors: Record<
    string,
    {
      plan?: "unpaid" | "basic" | "featured";
      placements?: Record<
        string,
        {
          active?: boolean;
          start?: string;
          end?: string;
          priority?: number;
        }
      >;
      labels?: string[];
      notes?: string;
    }
  >;
  enums: {
    plan: string[];
    placement: string[];
  };
  defaults: {
    plan: "unpaid" | "basic" | "featured";
    placements: Record<
      string,
      {
        active?: boolean;
        start?: string;
        end?: string;
        priority?: number;
      }
    >;
  };
};

const ALLOWED_PAGES = new Set(
  (CONTRACT.allowedPages || []).map(value => value.trim().toLowerCase())
);
const ALLOWED_PLANS = new Set(
  (CONTRACT.allowedPlans || []).map(value => value.trim().toLowerCase())
);
const ALLOWED_PLACEMENTS = new Set(
  (CONTRACT.allowedPlacements || []).map(value => value.trim().toLowerCase())
);
const ALLOWED_CLICK_TYPES = new Set(
  (CONTRACT.allowedClickTypes || []).map(value => value.trim().toLowerCase())
);
const DEFAULT_PAGE_ALLOWLIST = ALLOWED_PAGES;
const TIER_ALLOWLIST = new Set([
  ...ALLOWED_PLANS,
  "spotlight"
]);
const VENDOR_SLUG_REGEX = CONTRACT.vendorSlugRegex
  ? new RegExp(CONTRACT.vendorSlugRegex)
  : /^[a-z0-9-]+$/;
const INTERNAL_REFERRER_DOMAINS = new Set(
  (CONTRACT.internalDomains || []).map(value => value.toLowerCase())
);

const MAX_REFERRER_LENGTH = 2048;
const VISIT_ALLOWED_ORIGINS = new Set(
  (CONTRACT.cors?.visitAllowedOrigins || []).map(origin => origin.trim())
);
const EXPORT_ALLOWED_ORIGINS = new Set(
  (CONTRACT.cors?.exportAllowedOrigins || []).map(origin => origin.trim())
);

const RANGE_DAY_MAP = (() => {
  const map = {};
  for (const range of CONTRACT.defaultRanges || ["7d", "28d", "90d"]) {
    const days = parseInt(range, 10);
    if (!Number.isNaN(days)) {
      map[range] = days;
    }
  }
  return Object.keys(map).length ? map : { "7d": 7, "28d": 28, "90d": 90 };
})();

const getRangeDays = range => RANGE_DAY_MAP[range] || 0;
const MAX_RANGE_DAYS = 90;
const parseRangeDays = (range: string) => {
  const match = /^(\d+)d$/.exec(range);
  if (!match) return 0;
  return parseInt(match[1], 10);
};

const normalizeMetadata = (input: any): VendorMetadata => {
  const fallback = {
    version: 1,
    generatedAt: new Date(0).toISOString(),
    vendors: {},
    enums: {
      plan: ["unpaid", "basic", "featured"],
      placement: []
    },
    defaults: {
      plan: "unpaid",
      placements: {}
    }
  } satisfies VendorMetadata;

  if (!input || typeof input !== "object") return fallback;

  return {
    version:
      typeof input.version === "number" ? input.version : fallback.version,
    generatedAt:
      typeof input.generatedAt === "string"
        ? input.generatedAt
        : fallback.generatedAt,
    vendors:
      input.vendors && typeof input.vendors === "object"
        ? input.vendors
        : fallback.vendors,
    enums: {
      plan: Array.isArray(input.enums?.plan)
        ? input.enums.plan
        : fallback.enums.plan,
      placement: Array.isArray(input.enums?.placement)
        ? input.enums.placement
        : fallback.enums.placement
    },
    defaults: {
      plan:
        typeof input.defaults?.plan === "string"
          ? input.defaults.plan
          : fallback.defaults.plan,
      placements:
        input.defaults?.placements &&
        typeof input.defaults.placements === "object"
          ? input.defaults.placements
          : fallback.defaults.placements
    }
  };
};

const VENDOR_METADATA = normalizeMetadata(vendorMetadataRaw);
const PLAN_ENUM = new Set(
  (VENDOR_METADATA.enums.plan || []).map(value => value.trim().toLowerCase())
);
const PLACEMENT_ENUM = new Set(
  (VENDOR_METADATA.enums.placement || []).map(value => value.trim().toLowerCase())
);
const DEFAULT_PLAN = VENDOR_METADATA.defaults.plan;

const isSafeSlug = value => VENDOR_SLUG_REGEX.test(value);

export const validateVendorMetadata = (metadata: VendorMetadata) => {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!metadata || typeof metadata !== "object") {
    errors.push("metadata: invalid root object");
    return { errors, warnings };
  }

  if (typeof metadata.version !== "number") {
    errors.push("metadata.version: expected number");
  }

  if (typeof metadata.generatedAt !== "string") {
    warnings.push("metadata.generatedAt: expected string");
  }

  if (!Array.isArray(metadata.enums?.plan) || metadata.enums.plan.length === 0) {
    errors.push("metadata.enums.plan: expected non-empty array");
  }

  if (!Array.isArray(metadata.enums?.placement)) {
    errors.push("metadata.enums.placement: expected array");
  }

  if (!metadata.defaults || typeof metadata.defaults !== "object") {
    errors.push("metadata.defaults: expected object");
  } else if (!metadata.enums.plan.includes(metadata.defaults.plan)) {
    errors.push("metadata.defaults.plan: must be in enums.plan");
  }

  if (!metadata.vendors || typeof metadata.vendors !== "object") {
    errors.push("metadata.vendors: expected object");
  } else {
    for (const [slug, entry] of Object.entries(metadata.vendors)) {
      if (!isSafeSlug(slug)) {
        warnings.push(`vendor.${slug}: invalid slug`);
      }
      if (entry.plan && !metadata.enums.plan.includes(entry.plan)) {
        warnings.push(`vendor.${slug}: plan not in enums.plan`);
      }
      if (entry.placements) {
        for (const placement of Object.keys(entry.placements)) {
          if (!metadata.enums.placement.includes(placement)) {
            warnings.push(
              `vendor.${slug}: placement '${placement}' not in enums.placement`
            );
          }
        }
      }
    }
  }

  return { errors, warnings };
};

const isDevRuntime =
  (typeof process !== "undefined" &&
    !!process.env &&
    ["test", "development"].includes(process.env.NODE_ENV || "")) ||
  (typeof process !== "undefined" && !!process.env?.VITEST);

const metadataValidation = validateVendorMetadata(VENDOR_METADATA);
if (metadataValidation.errors.length || metadataValidation.warnings.length) {
  const message = [
    ...metadataValidation.errors.map(item => `error:${item}`),
    ...metadataValidation.warnings.map(item => `warn:${item}`)
  ].join(" | ");
  if (metadataValidation.errors.length && isDevRuntime) {
    throw new Error(`vendor-metadata validation failed: ${message}`);
  } else {
    console.warn(`vendor-metadata validation: ${message}`);
  }
}


const getAllowlist = value => {
  if (typeof value !== "string") return null;
  const items = value
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
  return items.length ? new Set(items) : null;
};

const normalizeHostname = hostname =>
  hostname.toLowerCase().replace(/^www\./, "");

const isSafeHostname = hostname =>
  /^[a-z0-9.-]+$/.test(hostname) && hostname.length <= 253;

const classifyInternalReferrer = pathname => {
  const path = pathname.toLowerCase().replace(/\/+$/, "") || "/";
  if (path === "/") return "home";
  if (path.startsWith("/search")) return "search";
  if (path.startsWith("/spotlight")) return "spotlight-list";
  if (path.startsWith("/featured")) return "featured-list";
  if (path.startsWith("/vendors") || path.startsWith("/vendor")) {
    return "vendor-profile";
  }
  return "other";
};

const sha1Hex = async input => {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-1", data);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
};

const incrementCounter = async (env, key, options) => {
  const current = parseInt((await env.CLICKS.get(key)) || "0", 10);
  await env.CLICKS.put(key, String(current + 1), options);
};

const getVisitCorsHeaders = request => {
  const origin = request.headers.get("Origin");
  const allowedOrigin = VISIT_ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://startmyloveengine.com";

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400"
  };
};

const isAllowedExportOrigin = origin => {
  if (!origin) return false;
  if (EXPORT_ALLOWED_ORIGINS.has(origin)) return true;
  return origin.endsWith(".mocha.app");
};

const getExportCorsHeaders = request => {
  const origin = request.headers.get("Origin");
  const allowedOrigin = isAllowedExportOrigin(origin)
    ? origin
    : "https://startmyloveengine.com";

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400"
  };
};

const parseBoolFlag = value => {
  if (value === true) return true;
  if (value === false || value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const normalizePlanValue = value => {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  return normalized;
};

const mapLegacyTier = tier => {
  const t = normalizePlanValue(tier);
  if (t === "spotlight") {
    return { plan: "unknown", placements: ["spotlight"] };
  }
  if (t === "featured" || t === "basic" || t === "unpaid") {
    return { plan: t, placements: [] };
  }
  return { plan: "", placements: [] };
};

export const getVendorMeta = slug => {
  if (!slug || typeof slug !== "string") return null;
  return VENDOR_METADATA.vendors[slug] || null;
};

export const getVendorPlan = slug => {
  const meta = getVendorMeta(slug);
  if (!meta) return "unknown";
  const plan = normalizePlanValue(meta?.plan || DEFAULT_PLAN);
  return PLAN_ENUM.has(plan) ? plan : DEFAULT_PLAN;
};

const isPlacementActive = (placement, today) => {
  if (!placement || placement.active === false) return false;
  if (placement.start && today < placement.start) return false;
  if (placement.end && today > placement.end) return false;
  return true;
};

export const getActivePlacements = (slug, today) => {
  const meta = getVendorMeta(slug);
  if (!meta) return [];
  const date = today || new Date().toISOString().slice(0, 10);
  const placements = {
    ...VENDOR_METADATA.defaults.placements,
    ...(meta?.placements || {})
  };

  return Object.entries(placements)
    .filter(([placement, config]) => {
      if (!PLACEMENT_ENUM.has(placement)) return false;
      return isPlacementActive(config, date);
    })
    .map(([placement]) => placement);
};

const getVisitAllowlists = env => {
  const pageAllowlist = env ? getAllowlist(env.VISIT_PAGE_ALLOWLIST) : null;
  return {
    pageAllowlist: pageAllowlist || DEFAULT_PAGE_ALLOWLIST,
    tierAllowlist: TIER_ALLOWLIST,
    planAllowlist: ALLOWED_PLANS,
    placementAllowlist: ALLOWED_PLACEMENTS
  };
};

const validateVisitPayload = (input, allowlists) => {
  const safeVendor =
    typeof input?.vendor === "string" ? input.vendor.trim() : "";
  const safePage =
    typeof input?.page === "string" ? input.page.trim() : "";
  const safeTier =
    typeof input?.tier === "string" ? input.tier.trim() : "";
  const safePlan =
    typeof input?.plan === "string" ? input.plan.trim() : "";
  const normalizedTier = normalizePlanValue(safeTier);
  const normalizedPlan = normalizePlanValue(safePlan);
  const placements =
    Array.isArray(input?.placements) && input.placements.length
      ? input.placements
          .map(item => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean)
      : [];

  if (!safeVendor || !safePage || (!safeTier && !safePlan)) {
    return { ok: false, error: "Missing parameters" };
  }

  if (
    safeVendor.length > 64 ||
    safePage.length > 64 ||
    (safeTier && safeTier.length > 32) ||
    (safePlan && safePlan.length > 32)
  ) {
    return { ok: false, error: "Invalid parameters" };
  }

  if (!isSafeSlug(safeVendor) || !isSafeSlug(safePage)) {
    return { ok: false, error: "Invalid parameters" };
  }

  if (!allowlists.pageAllowlist.has(safePage)) {
    return { ok: false, error: "Invalid page" };
  }

  if (safeTier && !allowlists.tierAllowlist.has(normalizedTier)) {
    return { ok: false, error: "Invalid tier" };
  }

  if (safePlan && !allowlists.planAllowlist.has(normalizedPlan)) {
    return { ok: false, error: "Invalid plan" };
  }

  for (const placement of placements) {
    if (!allowlists.placementAllowlist.has(normalizePlanValue(placement))) {
      return { ok: false, error: "Invalid placement" };
    }
  }

  return {
    ok: true,
    vendor: safeVendor,
    page: safePage,
    tier: normalizedTier,
    plan: normalizedPlan,
    placements: placements.map(normalizePlanValue)
  };
};

const resolvePlanAndPlacements = (
  validation,
  vendorPlanHint?: string
) => {
  let plan = validation.plan;
  const tier = validation.tier;
  let placements = [...(validation.placements || [])];

  if (!plan && tier) {
    const mapped = mapLegacyTier(tier);
    plan = mapped.plan;
    placements.push(...mapped.placements);
  }

  if (!plan) {
    return { ok: false, error: "Missing plan" };
  }

  const allowedPlanSet = new Set([...ALLOWED_PLANS, "unknown"]);
  if (!allowedPlanSet.has(plan)) {
    return { ok: false, error: "Invalid plan" };
  }

  placements = Array.from(
    new Set(
      placements.filter(p => ALLOWED_PLACEMENTS.has(p))
    )
  );

  const legacyTier = tier || plan;

  return { ok: true, plan, placements, legacyTier };
};

export const buildVisitPayload = ({
  vendor,
  page,
  tier,
  plan,
  placements
}) => {
  const allowlists = getVisitAllowlists();
  const validation = validateVisitPayload(
    { vendor, page, tier, plan, placements },
    allowlists
  );
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const referrer =
    typeof document !== "undefined" && document.referrer
      ? document.referrer
      : "";
  const url =
    typeof location !== "undefined" && location.href ? location.href : "";

  return {
    vendor: validation.vendor,
    page: validation.page,
    tier: validation.tier,
    plan: validation.plan,
    placements: validation.placements,
    referrer,
    url
  };
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const rateLimitPerMinute = 0;
    const signingSecret = undefined;
    // To enable:
    // const rateLimitPerMinute = Number(env.RATE_LIMIT_PER_MINUTE || 0);
    // const signingSecret = env.CLICK_SIGNING_SECRET;

    /* ----------------------------
       CLICK TRACKING (PUBLIC)
       ---------------------------- */
    if (url.pathname === "/click") {
      const clickCorsHeaders = getVisitCorsHeaders(request);

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: clickCorsHeaders });
      }

      if (request.method === "POST") {
        let payload;
        try {
          payload = await request.json();
        } catch {
          return new Response("Invalid payload", {
            status: 400,
            headers: clickCorsHeaders
          });
        }

        const vendor =
          typeof payload?.vendor === "string" ? payload.vendor.trim() : "";
        const type =
          typeof payload?.type === "string"
            ? payload.type.trim()
            : typeof payload?.target === "string"
              ? payload.target.trim()
              : "";

        if (!vendor || !type) {
          return new Response("Missing parameters", {
            status: 400,
            headers: clickCorsHeaders
          });
        }

        if (vendor.length > 64) {
          return new Response("Invalid parameters", {
            status: 400,
            headers: clickCorsHeaders
          });
        }

        if (!VENDOR_SLUG_REGEX.test(vendor)) {
          return new Response("Invalid vendor", {
            status: 400,
            headers: clickCorsHeaders
          });
        }

        if (!ALLOWED_CLICK_TYPES.has(type)) {
          return new Response("Invalid type", {
            status: 400,
            headers: clickCorsHeaders
          });
        }

        const analyticsSite = resolveAnalyticsSite(env, request);
        if (!analyticsSite) {
          return new Response("Unknown site", {
            status: 400,
            headers: clickCorsHeaders
          });
        }

        const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const key = `${vendor}:${type}:${date}`;
        const current = parseInt((await env.CLICKS.get(key)) || "0", 10);
        await env.CLICKS.put(key, String(current + 1));
        writeAnalyticsEvent(env, {
          eventType: ANALYTICS_EVENT_TYPES.CLICK,
          site: analyticsSite,
          vendor,
          clickType: type,
          date
        });

        return new Response(null, { status: 204, headers: clickCorsHeaders });
      }

      if (request.method !== "GET") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "GET, POST, OPTIONS" }
        });
      }

      const vendor = url.searchParams.get("vendor");
      const type = url.searchParams.get("type"); // website | instagram
      const destination = url.searchParams.get("to");

      // Required params
      if (!vendor || !type || !destination) {
        return new Response("Missing parameters", { status: 400 });
      }

      if (vendor.length > 64 || destination.length > 2048) {
        return new Response("Invalid parameters", { status: 400 });
      }

      // Vendor slug validation (safe KV keys)
      if (!VENDOR_SLUG_REGEX.test(vendor)) {
        return new Response("Invalid vendor", { status: 400 });
      }

      // Click type allow-list
      if (!ALLOWED_CLICK_TYPES.has(type)) {
        return new Response("Invalid type", { status: 400 });
      }

      // Destination URL validation
      let destUrl;
      try {
        destUrl = new URL(destination);
      } catch {
        return new Response("Invalid destination URL", { status: 400 });
      }

      if (destUrl.protocol !== "https:" || destUrl.username || destUrl.password) {
        return new Response("Invalid destination URL", { status: 400 });
      }

      if (signingSecret) {
        const signature = url.searchParams.get("sig");
        if (!signature) {
          return new Response("Missing signature", { status: 401 });
        }

        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
          "raw",
          encoder.encode(signingSecret),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign", "verify"]
        );

        const payload = `${vendor}|${type}|${destination}`;
        const expected = await crypto.subtle.sign(
          "HMAC",
          key,
          encoder.encode(payload)
        );

        const expectedHex = Array.from(new Uint8Array(expected))
          .map(b => b.toString(16).padStart(2, "0"))
          .join("");

        if (signature !== expectedHex) {
          return new Response("Invalid signature", { status: 401 });
        }
      }

      // Normalise hostname (strip www)
      const hostname = destUrl.hostname.replace(/^www\./, "");

      // Destination allow-list
      const ALLOWED_DOMAINS = [
        "dave-blake.com",
        "startmyloveengine.com",
        "makeupartistbyronbay.com.au",
        "kacper-goodtimes.com"
      ];

      const isAllowed =
        ALLOWED_DOMAINS.includes(hostname) ||
        hostname === "instagram.com" ||
        hostname.endsWith(".instagram.com");

      if (!isAllowed) {
        return new Response("Destination not allowed", { status: 403 });
      }

      if (rateLimitPerMinute > 0) {
        const ip =
          request.headers.get("cf-connecting-ip") ||
          request.headers.get("x-forwarded-for");
        if (ip) {
          const minute = new Date().toISOString().slice(0, 16);
          const rateKey = `rl:${ip}:${minute}`;
          const current = parseInt((await env.CLICKS.get(rateKey)) || "0", 10);
          if (current >= rateLimitPerMinute) {
            return new Response("Rate limit exceeded", { status: 429 });
          }
          await env.CLICKS.put(rateKey, String(current + 1), {
            expirationTtl: 60
          });
        }
      }

      const analyticsSite = resolveAnalyticsSite(env, request);
      if (!analyticsSite) {
        return new Response("Unknown site", { status: 400 });
      }

      // Daily KV key
      const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const key = `${vendor}:${type}:${date}`;

      const current = parseInt((await env.CLICKS.get(key)) || "0", 10);
      await env.CLICKS.put(key, String(current + 1));
      writeAnalyticsEvent(env, {
        eventType: ANALYTICS_EVENT_TYPES.CLICK,
        site: analyticsSite,
        vendor,
        clickType: type,
        date
      });

      // Redirect
      return Response.redirect(destUrl.toString(), 302);
    }

    /* ----------------------------
       VISIT TRACKING (PUBLIC)
       ---------------------------- */
    if (url.pathname === "/visit") {
      const corsHeaders = getVisitCorsHeaders(request);

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      if (request.method !== "POST") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "POST", ...corsHeaders }
        });
      }

      const analyticsSite = resolveAnalyticsSite(env, request);
      if (!analyticsSite) {
        return new Response("Unknown site", {
          status: 400,
          headers: corsHeaders
        });
      }

      const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      await incrementCounter(env, `raw:${date}`);

      let payload;
      try {
        payload = await request.json();
      } catch {
        return new Response("Invalid JSON", {
          status: 400,
          headers: corsHeaders
        });
      }

      if (!payload || typeof payload !== "object") {
        return new Response("Invalid payload", {
          status: 400,
          headers: corsHeaders
        });
      }

      const allowlists = getVisitAllowlists(env);
      const validation = validateVisitPayload(payload, allowlists);
      if (!validation.ok) {
        return new Response(validation.error, {
          status: 400,
          headers: corsHeaders
        });
      }

      const { vendor, page } = validation;
      const vendorMeta = getVendorMeta(vendor);
      const vendorPlanHint =
        vendorMeta && getVendorPlan(vendor) !== "unknown"
          ? getVendorPlan(vendor)
          : "";
      const resolvedPlan = resolvePlanAndPlacements(
        validation,
        vendorPlanHint
      );
      if (!resolvedPlan.ok) {
        return new Response(resolvedPlan.error, {
          status: 400,
          headers: corsHeaders
        });
      }

      let { plan, placements, legacyTier } = resolvedPlan;

      if (!vendorMeta) {
        plan = "unknown";
      }

      const placementsActive = getActivePlacements(vendor);
      let metaStatus = "ok";
      if (!vendorMeta) {
        metaStatus = "missing";
        console.warn("visit:vendor-missing", { vendor, plan: plan });
      } else if (legacyTier && vendorPlanHint && legacyTier !== vendorPlanHint) {
        metaStatus = "mismatch";
        console.warn("visit:vendor-plan-mismatch", {
          vendor,
          tier: legacyTier,
          plan: vendorPlanHint
        });
      }
      if (env.DEBUG_VISITS === "1") {
        console.log("visit", { ...payload, plan, metaStatus });
      }
      writeAnalyticsEvent(env, {
        eventType: ANALYTICS_EVENT_TYPES.VIEW,
        site: analyticsSite,
        vendor,
        page,
        plan,
        legacyTier,
        date
      });

      const ip =
        request.headers.get("cf-connecting-ip") ||
        request.headers.get("x-forwarded-for") ||
        "";
      const userAgent = request.headers.get("user-agent") || "";
      const fingerprint = await sha1Hex(`${ip}|${userAgent}|${vendor}`);
      const lockKey = `uviewlock:${vendor}:${fingerprint}`;

      const seen = await env.CLICKS.get(lockKey);
      if (!seen) {
        await env.CLICKS.put(lockKey, "1", { expirationTtl: 1800 });
        await incrementCounter(env, `uview:${vendor}:${date}`);
        writeAnalyticsEvent(env, {
          eventType: ANALYTICS_EVENT_TYPES.UNIQUE_VIEW,
          site: analyticsSite,
          vendor,
          page,
          plan,
          legacyTier,
          date
        });
      }

      await incrementCounter(env, `view:${vendor}:${date}`);
      await incrementCounter(env, `pview:${vendor}:${page}:${date}`);
      await incrementCounter(env, `tview:${legacyTier}:${date}`);
      await incrementCounter(env, `tview:${vendor}:${legacyTier}:${date}`);
      await incrementCounter(env, `planview:${plan}:${date}`);
      await incrementCounter(env, `planview:${vendor}:${plan}:${date}`);

      const placementUnion = new Set([
        ...placements,
        ...placementsActive
      ]);

      for (const placement of placementUnion) {
        await incrementCounter(env, `plcview:${placement}:${date}`);
        await incrementCounter(env, `plcview:${vendor}:${placement}:${date}`);
        writeAnalyticsEvent(env, {
          eventType: ANALYTICS_EVENT_TYPES.PLACEMENT_VIEW,
          site: analyticsSite,
          vendor,
          placement,
          page,
          plan,
          legacyTier,
          date
        });
      }

      const referrerValue =
        typeof payload.referrer === "string" ? payload.referrer : "";
      const headerReferrer = request.headers.get("referer") || "";
      const referrer = referrerValue || headerReferrer;

      if (referrer && referrer.length <= MAX_REFERRER_LENGTH) {
        let refUrl;
        try {
          refUrl = new URL(referrer);
        } catch {
          refUrl = null;
        }

        if (refUrl) {
          const hostname = normalizeHostname(refUrl.hostname);
          if (hostname && isSafeHostname(hostname)) {
            const isInternal = Array.from(INTERNAL_REFERRER_DOMAINS).some(
              domain => hostname === domain || hostname.endsWith(`.${domain}`)
            );

            if (isInternal) {
              const bucket = classifyInternalReferrer(refUrl.pathname);
              await incrementCounter(
                env,
                `ref:${vendor}:int:${bucket}:${date}`
              );
              writeAnalyticsEvent(env, {
                eventType: ANALYTICS_EVENT_TYPES.REFERRER,
                site: analyticsSite,
                vendor,
                page,
                plan,
                legacyTier,
                refScope: "int",
                refBucket: bucket,
                date
              });
            } else {
              await incrementCounter(
                env,
                `ref:${vendor}:ext:${hostname}:${date}`
              );
              writeAnalyticsEvent(env, {
                eventType: ANALYTICS_EVENT_TYPES.REFERRER,
                site: analyticsSite,
                vendor,
                page,
                plan,
                legacyTier,
                refScope: "ext",
                refBucket: hostname,
                date
              });
            }
          }
        }
      }

      return new Response(null, { status: 204, headers: corsHeaders });
    }

    /* ----------------------------
       CONTRACT DISCOVERY (PUBLIC)
       ---------------------------- */
    if (url.pathname === "/schema") {
      const corsHeaders = getExportCorsHeaders(request);

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      if (request.method !== "GET") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "GET, OPTIONS", ...corsHeaders }
        });
      }

      const resolved = {
        ...CONTRACT,
        resolved: {
          vendorSlugRegex: VENDOR_SLUG_REGEX.source,
          allowedPages: Array.from(ALLOWED_PAGES),
          allowedPlans: Array.from(ALLOWED_PLANS),
          allowedPlacements: Array.from(ALLOWED_PLACEMENTS),
          allowedClickTypes: Array.from(ALLOWED_CLICK_TYPES),
          internalDomains: Array.from(INTERNAL_REFERRER_DOMAINS),
          visitAllowedOrigins: Array.from(VISIT_ALLOWED_ORIGINS),
          exportAllowedOrigins: Array.from(EXPORT_ALLOWED_ORIGINS),
          defaultRanges: CONTRACT.defaultRanges || []
        }
      };

      return new Response(JSON.stringify(resolved), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=3600",
          ...corsHeaders
        }
      });
    }

    if (url.pathname === "/openapi") {
      const corsHeaders = getExportCorsHeaders(request);

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      if (request.method !== "GET") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "GET, OPTIONS", ...corsHeaders }
        });
      }

      return new Response(OPENAPI_YAML, {
        status: 200,
        headers: {
          "Content-Type": "text/yaml; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
          ...corsHeaders
        }
      });
    }

    /* ----------------------------
       STATS API (AUTHENTICATED)
       ---------------------------- */
    if (url.pathname === "/api/stats") {
      const statsTimingEnabled = env.DEBUG_STATS === "1";
      const statsStart = statsTimingEnabled ? performance.now() : 0;
      const statsRay = statsTimingEnabled
        ? request.headers.get("cf-ray")
        : null;
      let statsListMs = 0;
      let statsGetMs = 0;
      let statsSerializeMs = 0;
      let statsListCalls = 0;
      let statsGetCalls = 0;
      let statsKeysSeen = 0;

      if (request.method !== "GET") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "GET" }
        });
      }

      const auth = request.headers.get("Authorization");
      if (auth !== `Bearer ${env.ANALYTICS_API_TOKEN}`) {
        return new Response("Unauthorized", { status: 401 });
      }

      const siteParam = url.searchParams.get("site");
      const range = url.searchParams.get("range") || "28d";

      if (!siteParam) {
        return new Response("Missing site", { status: 400 });
      }
      const site = parseSiteSlug(siteParam);
      if (!site) {
        return new Response("Invalid site", { status: 400 });
      }

      const rangeDays = getRangeDays(range);
      const rawRangeDays = parseRangeDays(range);
      if (rawRangeDays > MAX_RANGE_DAYS) {
        console.log("stats:range-reject", {
          site,
          range,
          maxDays: MAX_RANGE_DAYS
        });
        return new Response(`Max range is ${MAX_RANGE_DAYS} days`, {
          status: 400
        });
      }
      if (!rangeDays) {
        return new Response("Invalid range", { status: 400 });
      }

      // Build inclusive date window
      const today = new Date();
      const dates = [];
      for (let i = rangeDays - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        dates.push(d.toISOString().slice(0, 10));
      }
      if (!isSiteAllowed(env, site)) {
        return new Response("Unknown site", { status: 404 });
      }

      if (analyticsEngineConfigured(env)) {
        try {
          console.log("stats:ae", { cached: false, range, site });
          return await buildStatsResponseFromAnalyticsEngine({
            env,
            site,
            range,
            dates,
            statsTimingEnabled,
            statsRay
          });
        } catch (error) {
          console.error("stats:analytics-engine-failed", error);
          return new Response("service_unavailable", { status: 502 });
        }
      }
      console.log("stats:kv", { cached: false, range, site });

      const vendorAgg = {};
      const viewAgg = {};
      const uniqueAgg = {};
      const pageAgg = {};
      const refAgg = {};
      const vendorTierSeen = {};
      const placementAgg = {};
      const tierViews = Object.fromEntries(
        Array.from(TIER_ALLOWLIST).map(tier => [tier, 0])
      );

      const dailyTotals = Object.fromEntries(
        dates.map(d => [d, 0])
      );
      const dailyViews = Object.fromEntries(
        dates.map(d => [d, 0])
      );
      const dailyUniqueViews = Object.fromEntries(
        dates.map(d => [d, 0])
      );

      let cursor;
      do {
        let list;
        if (statsTimingEnabled) {
          const listStart = performance.now();
          list = await env.CLICKS.list({ cursor });
          statsListMs += performance.now() - listStart;
          statsListCalls += 1;
        } else {
          list = await env.CLICKS.list({ cursor });
        }

        for (const key of list.keys) {
          statsKeysSeen += 1;
          const parts = key.name.split(":");
          if (parts[0] === "rollup") continue;
          if (parts[0] === "rl" || parts[0] === "uviewlock") continue;
          if (parts[0] === "raw") continue;

          if (parts[0] === "tview" && parts.length === 3) {
            const [, tier, date] = parts;
            if (!(date in dailyViews)) continue;

            let value;
            if (statsTimingEnabled) {
              const getStart = performance.now();
              value = parseInt(await env.CLICKS.get(key.name)) || 0;
              statsGetMs += performance.now() - getStart;
              statsGetCalls += 1;
            } else {
              value = parseInt(await env.CLICKS.get(key.name)) || 0;
            }
            if (!value) continue;

            if (tierViews[tier] !== undefined) {
              tierViews[tier] += value;
            }
            continue;
          }

          if (parts[0] === "tview" && parts.length === 4) {
            const [, vendor, tier, date] = parts;
            if (!(date in dailyViews)) continue;
            if (!vendorTierSeen[vendor]) vendorTierSeen[vendor] = new Set();
            vendorTierSeen[vendor].add(tier);
            continue;
          }

          if (
            parts[0] === "planview" ||
            parts[0] === "tview"
          ) {
            continue;
          }

          if (parts[0] === "plcview" && parts.length === 4) {
            const [, vendor, placement, date] = parts;
            if (!(date in dailyViews)) continue;

            let value;
            if (statsTimingEnabled) {
              const getStart = performance.now();
              value = parseInt(await env.CLICKS.get(key.name)) || 0;
              statsGetMs += performance.now() - getStart;
              statsGetCalls += 1;
            } else {
              value = parseInt(await env.CLICKS.get(key.name)) || 0;
            }
            if (!value) continue;

            if (!placementAgg[vendor]) placementAgg[vendor] = {};
            placementAgg[vendor][placement] =
              (placementAgg[vendor][placement] || 0) + value;
            continue;
          }

          if (parts[0] === "pview" && parts.length === 3) {
            continue;
          }

          if (parts[0] === "view" && parts.length === 3) {
            const [, vendor, date] = parts;
            if (!(date in dailyViews)) continue;

            let value;
            if (statsTimingEnabled) {
              const getStart = performance.now();
              value = parseInt(await env.CLICKS.get(key.name)) || 0;
              statsGetMs += performance.now() - getStart;
              statsGetCalls += 1;
            } else {
              value = parseInt(await env.CLICKS.get(key.name)) || 0;
            }
            if (!value) continue;

            viewAgg[vendor] = (viewAgg[vendor] || 0) + value;
            dailyViews[date] += value;
            continue;
          }

          if (parts[0] === "uview" && parts.length === 3) {
            const [, vendor, date] = parts;
            if (!(date in dailyUniqueViews)) continue;

            let value;
            if (statsTimingEnabled) {
              const getStart = performance.now();
              value = parseInt(await env.CLICKS.get(key.name)) || 0;
              statsGetMs += performance.now() - getStart;
              statsGetCalls += 1;
            } else {
              value = parseInt(await env.CLICKS.get(key.name)) || 0;
            }
            if (!value) continue;

            uniqueAgg[vendor] = (uniqueAgg[vendor] || 0) + value;
            dailyUniqueViews[date] += value;
            continue;
          }

          if (parts[0] === "pview" && parts.length === 4) {
            const [, vendor, page, date] = parts;
            if (!(date in dailyViews)) continue;

            let value;
            if (statsTimingEnabled) {
              const getStart = performance.now();
              value = parseInt(await env.CLICKS.get(key.name)) || 0;
              statsGetMs += performance.now() - getStart;
              statsGetCalls += 1;
            } else {
              value = parseInt(await env.CLICKS.get(key.name)) || 0;
            }
            if (!value) continue;

            if (!pageAgg[vendor]) pageAgg[vendor] = {};
            pageAgg[vendor][page] =
              (pageAgg[vendor][page] || 0) + value;
            continue;
          }

          if (parts[0] === "ref" && parts.length === 5) {
            const [, vendor, scope, bucket, date] = parts;
            if (!(date in dailyViews)) continue;

            let value;
            if (statsTimingEnabled) {
              const getStart = performance.now();
              value = parseInt(await env.CLICKS.get(key.name)) || 0;
              statsGetMs += performance.now() - getStart;
              statsGetCalls += 1;
            } else {
              value = parseInt(await env.CLICKS.get(key.name)) || 0;
            }
            if (!value) continue;

            if (!refAgg[vendor]) {
              refAgg[vendor] = { internal: {}, external: {} };
            }

            if (scope === "int") {
              refAgg[vendor].internal[bucket] =
                (refAgg[vendor].internal[bucket] || 0) + value;
            } else if (scope === "ext") {
              refAgg[vendor].external[bucket] =
                (refAgg[vendor].external[bucket] || 0) + value;
            }
            continue;
          }

          if (parts.length !== 3) continue;

          const [vendor, type, date] = parts;
          if (!ALLOWED_CLICK_TYPES.has(type)) continue;
          if (!(date in dailyTotals)) continue;

          let value;
          if (statsTimingEnabled) {
            const getStart = performance.now();
            value = parseInt(await env.CLICKS.get(key.name)) || 0;
            statsGetMs += performance.now() - getStart;
            statsGetCalls += 1;
          } else {
            value = parseInt(await env.CLICKS.get(key.name)) || 0;
          }
          if (!value) continue;

          if (!vendorAgg[vendor]) {
            vendorAgg[vendor] = { website: 0, instagram: 0 };
          }

          vendorAgg[vendor][type] += value;
          dailyTotals[date] += value;
        }

        cursor = list.cursor;
      } while (cursor);

      const vendorsSet = new Set([
        ...Object.keys(vendorAgg),
        ...Object.keys(viewAgg),
        ...Object.keys(uniqueAgg),
        ...Object.keys(pageAgg),
        ...Object.keys(refAgg),
        ...Object.keys(placementAgg)
      ]);

      const vendors = Array.from(vendorsSet).map(vendor => {
        const clickCounts = vendorAgg[vendor] || {
          website: 0,
          instagram: 0
        };
        const pages = pageAgg[vendor] || {};
        const refs = refAgg[vendor] || { internal: {}, external: {} };
        const vendorMeta = getVendorMeta(vendor);
        const plan = getVendorPlan(vendor);
        const placementsActive = vendorMeta ? getActivePlacements(vendor) : [];
        const placementsCounts = Object.entries(placementAgg[vendor] || {})
          .sort((a, b) => b[1] - a[1])
          .map(([placement, count]) => ({ placement, count }));
        let metaStatus = "missing";
        if (vendorMeta) {
          metaStatus = "ok";
          const seen = vendorTierSeen[vendor];
          if (seen) {
            for (const tier of seen) {
              if (tier !== plan) {
                metaStatus = "mismatch";
                console.warn("stats:vendor-plan-mismatch", {
                  vendor,
                  plan,
                  tier
                });
                break;
              }
            }
          }
        } else {
          console.warn("stats:vendor-missing", { vendor });
        }

        const topInternal = Object.entries(refs.internal)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([bucket, count]) => ({ bucket, count }));

        const topExternal = Object.entries(refs.external)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([domain, count]) => ({ domain, count }));

        const pagesBreakdown = Object.entries(pages)
          .sort((a, b) => b[1] - a[1])
          .map(([page, count]) => ({ page, count }));

        return {
          vendor,
          plan,
          placementsActive,
          placements: placementsCounts,
          metaStatus,
          website: clickCounts.website,
          instagram: clickCounts.instagram,
          views: viewAgg[vendor] || 0,
          uniqueViews: uniqueAgg[vendor] || 0,
          pages: pagesBreakdown,
          referrers: {
            internal: topInternal,
            external: topExternal
          }
        };
      });

      const daily = dates.map(date => ({
        date,
        total: dailyTotals[date] || 0
      }));
      const dailyViewTotals = dates.map(date => ({
        date,
        total: dailyViews[date] || 0
      }));
      const dailyUniqueViewTotals = dates.map(date => ({
        date,
        total: dailyUniqueViews[date] || 0
      }));

      const payload = {
        site,
        range,
        contractVersion: CONTRACT_VERSION,
        generatedAt: new Date().toISOString(),
        vendors,
        daily,
        dailyViews: dailyViewTotals,
        dailyUniqueViews: dailyUniqueViewTotals,
        tierViews
      };
      let body;
      if (statsTimingEnabled) {
        const serializeStart = performance.now();
        body = JSON.stringify(payload);
        statsSerializeMs = performance.now() - serializeStart;
      } else {
        body = JSON.stringify(payload);
      }
      let statsTimingHeader = "";
      if (statsTimingEnabled) {
        const totalMs = performance.now() - statsStart;
        const listMsRounded = Math.round(statsListMs);
        const getMsRounded = Math.round(statsGetMs);
        const serializeMsRounded = Math.round(statsSerializeMs);
        const totalMsRounded = Math.round(totalMs);
        statsTimingHeader = [
          `list;dur=${listMsRounded}`,
          `get;dur=${getMsRounded}`,
          `serialize;dur=${serializeMsRounded}`,
          `total;dur=${totalMsRounded}`
        ].join(", ");
        console.log("stats:timing", {
          site,
          range,
          cfRay: statsRay,
          listCalls: statsListCalls,
          listMs: listMsRounded,
          getCalls: statsGetCalls,
          getMs: getMsRounded,
          keysSeen: statsKeysSeen,
          serializeMs: serializeMsRounded,
          totalMs: totalMsRounded
        });
      }
      const responseHeaders = new Headers({
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      });
      if (statsTimingHeader) {
        responseHeaders.set("Server-Timing", statsTimingHeader);
      }
      return new Response(body, {
        status: 200,
        headers: responseHeaders
      });
    }

    /* ----------------------------
       VENDOR CSV EXPORT (AUTHENTICATED)
       ---------------------------- */
    if (url.pathname === "/api/export/vendor.csv") {
      const corsHeaders = getExportCorsHeaders(request);

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      if (request.method !== "GET") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "GET", ...corsHeaders }
        });
      }

      const auth = request.headers.get("Authorization");
      if (auth !== `Bearer ${env.ANALYTICS_API_TOKEN}`) {
        return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      }

      const vendor = url.searchParams.get("vendor") || "";
      const range = url.searchParams.get("range") || "28d";
      const siteParam = url.searchParams.get("site");

      if (!vendor) {
        return new Response("Missing vendor", { status: 400, headers: corsHeaders });
      }

      if (vendor.length > 64 || !isSafeSlug(vendor)) {
        return new Response("Invalid vendor", { status: 400, headers: corsHeaders });
      }

      const rangeDays = getRangeDays(range);
      const rawRangeDays = parseRangeDays(range);
      if (rawRangeDays > MAX_RANGE_DAYS) {
        console.log("export:range-reject", {
          site: siteParam || "unknown",
          vendor,
          range,
          maxDays: MAX_RANGE_DAYS
        });
        return new Response(`Max range is ${MAX_RANGE_DAYS} days`, {
          status: 400,
          headers: corsHeaders
        });
      }
      if (!rangeDays) {
        return new Response("Invalid range", { status: 400, headers: corsHeaders });
      }

      const today = new Date();
      const dates = [];
      for (let i = rangeDays - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        dates.push(d.toISOString().slice(0, 10));
      }

      let analyticsSite: string | null = null;
      if (siteParam) {
        const parsedSite = parseSiteSlug(siteParam);
        if (!parsedSite) {
          return new Response("Invalid site", {
            status: 400,
            headers: corsHeaders
          });
        }
        if (!isSiteAllowed(env, parsedSite)) {
          return new Response("Unknown site", {
            status: 404,
            headers: corsHeaders
          });
        }
        analyticsSite = parsedSite;
      } else {
        analyticsSite = resolveAnalyticsSite(env, request);
        if (!analyticsSite) {
          return new Response("Unknown site", {
            status: 404,
            headers: corsHeaders
          });
        }
      }

      if (analyticsEngineConfigured(env)) {
        try {
          console.log("export:ae", {
            cached: false,
            range,
            site: analyticsSite,
            vendor
          });
          const csv = await buildVendorCsvFromAnalyticsEngine({
            env,
            site: analyticsSite,
            vendor,
            dates
          });

          return new Response(csv, {
            headers: {
              "Content-Type": "text/csv; charset=utf-8",
              "Cache-Control": "no-store",
              ...corsHeaders
            }
          });
        } catch (error) {
          console.error("vendor-export:analytics-engine-failed", error);
          return new Response("service_unavailable", {
            status: 502,
            headers: corsHeaders
          });
        }
      }
      console.log("export:kv", {
        cached: false,
        range,
        site: analyticsSite,
        vendor
      });

      const perDate = Object.fromEntries(
        dates.map(date => [
          date,
          {
            views: 0,
            uniqueViews: 0,
            website: 0,
            instagram: 0
          }
        ])
      );

      let cursor;
      do {
        const list = await env.CLICKS.list({ cursor });

        for (const key of list.keys) {
          const parts = key.name.split(":");
          if (parts[0] === "rollup") continue;
          if (parts[0] === "rl" || parts[0] === "uviewlock") continue;
          if (parts[0] === "raw") continue;

          if (parts[0] === "view" && parts.length === 3) {
            const [, keyVendor, date] = parts;
            if (keyVendor !== vendor || !(date in perDate)) continue;
            const value = parseInt(await env.CLICKS.get(key.name)) || 0;
            if (!value) continue;
            perDate[date].views += value;
            continue;
          }

          if (parts[0] === "uview" && parts.length === 3) {
            const [, keyVendor, date] = parts;
            if (keyVendor !== vendor || !(date in perDate)) continue;
            const value = parseInt(await env.CLICKS.get(key.name)) || 0;
            if (!value) continue;
            perDate[date].uniqueViews += value;
            continue;
          }

          if (parts.length !== 3) continue;
          const [keyVendor, type, date] = parts;
          if (keyVendor !== vendor) continue;
          if (!["website", "instagram"].includes(type)) continue;
          if (!(date in perDate)) continue;

          const value = parseInt(await env.CLICKS.get(key.name)) || 0;
          if (!value) continue;

          perDate[date][type] += value;
        }

        cursor = list.cursor;
      } while (cursor);

      const header =
        "date,views,unique_views,website_clicks,instagram_clicks,ctr\n";
      const rows = dates.map(date => {
        const entry = perDate[date];
        const clicks = entry.website + entry.instagram;
        const ctr =
          entry.views > 0
            ? (clicks / entry.views).toFixed(4)
            : "0.0000";
        return [
          date,
          entry.views,
          entry.uniqueViews,
          entry.website,
          entry.instagram,
          ctr
        ].join(",");
      });
      const csv = `${header}${rows.join("\n")}\n`;

      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Cache-Control": "no-store",
          ...corsHeaders
        }
      });
    }

    /* ----------------------------
       BACKFILL ANALYTICS EVENTS (ADMIN)
       ---------------------------- */
    if (url.pathname === "/_backfill/outbound-clicks") {
      if (!env.BACKFILL_TOKEN) {
        return new Response("Not found", { status: 404 });
      }

      if (request.method !== "POST") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "POST" }
        });
      }

      const auth = request.headers.get("Authorization");
      if (auth !== `Bearer ${env.BACKFILL_TOKEN}`) {
        return new Response("Unauthorized", { status: 401 });
      }

      let payload: any = {};
      try {
        payload = await request.json();
      } catch {
        payload = {};
      }

      const siteInput =
        typeof payload.site === "string" ? payload.site : env.ANALYTICS_SITE;
      const site = parseSiteSlug(siteInput);
      if (!site || !isSiteAllowed(env, site)) {
        return new Response("Invalid site", { status: 400 });
      }

      const limitRaw =
        typeof payload.limit === "number" ? payload.limit : 200;
      const limit = Math.max(1, Math.min(200, Math.floor(limitRaw)));

      const requestedTypes = Array.isArray(payload.types)
        ? payload.types
        : [];
      const normalizedTypes = requestedTypes.length
        ? requestedTypes
            .map((value: string) => String(value).trim().toLowerCase())
            .filter(Boolean)
        : ["click"];
      const types = new Set<string>();
      for (const type of normalizedTypes) {
        if (type === "click") types.add("click");
        if (type === "view") types.add("view");
        if (type === "unique_view" || type === "unique" || type === "uview") {
          types.add("unique_view");
        }
      }
      if (!types.size) {
        return new Response("Invalid types", { status: 400 });
      }

      const daysRaw =
        typeof payload.days === "number" ? Math.floor(payload.days) : 14;
      const days = Math.max(1, Math.min(30, daysRaw));

      const today = new Date();
      const endDate =
        typeof payload.end === "string" ? payload.end : null;
      const startDate =
        typeof payload.start === "string" ? payload.start : null;

      const end = endDate
        ? new Date(endDate)
        : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
      const start = startDate
        ? new Date(startDate)
        : new Date(end);
      if (!startDate) {
        start.setUTCDate(start.getUTCDate() - (days - 1));
      }

      const toDateString = (d: Date) => d.toISOString().slice(0, 10);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return new Response("Invalid date", { status: 400 });
      }
      if (start > end) {
        return new Response("Invalid date range", { status: 400 });
      }

      const dateSet = new Set<string>();
      const cursorDate = new Date(start);
      while (cursorDate <= end) {
        dateSet.add(toDateString(cursorDate));
        cursorDate.setUTCDate(cursorDate.getUTCDate() + 1);
      }

      const resumeKey =
        typeof payload.key === "string" ? payload.key : "";
      let remainingForKey =
        typeof payload.remaining === "number" ? payload.remaining : 0;
      let cursor = typeof payload.cursor === "string" ? payload.cursor : "";

      let pointsWritten = 0;
      let keysScanned = 0;

      const parseClickKey = (keyName: string) => {
        const parts = keyName.split(":");
        if (parts.length !== 3) return null;
        if (parts[0] === "view" && types.has("view")) {
          const [, vendor, date] = parts;
          if (!vendor || !dateSet.has(date)) return null;
          return { eventType: ANALYTICS_EVENT_TYPES.VIEW, vendor, date };
        }
        if (parts[0] === "uview" && types.has("unique_view")) {
          const [, vendor, date] = parts;
          if (!vendor || !dateSet.has(date)) return null;
          return { eventType: ANALYTICS_EVENT_TYPES.UNIQUE_VIEW, vendor, date };
        }
        if (!types.has("click")) return null;
        const [vendor, clickType, date] = parts;
        if (!vendor || !ALLOWED_CLICK_TYPES.has(clickType)) return null;
        if (!dateSet.has(date)) return null;
        return {
          eventType: ANALYTICS_EVENT_TYPES.CLICK,
          vendor,
          date,
          clickType
        };
      };

      const writeBackfillEvents = (
        parsed: {
          eventType: AnalyticsEventType;
          vendor: string;
          date: string;
          clickType?: string;
        },
        count: number
      ) => {
        for (let i = 0; i < count; i += 1) {
          writeAnalyticsEvent(env, {
            eventType: parsed.eventType,
            site,
            vendor: parsed.vendor,
            clickType: parsed.clickType,
            date: parsed.date
          });
        }
      };

      if (resumeKey && remainingForKey > 0 && pointsWritten < limit) {
        const parsed = parseClickKey(resumeKey);
        if (parsed) {
          const toWrite = Math.min(remainingForKey, limit - pointsWritten);
          writeBackfillEvents(parsed, toWrite);
          pointsWritten += toWrite;
          remainingForKey -= toWrite;
          if (remainingForKey > 0) {
            return new Response(
              JSON.stringify({
                done: false,
                cursor,
                key: resumeKey,
                remaining: remainingForKey,
                types: Array.from(types),
                pointsWritten,
                keysScanned
              }),
              { headers: { "Content-Type": "application/json" } }
            );
          }
        }
      }

      let listDone = false;
      while (pointsWritten < limit && !listDone) {
        const list = await env.CLICKS.list({ cursor });
        for (const key of list.keys) {
          keysScanned += 1;
          if (pointsWritten >= limit) break;
          const parsed = parseClickKey(key.name);
          if (!parsed) continue;
          const value = parseInt(await env.CLICKS.get(key.name)) || 0;
          if (!value) continue;
          const toWrite = Math.min(value, limit - pointsWritten);
          writeBackfillEvents(parsed, toWrite);
          pointsWritten += toWrite;
          if (toWrite < value) {
            return new Response(
              JSON.stringify({
                done: false,
                cursor: list.cursor || "",
                key: key.name,
                remaining: value - toWrite,
                types: Array.from(types),
                pointsWritten,
                keysScanned
              }),
              { headers: { "Content-Type": "application/json" } }
            );
          }
        }
        cursor = list.cursor;
        listDone = !cursor;
      }

      const done = listDone;
      console.log("backfill:events", {
        site,
        start: toDateString(start),
        end: toDateString(end),
        types: Array.from(types),
        pointsWritten,
        keysScanned,
        done
      });

      return new Response(
        JSON.stringify({
          done,
          cursor: cursor || "",
          key: "",
          remaining: 0,
          types: Array.from(types),
          pointsWritten,
          keysScanned
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    /* ----------------------------
       DEBUG KV INSPECTION (DEV-ONLY)
       ---------------------------- */
    if (url.pathname === "/_debug/kv") {
      if (env.DEBUG_MODE !== "1") {
        return new Response("Not found", { status: 404 });
      }

      if (request.method !== "GET") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "GET" }
        });
      }

      const auth = request.headers.get("Authorization");
      if (auth !== `Bearer ${env.ANALYTICS_API_TOKEN}`) {
        return new Response("Unauthorized", { status: 401 });
      }

      const list = await env.CLICKS.list();
      const samples = {};
      for (const key of list.keys.slice(0, 50)) {
        samples[key.name] = await env.CLICKS.get(key.name);
      }

      return new Response(
        JSON.stringify({
          keys: list.keys,
          cursor: list.cursor,
          samples
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
          }
        }
      );
    }

    return new Response("Not found", { status: 404 });
  },

  /* ----------------------------
     DAILY → MONTHLY ROLLUP (CRON)
     ---------------------------- */
  async scheduled(event, env) {
    const now = env.CRON_NOW ? new Date(env.CRON_NOW) : new Date();
    console.log("cron:start", now.toISOString());
    const isDryRun = parseBoolFlag(env.CRON_DRY_RUN);
    if (isDryRun) {
      console.log("cron:dry-run");
    }
    const maxKeysRaw = env.CRON_MAX_KEYS;
    const maxKeys =
      typeof maxKeysRaw === "number"
        ? maxKeysRaw
        : parseInt(maxKeysRaw || "0", 10);
    const cutoffDate = (() => {
      const year = now.getUTCFullYear();
      const monthIndex = now.getUTCMonth() - 2;
      const cutoff = new Date(Date.UTC(year, monthIndex, 1));
      return cutoff.toISOString().slice(0, 10);
    })();

    const lockKey = "rollup:lock";
    const lock = await env.CLICKS.get(lockKey);
    if (lock) {
      return;
    }

    await env.CLICKS.put(lockKey, now.toISOString(), {
      expirationTtl: 600
    });

    const snapshotRowsByMonth = new Map();
    const snapshotAllRowsByMonth = new Map();
    const keysToDelete = [];
    let processedKeys = 0;
    let aborted = false;

    let cursor;
    try {
      do {
        const list = await env.CLICKS.list({ cursor });

        for (const key of list.keys) {
          const parts = key.name.split(":");
          if (parts[0] === "rollup" || parts[0] === "rl") continue;
          if (parts[0] === "uviewlock") continue;

          let monthlyKey = null;
          let snapshotRow = null;
          let date = null;

          if (parts.length === 3 && ["website", "instagram"].includes(parts[1])) {
            const [vendor, type, clickDate] = parts;
            date = clickDate;
            const month = date.slice(0, 7);
            monthlyKey = `rollup:${vendor}:${type}:${month}`;
            snapshotRow = `${vendor},${type},${date}`;
          } else if (parts[0] === "tview" && parts.length === 3) {
            const [, tier, viewDate] = parts;
            date = viewDate;
            const month = date.slice(0, 7);
            monthlyKey = `rollup:tview:${tier}:${month}`;
          } else if (parts[0] === "tview" && parts.length === 4) {
            const [, vendor, tier, viewDate] = parts;
            date = viewDate;
            const month = date.slice(0, 7);
            monthlyKey = `rollup:tview:${vendor}:${tier}:${month}`;
          } else if (parts[0] === "planview" && parts.length === 3) {
            const [, plan, viewDate] = parts;
            date = viewDate;
            const month = date.slice(0, 7);
            monthlyKey = `rollup:planview:${plan}:${month}`;
          } else if (parts[0] === "planview" && parts.length === 4) {
            const [, vendor, plan, viewDate] = parts;
            date = viewDate;
            const month = date.slice(0, 7);
            monthlyKey = `rollup:planview:${vendor}:${plan}:${month}`;
          } else if (parts[0] === "plcview" && parts.length === 3) {
            const [, placement, viewDate] = parts;
            date = viewDate;
            const month = date.slice(0, 7);
            monthlyKey = `rollup:plcview:${placement}:${month}`;
          } else if (parts[0] === "plcview" && parts.length === 4) {
            const [, vendor, placement, viewDate] = parts;
            date = viewDate;
            const month = date.slice(0, 7);
            monthlyKey = `rollup:plcview:${vendor}:${placement}:${month}`;
          } else if (parts[0] === "view" && parts.length === 3) {
            const [, vendor, viewDate] = parts;
            date = viewDate;
            const month = date.slice(0, 7);
            monthlyKey = `rollup:view:${vendor}:${month}`;
          } else if (parts[0] === "uview" && parts.length === 3) {
            const [, vendor, viewDate] = parts;
            date = viewDate;
            const month = date.slice(0, 7);
            monthlyKey = `rollup:uview:${vendor}:${month}`;
          } else if (parts[0] === "pview" && parts.length === 3) {
            const [, plan, viewDate] = parts;
            date = viewDate;
            const month = date.slice(0, 7);
            monthlyKey = `rollup:pview:${plan}:${month}`;
          } else if (parts[0] === "pview" && parts.length === 4) {
            const [, vendor, page, viewDate] = parts;
            date = viewDate;
            const month = date.slice(0, 7);
            if (PLAN_ENUM.has(page)) {
              monthlyKey = `rollup:pview:${vendor}:${page}:${month}`;
            } else {
              monthlyKey = `rollup:pview:${vendor}:${page}:${month}`;
            }
          } else if (parts[0] === "ref" && parts.length === 5) {
            const [, vendor, scope, bucket, refDate] = parts;
            date = refDate;
            const month = date.slice(0, 7);
            monthlyKey = `rollup:ref:${vendor}:${scope}:${bucket}:${month}`;
          } else if (parts[0] === "raw" && parts.length === 2) {
            const [, rawDate] = parts;
            date = rawDate;
            const month = date.slice(0, 7);
            monthlyKey = `rollup:raw:${month}`;
          } else {
            continue;
          }

          if (date >= cutoffDate) continue;

          processedKeys += 1;
          if (maxKeys > 0 && processedKeys > maxKeys) {
            console.warn("cron:abort:max-keys", {
              processedKeys,
              maxKeys
            });
            aborted = true;
            break;
          }

          const value = parseInt(await env.CLICKS.get(key.name)) || 0;
          if (value > 0) {
            if (env.CLICKS_ARCHIVE) {
              await env.CLICKS_ARCHIVE.put(key.name, String(value));
            }
            if (snapshotRow && env.CLICKS_SNAPSHOTS) {
              const month = date.slice(0, 7);
              if (!snapshotRowsByMonth.has(month)) {
                snapshotRowsByMonth.set(month, []);
              }
              snapshotRowsByMonth.get(month).push(
                `${snapshotRow},${value}`
              );
            }

            if (env.CLICKS_SNAPSHOTS) {
              const month = date.slice(0, 7);
              if (!snapshotAllRowsByMonth.has(month)) {
                snapshotAllRowsByMonth.set(month, []);
              }
              snapshotAllRowsByMonth.get(month).push(
                `${key.name},${value}`
              );
            }

            const existing =
              parseInt(await env.CLICKS.get(monthlyKey)) || 0;

            await env.CLICKS.put(
              monthlyKey,
              String(existing + value)
            );
          }

          if (!isDryRun) {
            keysToDelete.push(key.name);
          }
        }

        if (aborted) break;
        cursor = list.cursor;
      } while (cursor);

      if (env.CLICKS_SNAPSHOTS) {
        const snapshotPrefix = "smle/snapshots";
        const timestamp = now.toISOString().replace(/[:.]/g, "-");
        for (const [month, rows] of snapshotRowsByMonth.entries()) {
          const header = "vendor,type,date,count\n";
          const body = rows.join("\n");
          const csv = `${header}${body}\n`;
          await env.CLICKS_SNAPSHOTS.put(
            `${snapshotPrefix}/${month}/${timestamp}.csv`,
            csv
          );
        }

        if (snapshotAllRowsByMonth.size > 0) {
          const rawPrefix = "smle/snapshots-raw";
          const rawHeader = "key,value\n";
          const rawTimestamp = timestamp;
          for (const [month, rows] of snapshotAllRowsByMonth.entries()) {
            const body = rows.join("\n");
            const csv = `${rawHeader}${body}\n`;
            await env.CLICKS_SNAPSHOTS.put(
              `${rawPrefix}/${month}/${rawTimestamp}.csv`,
              csv
            );
          }
        }
      }
      if (!isDryRun) {
        for (const keyName of keysToDelete) {
          await env.CLICKS.delete(keyName);
        }
      }
    } finally {
      await env.CLICKS.delete(lockKey);
    }
  }
};
