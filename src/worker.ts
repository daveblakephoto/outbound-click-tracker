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
const METADATA_ENFORCED_SITE = "startmyloveengine";
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
  city?: string;
  agencySlug?: string;
  pageType?: string;
  sourceHost?: string;
  deviceClass?: string;
  refChannel?: string;
  eventContext?: string;
  clickType?: string;
  placement?: string;
  refScope?: "int" | "ext";
  refBucket?: string;
  signature?: string;
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
  DATE: 10,
  SIGNATURE: 11,
  CITY: 12,
  AGENCY_SLUG: 13,
  PAGE_TYPE: 14,
  SOURCE_HOST: 15,
  SOURCE_ENV: 16,
  DEVICE_CLASS: 17,
  REF_CHANNEL: 18,
  EVENT_CONTEXT: 19
} as const;

const ANALYTICS_BLOB_COUNT = 20;
let analyticsIndexMode: "dual" | "single" = "dual";
let analyticsIndexFallbackLogged = false;

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
  blobs[ANALYTICS_BLOBS.SIGNATURE] = fields.signature || "";
  blobs[ANALYTICS_BLOBS.CITY] = fields.city || "";
  blobs[ANALYTICS_BLOBS.AGENCY_SLUG] = fields.agencySlug || "";
  blobs[ANALYTICS_BLOBS.PAGE_TYPE] = fields.pageType || "";
  blobs[ANALYTICS_BLOBS.SOURCE_HOST] = fields.sourceHost || "";
  // Reserved for backward-compatibility with historic blob position.
  blobs[ANALYTICS_BLOBS.SOURCE_ENV] = "";
  blobs[ANALYTICS_BLOBS.DEVICE_CLASS] = fields.deviceClass || "";
  blobs[ANALYTICS_BLOBS.REF_CHANNEL] = fields.refChannel || "";
  blobs[ANALYTICS_BLOBS.EVENT_CONTEXT] = fields.eventContext || "";
  return blobs;
};

const writeAnalyticsEvent = (
  env: any,
  fields: AnalyticsEventFields
) => {
  const dataset = env.ANALYTICS_ENGINE as AnalyticsEngineDataset | undefined;
  if (!dataset) return;

  const basePoint = {
    blobs: buildAnalyticsBlobs(fields),
    doubles: [1]
  };

  const dualIndexes = [fields.site || "unknown", fields.vendor || "unknown"];
  const singleIndex = [fields.vendor || "unknown"];

  try {
    if (analyticsIndexMode === "single") {
      dataset.writeDataPoint({
        ...basePoint,
        indexes: singleIndex
      });
      return;
    }

    dataset.writeDataPoint({
      ...basePoint,
      indexes: dualIndexes
    });
  } catch (error) {
    if (analyticsIndexMode === "dual") {
      try {
        dataset.writeDataPoint({
          ...basePoint,
          indexes: singleIndex
        });
        analyticsIndexMode = "single";
        if (!analyticsIndexFallbackLogged) {
          console.warn("analytics:index-fallback-to-single");
          analyticsIndexFallbackLogged = true;
        }
        return;
      } catch (fallbackError) {
        if (env.DEBUG_STATS === "1") {
          console.warn("analytics:write-failed", {
            primary: String(error),
            fallback: String(fallbackError)
          });
        }
        return;
      }
    }

    if (env.DEBUG_STATS === "1") {
      console.warn("analytics:write-failed", String(error));
    }
  }
};

const parseSiteSlug = (value: unknown) => {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "";
  if (!/^[a-z0-9.-]+$/.test(normalized)) return "";
  if (normalized.startsWith(".") || normalized.endsWith(".")) return "";
  if (normalized.includes("..")) return "";
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

  // Prefer mapped Origin host for multi-site clients calling a shared endpoint host.
  // This lets dave-blake.com events remain isolated even when posting to go.startmyloveengine.com.
  if (request) {
    try {
      const originHeader = request.headers.get("Origin") || "";
      if (originHeader && VISIT_ALLOWED_ORIGINS.has(originHeader)) {
        const originHost = normalizeHostname(new URL(originHeader).hostname);
        const originSite = map[originHost] || "";
        if (originSite) return originSite;
      }
    } catch {
      // Ignore malformed origin and continue with URL-host lookup.
    }
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

const isMetadataEnforcedForSite = (site: string) =>
  site === METADATA_ENFORCED_SITE;

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
  statsRay,
  cacheControl,
  dataSource = "ae",
  dataWarning
}: {
  env: any;
  site: string;
  range: string;
  dates: string[];
  statsTimingEnabled: boolean;
  statsRay?: string | null;
  cacheControl?: string;
  dataSource?: string;
  dataWarning?: string;
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
        `SELECT blob3 AS vendor, blob4 AS page, blob5 AS plan_observed, blob6 AS legacy_tier, blob13 AS city, blob14 AS agency_slug, blob15 AS page_type, SUM(_sample_interval) AS count FROM ${datasetIdent} ${baseWhere} AND blob1 = ${sqlString(
          ANALYTICS_EVENT_TYPES.VIEW
        )} AND blob3 != '' GROUP BY vendor, page, plan_observed, legacy_tier, city, agency_slug, page_type`
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
  const vendorPlanAgg: Record<string, Record<string, number>> = {};
  const vendorContext: Record<
    string,
    { city: string; agencySlug: string; pageType: string }
  > = {};
  const refAgg: Record<
    string,
    { internal: Record<string, number>; external: Record<string, number> }
  > = {};
  const vendorLegacyTierSeen: Record<string, Set<string>> = {};
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
    const planObserved = String(row.plan_observed || "").trim();
    const legacyTier = String(row.legacy_tier || "").trim();
    const city = String(row.city || "").trim();
    const agencySlug = String(row.agency_slug || "").trim();
    const pageType = String(row.page_type || "").trim();
    const count = toCount(row.count);
    if (!count) continue;
    viewAgg[vendor] = (viewAgg[vendor] || 0) + count;
    if (!vendorContext[vendor]) {
      vendorContext[vendor] = { city: "", agencySlug: "", pageType: "" };
    }
    if (city && !vendorContext[vendor].city) {
      vendorContext[vendor].city = city;
    }
    if (agencySlug && !vendorContext[vendor].agencySlug) {
      vendorContext[vendor].agencySlug = agencySlug;
    }
    if (pageType && !vendorContext[vendor].pageType) {
      vendorContext[vendor].pageType = pageType;
    }
    if (page) {
      if (!pageAgg[vendor]) pageAgg[vendor] = {};
      pageAgg[vendor][page] = (pageAgg[vendor][page] || 0) + count;
    }
    if (planObserved) {
      if (!vendorPlanAgg[vendor]) vendorPlanAgg[vendor] = {};
      vendorPlanAgg[vendor][planObserved] =
        (vendorPlanAgg[vendor][planObserved] || 0) + count;
    }
    if (legacyTier) {
      if (tierViews[legacyTier] !== undefined) {
        tierViews[legacyTier] += count;
      }
      if (!vendorLegacyTierSeen[vendor]) vendorLegacyTierSeen[vendor] = new Set();
      vendorLegacyTierSeen[vendor].add(legacyTier);
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

  for (const [vendor, uniques] of Object.entries(uniqueAgg)) {
    const views = viewAgg[vendor] || 0;
    if (uniques > views) {
      uniqueAgg[vendor] = views;
    }
  }

  for (const [date, uniques] of Object.entries(dailyUniqueViews)) {
    const views = dailyViews[date] || 0;
    if (uniques > views) {
      dailyUniqueViews[date] = views;
    }
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
    const context = vendorContext[vendor] || {
      city: "",
      agencySlug: "",
      pageType: ""
    };
    const refs = refAgg[vendor] || { internal: {}, external: {} };
    const metadataEnforced = isMetadataEnforcedForSite(site);
    const vendorMeta = metadataEnforced ? getVendorMeta(vendor) : null;
    const observedPlans = Object.entries(vendorPlanAgg[vendor] || {})
      .sort((a, b) => b[1] - a[1])
      .map(([plan]) => plan);
    const topObservedPlan = observedPlans[0] || "";
    const metadataPlan = metadataEnforced ? getVendorPlan(vendor) : "";
    const plan = metadataEnforced ? metadataPlan : topObservedPlan || "unknown";
    const placementsActive =
      metadataEnforced && vendorMeta ? getActivePlacements(vendor) : [];
    const placementsCounts = Object.entries(placementAgg[vendor] || {})
      .sort((a, b) => b[1] - a[1])
      .map(([placement, count]) => ({ placement, count }));
    let metaStatus = "n/a";
    if (metadataEnforced && vendorMeta) {
      metaStatus = "ok";
      const seen = vendorLegacyTierSeen[vendor];
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
    } else if (metadataEnforced) {
      metaStatus = "missing";
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
      city: context.city,
      agencySlug: context.agencySlug,
      pageType: context.pageType,
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

  const payload: Record<string, unknown> = {
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
  if (dataSource) {
    payload.dataSource = dataSource;
  }
  if (dataWarning) {
    payload.dataWarning = dataWarning;
  }

  const responseHeaders = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": cacheControl || "no-store"
  });
  if (dataSource) {
    responseHeaders.set(DATA_SOURCE_HEADER, dataSource);
  }
  if (dataWarning) {
    responseHeaders.set(DATA_WARNING_HEADER, dataWarning);
  }

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
const STATS_CACHE_TTL_SECONDS = 60;
const EXPORT_CACHE_TTL_SECONDS = 600;

const isAnalyticsCacheEnabled = (env: any) =>
  env.ANALYTICS_CACHE === "1";

const getCacheControlValue = (enabled: boolean, ttlSeconds: number) =>
  enabled ? `private, max-age=${ttlSeconds}` : "no-store";

const DATA_SOURCE_HEADER = "X-Data-Source";
const DATA_WARNING_HEADER = "X-Data-Warning";
const CACHE_STATUS_HEADER = "X-Cache";
const DEFAULT_RATE_LIMIT_PER_MINUTE = 60;
const RATE_LIMIT_PREFIX = {
  VISIT: "visit",
  CLICK: "click"
};
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

const getSafeUrl = (value: unknown): URL | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
};

const getSourceHostFromUrl = (sourceUrl: URL | null) => {
  if (!sourceUrl) return "";
  const hostname = normalizeHostname(sourceUrl.hostname || "");
  if (!hostname || !isSafeHostname(hostname)) return "";
  return hostname;
};

const classifyDeviceClass = (userAgent: string) => {
  const ua = (userAgent || "").toLowerCase();
  if (!ua) return "unknown";
  if (/(bot|spider|crawler|headless|preview)/i.test(ua)) return "bot";
  if (/(ipad|tablet|kindle|silk|playbook|nexus 7|nexus 9|sm-t)/i.test(ua)) {
    return "tablet";
  }
  if (/(android|iphone|ipod|iemobile|blackberry|opera mini|mobile)/i.test(ua)) {
    return "mobile";
  }
  return "desktop";
};

const classifyUserPlatform = (userAgent: string) => {
  const ua = (userAgent || "").toLowerCase();
  if (!ua) return "unknown";
  if (/(iphone|ipad|ipod|ios)/i.test(ua)) return "ios";
  if (/android/i.test(ua)) return "android";
  if (/windows/i.test(ua)) return "windows";
  if (/(mac os|macintosh|darwin)/i.test(ua)) return "macos";
  if (/linux/i.test(ua)) return "linux";
  return "unknown";
};

const MAX_EVENT_CONTEXT_LENGTH = 1500;
const MAX_CUSTOM_CONTEXT_KEYS = 20;

const sanitizeCustomContext = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => /^[a-zA-Z0-9_.-]{1,40}$/.test(key))
    .slice(0, MAX_CUSTOM_CONTEXT_KEYS)
    .map(([key, item]) => {
      if (
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean"
      ) {
        return [key, String(item)];
      }
      return [key, JSON.stringify(item)];
    });

  return Object.fromEntries(entries);
};

const buildEventContext = ({
  sourcePath,
  sourceQuery,
  platform,
  referrerDomain,
  customContext
}: {
  sourcePath: string;
  sourceQuery: string;
  platform: string;
  referrerDomain: string;
  customContext: Record<string, string>;
}) => {
  const context = {
    sourcePath: sourcePath || "",
    sourceQuery: sourceQuery || "",
    platform: platform || "unknown",
    referrerDomain: referrerDomain || "",
    custom: customContext
  };

  const serialized = JSON.stringify(context);
  if (serialized.length <= MAX_EVENT_CONTEXT_LENGTH) return serialized;
  return JSON.stringify({
    ...context,
    custom: {},
    truncated: true
  });
};

const classifyRefChannel = ({
  explicitRefChannel,
  hasReferrer,
  isInternalReferrer
}: {
  explicitRefChannel: string;
  hasReferrer: boolean;
  isInternalReferrer: boolean;
}) => {
  if (explicitRefChannel === "email") return "email";
  if (explicitRefChannel === "internal") return "internal";
  if (explicitRefChannel === "external") return "external";
  if (explicitRefChannel === "direct") return "direct";
  if (explicitRefChannel === "unknown") return "unknown";

  // Default heuristic without forcing channel from URL params.
  // Email should be explicit in payload when intentionally tagged upstream.
  if (explicitRefChannel) {
    return "unknown";
  }
  if (!hasReferrer) return "direct";
  return isInternalReferrer ? "internal" : "external";
};

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

const hmacSha256Hex = async (secret: string, payload: string) => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload)
  );
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
};

const incrementCounter = async (env, key, options) => {
  const current = parseInt((await env.CLICKS.get(key)) || "0", 10);
  await env.CLICKS.put(key, String(current + 1), options);
};

const normalizeBearerToken = (value: string | null) => {
  if (!value) return "";
  const match = /^Bearer\s+(.+)$/i.exec(value);
  if (match) return match[1].trim();
  return value.trim();
};

const getRateLimitPerMinute = (env: any) => {
  const raw = env.RATE_LIMIT_PER_MINUTE;
  if (raw === undefined || raw === null || raw === "") {
    return DEFAULT_RATE_LIMIT_PER_MINUTE;
  }
  const parsed =
    typeof raw === "number" ? raw : parseInt(String(raw), 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_RATE_LIMIT_PER_MINUTE;
  }
  return parsed;
};

const enforceRateLimit = async (
  env: any,
  request: Request,
  prefix: string,
  headers?: Record<string, string>
) => {
  const limit = getRateLimitPerMinute(env);
  if (!limit || limit <= 0) return null;

  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for");
  if (!ip) return null;

  const minute = new Date().toISOString().slice(0, 16);
  const rateKey = `rl:${prefix}:${ip}:${minute}`;
  const current = parseInt((await env.CLICKS.get(rateKey)) || "0", 10);
  if (current >= limit) {
    console.warn("abuse:rate-limit", {
      path: prefix,
      ip,
      minute,
      limit
    });
    return new Response("Rate limit exceeded", {
      status: 429,
      headers
    });
  }
  await env.CLICKS.put(rateKey, String(current + 1), {
    expirationTtl: 60
  });
  return null;
};

const applyAuthToCacheUrl = async (
  cacheUrl: URL,
  authHeader: string | null
) => {
  const token = normalizeBearerToken(authHeader);
  const authHash = token ? await sha1Hex(token) : "anon";
  cacheUrl.searchParams.set("__auth", authHash);
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

const isAllowedClickOrigin = (origin: string | null) =>
  Boolean(origin && VISIT_ALLOWED_ORIGINS.has(origin));

const isAllowedClickReferrer = (referrer: string | null) => {
  if (!referrer) return false;
  try {
    const refUrl = new URL(referrer);
    return isAllowedClickOrigin(refUrl.origin);
  } catch {
    return false;
  }
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
    "Access-Control-Max-Age": "86400",
    "Access-Control-Expose-Headers": [
      DATA_SOURCE_HEADER,
      DATA_WARNING_HEADER,
      CACHE_STATUS_HEADER,
      "Server-Timing"
    ].join(", ")
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
  const safeSiteRaw =
    typeof input?.site === "string" ? input.site.trim() : "";
  const safeSite = safeSiteRaw ? parseSiteSlug(safeSiteRaw) : "";
  const safeVendor =
    typeof input?.vendor === "string" ? input.vendor.trim() : "";
  const safePage =
    typeof input?.page === "string" ? input.page.trim() : "";
  const safeTier =
    typeof input?.tier === "string" ? input.tier.trim() : "";
  const safePlan =
    typeof input?.plan === "string" ? input.plan.trim() : "";
  const safeCity =
    typeof input?.city === "string" ? input.city.trim().toLowerCase() : "";
  const safeAgencySlugRaw =
    typeof input?.agency_slug === "string"
      ? input.agency_slug
      : typeof input?.agencySlug === "string"
        ? input.agencySlug
        : "";
  const safeAgencySlug = safeAgencySlugRaw.trim().toLowerCase();
  const safePageTypeRaw =
    typeof input?.page_type === "string"
      ? input.page_type
      : typeof input?.pageType === "string"
        ? input.pageType
        : "";
  const safePageType = safePageTypeRaw.trim().toLowerCase();
  const normalizedTier = normalizePlanValue(safeTier);
  const normalizedPlan = normalizePlanValue(safePlan);
  const placements =
    Array.isArray(input?.placements) && input.placements.length
      ? input.placements
          .map(item => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean)
      : [];

  if (!safeVendor || !safePage) {
    return { ok: false, error: "Missing parameters" };
  }

  if (
    (safeSiteRaw && !safeSite) ||
    safeVendor.length > 64 ||
    safePage.length > 64 ||
    (safeTier && safeTier.length > 32) ||
    (safePlan && safePlan.length > 32) ||
    (safeCity && safeCity.length > 64) ||
    (safeAgencySlug && safeAgencySlug.length > 64) ||
    (safePageType && safePageType.length > 64)
  ) {
    return { ok: false, error: "Invalid parameters" };
  }

  if (!isSafeSlug(safeVendor) || !isSafeSlug(safePage)) {
    return { ok: false, error: "Invalid parameters" };
  }
  if (safeCity && !isSafeSlug(safeCity)) {
    return { ok: false, error: "Invalid parameters" };
  }
  if (safeAgencySlug && !isSafeSlug(safeAgencySlug)) {
    return { ok: false, error: "Invalid parameters" };
  }
  if (safePageType && !isSafeSlug(safePageType)) {
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
    site: safeSite,
    vendor: safeVendor,
    page: safePage,
    tier: normalizedTier,
    plan: normalizedPlan,
    placements: placements.map(normalizePlanValue),
    city: safeCity,
    agencySlug: safeAgencySlug,
    pageType: safePageType
  };
};

const resolvePlanAndPlacements = (
  validation,
  metadataEnforced: boolean,
  vendorPlanHint?: string
) => {
  let plan = validation.plan;
  const tier = validation.tier;
  let placements = [...(validation.placements || [])];

  if (metadataEnforced) {
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
  } else {
    if (!plan) {
      plan = "unknown";
    }

    if (plan !== "unknown" && !ALLOWED_PLANS.has(plan)) {
      return { ok: false, error: "Invalid plan" };
    }
  }

  placements = Array.from(
    new Set(
      placements.filter(p => ALLOWED_PLACEMENTS.has(p))
    )
  );

  const legacyTier = metadataEnforced ? tier || plan : "";

  return { ok: true, plan, placements, legacyTier };
};

export const buildVisitPayload = ({
  site,
  vendor,
  page,
  tier,
  plan,
  placements,
  city,
  agencySlug,
  pageType
}) => {
  const allowlists = getVisitAllowlists();
  const validation = validateVisitPayload(
    { site, vendor, page, tier, plan, placements, city, agencySlug, pageType },
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
    site: validation.site,
    vendor: validation.vendor,
    page: validation.page,
    tier: validation.tier,
    plan: validation.plan,
    placements: validation.placements,
    city: validation.city,
    agency_slug: validation.agencySlug,
    page_type: validation.pageType,
    referrer,
    url
  };
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const signingSecret =
      typeof env.CLICK_SIGNING_SECRET === "string"
        ? env.CLICK_SIGNING_SECRET
        : "";

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
        const urlValue =
          typeof payload?.url === "string" ? payload.url.trim() : "";

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

        if (urlValue.length > 2048) {
          return new Response("Invalid parameters", {
            status: 400,
            headers: clickCorsHeaders
          });
        }

        const origin = request.headers.get("Origin");
        if (!isAllowedClickOrigin(origin)) {
          console.warn("abuse:click-origin", {
            vendor,
            origin: origin || "missing"
          });
          return new Response("Invalid origin", {
            status: 403,
            headers: clickCorsHeaders
          });
        }

        const referrerHeader =
          request.headers.get("Referer") ||
          request.headers.get("Referrer");
        if (!isAllowedClickReferrer(referrerHeader)) {
          console.warn("abuse:click-referrer", {
            vendor,
            referrer: referrerHeader || "missing"
          });
          return new Response("Invalid referrer", {
            status: 403,
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

        const rateLimitResponse = await enforceRateLimit(
          env,
          request,
          RATE_LIMIT_PREFIX.CLICK,
          clickCorsHeaders
        );
        if (rateLimitResponse) return rateLimitResponse;

        if (!signingSecret) {
          console.warn("click:signing-missing", {
            vendor,
            origin: origin || "missing"
          });
          return new Response("Click signing not configured", {
            status: 503,
            headers: clickCorsHeaders
          });
        }

        const urlToSign = urlValue || referrerHeader || "";
        if (!urlToSign || urlToSign.length > 2048) {
          return new Response("Invalid url", {
            status: 400,
            headers: clickCorsHeaders
          });
        }

        const clickSignature = await hmacSha256Hex(
          signingSecret,
          `${vendor}|${type}|${urlToSign}`
        );

        const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const key = `${vendor}:${type}:${date}`;
        const current = parseInt((await env.CLICKS.get(key)) || "0", 10);
        await env.CLICKS.put(key, String(current + 1));
        writeAnalyticsEvent(env, {
          eventType: ANALYTICS_EVENT_TYPES.CLICK,
          site: analyticsSite,
          vendor,
          clickType: type,
          signature: clickSignature,
          date
        });

        return new Response(null, { status: 204, headers: clickCorsHeaders });
      }

      if (request.method === "GET") {
        const vendor = url.searchParams.get("vendor") || "unknown";
        const ip =
          request.headers.get("cf-connecting-ip") ||
          request.headers.get("x-forwarded-for") ||
          "";
        console.log("legacy_click_blocked", { vendor, ip });
        return new Response(
          JSON.stringify({
            error: "Legacy click tracking disabled. Use POST /click."
          }),
          {
            status: 410,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }

      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "POST, OPTIONS" }
      });
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

      const rateLimitResponse = await enforceRateLimit(
        env,
        request,
        RATE_LIMIT_PREFIX.VISIT,
        corsHeaders
      );
      if (rateLimitResponse) return rateLimitResponse;

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

      const analyticsSite = resolveAnalyticsSite(
        env,
        request,
        validation.site || undefined
      );
      if (!analyticsSite) {
        return new Response("Unknown site", {
          status: 400,
          headers: corsHeaders
        });
      }

      const { vendor, page, city, agencySlug, pageType } = validation;
      const metadataEnforced = isMetadataEnforcedForSite(analyticsSite);
      const vendorMeta = metadataEnforced ? getVendorMeta(vendor) : null;
      const vendorPlanHint =
        metadataEnforced && vendorMeta && getVendorPlan(vendor) !== "unknown"
          ? getVendorPlan(vendor)
          : "";
      const resolvedPlan = resolvePlanAndPlacements(
        validation,
        metadataEnforced,
        vendorPlanHint
      );
      if (!resolvedPlan.ok) {
        return new Response(resolvedPlan.error, {
          status: 400,
          headers: corsHeaders
        });
      }

      let { plan, placements, legacyTier } = resolvedPlan;

      if (metadataEnforced && !vendorMeta) {
        plan = "unknown";
      }

      const placementsActive = getActivePlacements(vendor);
      let metaStatus = "ok";
      if (!metadataEnforced) {
        metaStatus = "n/a";
      } else if (!vendorMeta) {
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

      const sourceUrl = getSafeUrl(payload.url);
      const sourceHost = getSourceHostFromUrl(sourceUrl);
      const sourcePath = sourceUrl?.pathname || "";
      const sourceQuery = sourceUrl?.search ? sourceUrl.search.slice(1) : "";
      const ip =
        request.headers.get("cf-connecting-ip") ||
        request.headers.get("x-forwarded-for") ||
        "";
      const userAgent = request.headers.get("user-agent") || "";
      const deviceClass = classifyDeviceClass(userAgent);
      const platform = classifyUserPlatform(userAgent);

      const hasPayloadReferrer =
        payload &&
        Object.prototype.hasOwnProperty.call(payload, "referrer");
      const referrerValue =
        hasPayloadReferrer && typeof payload.referrer === "string"
          ? payload.referrer
          : "";
      const headerReferrer = request.headers.get("referer") || "";
      const referrer = hasPayloadReferrer ? referrerValue : headerReferrer;
      let refScope: "int" | "ext" | "" = "";
      let refBucket = "";
      let refChannel = "direct";
      let referrerDomain = "";
      const explicitRefChannel =
        typeof payload.ref_channel === "string"
          ? payload.ref_channel.trim().toLowerCase()
          : typeof payload.refChannel === "string"
            ? payload.refChannel.trim().toLowerCase()
            : "";
      const customContext = sanitizeCustomContext(
        payload.custom_context ??
          payload.customContext ??
          payload.context ??
          payload.custom
      );
      const legacyTierForAnalytics =
        validation.tier && validation.tier !== plan ? validation.tier : "";

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
            referrerDomain = hostname;
            const isInternal = Array.from(INTERNAL_REFERRER_DOMAINS).some(
              domain => hostname === domain || hostname.endsWith(`.${domain}`)
            );
            if (isInternal) {
              refScope = "int";
              refBucket = classifyInternalReferrer(refUrl.pathname);
            } else {
              refScope = "ext";
              refBucket = hostname;
            }
          }
        }
      }

      refChannel = classifyRefChannel({
        explicitRefChannel,
        hasReferrer: Boolean(refScope),
        isInternalReferrer: refScope === "int"
      });
      const eventContext = buildEventContext({
        sourcePath,
        sourceQuery,
        platform,
        referrerDomain,
        customContext
      });

      writeAnalyticsEvent(env, {
        eventType: ANALYTICS_EVENT_TYPES.VIEW,
        site: analyticsSite,
        vendor,
        page,
        plan,
        legacyTier: legacyTierForAnalytics,
        city,
        agencySlug,
        pageType,
        sourceHost,
        deviceClass,
        refChannel,
        eventContext,
        date
      });

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
          legacyTier: legacyTierForAnalytics,
          city,
          agencySlug,
          pageType,
          sourceHost,
          deviceClass,
          refChannel,
          eventContext,
          date
        });
      }

      await incrementCounter(env, `view:${vendor}:${date}`);
      await incrementCounter(env, `pview:${vendor}:${page}:${date}`);
      if (legacyTier) {
        await incrementCounter(env, `tview:${legacyTier}:${date}`);
        await incrementCounter(env, `tview:${vendor}:${legacyTier}:${date}`);
      }
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
          legacyTier: legacyTierForAnalytics,
          city,
          agencySlug,
          pageType,
          sourceHost,
          deviceClass,
          refChannel,
          eventContext,
          date
        });
      }

      if (refScope && refBucket) {
        await incrementCounter(env, `ref:${vendor}:${refScope}:${refBucket}:${date}`);
        writeAnalyticsEvent(env, {
          eventType: ANALYTICS_EVENT_TYPES.REFERRER,
          site: analyticsSite,
          vendor,
          page,
          plan,
          legacyTier: legacyTierForAnalytics,
          city,
          agencySlug,
          pageType,
          sourceHost,
          deviceClass,
          refChannel,
          eventContext,
          refScope,
          refBucket,
          date
        });
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

      const cacheEnabled = isAnalyticsCacheEnabled(env);
      const cacheControl = getCacheControlValue(
        cacheEnabled,
        STATS_CACHE_TTL_SECONDS
      );
      let cacheKey: Request | null = null;
      if (cacheEnabled) {
        const cacheUrl = new URL(request.url);
        cacheUrl.searchParams.set("site", site);
        cacheUrl.searchParams.set("range", range);
        await applyAuthToCacheUrl(cacheUrl, auth);
        cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
        const cached = await caches.default.match(cacheKey);
        if (cached) {
          const cachedResponse = new Response(cached.body, cached);
          cachedResponse.headers.set(CACHE_STATUS_HEADER, "HIT");
          return cachedResponse;
        }
      }

      let dataWarning: string | undefined;
      let response: Response | null = null;
      if (analyticsEngineConfigured(env)) {
        try {
          console.log("stats:ae", { cached: false, range, site });
          response = await buildStatsResponseFromAnalyticsEngine({
            env,
            site,
            range,
            dates,
            statsTimingEnabled,
            statsRay,
            cacheControl,
            dataSource: "ae"
          });
        } catch (error) {
          dataWarning = "ae_failed";
          console.error("stats:analytics-engine-failed", error);
        }
      }

      if (response) {
        if (cacheEnabled) {
          response.headers.set(CACHE_STATUS_HEADER, "MISS");
          if (cacheKey && response.status === 200 && !dataWarning) {
            await caches.default.put(cacheKey, response.clone());
          }
        }
        return response;
      }

      console.log("stats:kv", {
        cached: false,
        range,
        site,
        fallback: dataWarning ? "ae_failed" : undefined
      });

      const vendorAgg = {};
      const viewAgg = {};
      const uniqueAgg = {};
      const pageAgg = {};
      const vendorPlanAgg = {};
      const refAgg = {};
      const vendorLegacyTierSeen = {};
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
            if (!vendorLegacyTierSeen[vendor]) vendorLegacyTierSeen[vendor] = new Set();
            vendorLegacyTierSeen[vendor].add(tier);
            continue;
          }

          if (parts[0] === "planview" && parts.length === 3) {
            const [, plan, date] = parts;
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

            if (tierViews[plan] !== undefined) {
              tierViews[plan] += value;
            }
            continue;
          }

          if (parts[0] === "planview" && parts.length === 4) {
            const [, vendor, plan, date] = parts;
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

            if (!vendorPlanAgg[vendor]) vendorPlanAgg[vendor] = {};
            vendorPlanAgg[vendor][plan] =
              (vendorPlanAgg[vendor][plan] || 0) + value;
            continue;
          }

          if (parts[0] === "tview") {
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

      for (const [vendor, uniques] of Object.entries(uniqueAgg)) {
        const views = viewAgg[vendor] || 0;
        if (uniques > views) {
          uniqueAgg[vendor] = views;
        }
      }

      for (const [date, uniques] of Object.entries(dailyUniqueViews)) {
        const views = dailyViews[date] || 0;
        if (uniques > views) {
          dailyUniqueViews[date] = views;
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
        const metadataEnforced = isMetadataEnforcedForSite(site);
        const vendorMeta = metadataEnforced ? getVendorMeta(vendor) : null;
        const observedPlans = Object.entries(vendorPlanAgg[vendor] || {})
          .sort((a, b) => b[1] - a[1])
          .map(([plan]) => plan);
        const topObservedPlan = observedPlans[0] || "";
        const metadataPlan = metadataEnforced ? getVendorPlan(vendor) : "";
        const plan = metadataEnforced ? metadataPlan : topObservedPlan || "unknown";
        const placementsActive =
          metadataEnforced && vendorMeta ? getActivePlacements(vendor) : [];
        const placementsCounts = Object.entries(placementAgg[vendor] || {})
          .sort((a, b) => b[1] - a[1])
          .map(([placement, count]) => ({ placement, count }));
        let metaStatus = "n/a";
        if (metadataEnforced && vendorMeta) {
          metaStatus = "ok";
          const seen = vendorLegacyTierSeen[vendor];
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
        } else if (metadataEnforced) {
          metaStatus = "missing";
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
          city: "",
          agencySlug: "",
          pageType: "",
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

      const payload: Record<string, unknown> = {
        site,
        range,
        contractVersion: CONTRACT_VERSION,
        generatedAt: new Date().toISOString(),
        vendors,
        daily,
        dailyViews: dailyViewTotals,
        dailyUniqueViews: dailyUniqueViewTotals,
        tierViews,
        dataSource: "kv"
      };
      if (dataWarning) {
        payload.dataWarning = dataWarning;
      }
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
        "Cache-Control": cacheControl
      });
      responseHeaders.set(DATA_SOURCE_HEADER, "kv");
      if (dataWarning) {
        responseHeaders.set(DATA_WARNING_HEADER, dataWarning);
      }
      if (statsTimingHeader) {
        responseHeaders.set("Server-Timing", statsTimingHeader);
      }
      const kvResponse = new Response(body, {
        status: 200,
        headers: responseHeaders
      });
      if (cacheEnabled) {
        kvResponse.headers.set(CACHE_STATUS_HEADER, "MISS");
        if (cacheKey && kvResponse.status === 200 && !dataWarning) {
          await caches.default.put(cacheKey, kvResponse.clone());
        }
      }
      return kvResponse;
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

      const cacheEnabled = isAnalyticsCacheEnabled(env);
      const cacheControl = getCacheControlValue(
        cacheEnabled,
        EXPORT_CACHE_TTL_SECONDS
      );
      let cacheKey: Request | null = null;
      if (cacheEnabled) {
        const cacheUrl = new URL(request.url);
        cacheUrl.searchParams.set("site", analyticsSite);
        cacheUrl.searchParams.set("vendor", vendor);
        cacheUrl.searchParams.set("range", range);
        await applyAuthToCacheUrl(cacheUrl, auth);
        cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
        const cached = await caches.default.match(cacheKey);
        if (cached) {
          const cachedResponse = new Response(cached.body, cached);
          cachedResponse.headers.set(CACHE_STATUS_HEADER, "HIT");
          return cachedResponse;
        }
      }

      let dataWarning: string | undefined;
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

          const responseHeaders = new Headers({
            "Content-Type": "text/csv; charset=utf-8",
            "Cache-Control": cacheControl,
            ...corsHeaders
          });
          responseHeaders.set(DATA_SOURCE_HEADER, "ae");

          const aeResponse = new Response(csv, { headers: responseHeaders });
          if (cacheEnabled) {
            aeResponse.headers.set(CACHE_STATUS_HEADER, "MISS");
            if (cacheKey && aeResponse.status === 200 && !dataWarning) {
              await caches.default.put(cacheKey, aeResponse.clone());
            }
          }
          return aeResponse;
        } catch (error) {
          dataWarning = "ae_failed";
          console.error("vendor-export:analytics-engine-failed", error);
        }
      }
      console.log("export:kv", {
        cached: false,
        range,
        site: analyticsSite,
        vendor,
        fallback: dataWarning ? "ae_failed" : undefined
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

      const responseHeaders = new Headers({
        "Content-Type": "text/csv; charset=utf-8",
        "Cache-Control": cacheControl,
        ...corsHeaders
      });
      responseHeaders.set(DATA_SOURCE_HEADER, "kv");
      if (dataWarning) {
        responseHeaders.set(DATA_WARNING_HEADER, dataWarning);
      }

      const kvResponse = new Response(csv, { headers: responseHeaders });
      if (cacheEnabled) {
        kvResponse.headers.set(CACHE_STATUS_HEADER, "MISS");
        if (cacheKey && kvResponse.status === 200 && !dataWarning) {
          await caches.default.put(cacheKey, kvResponse.clone());
        }
      }
      return kvResponse;
    }

    /* ----------------------------
       ANALYTICS ENGINE HEALTH (AUTHENTICATED)
       ---------------------------- */
    if (url.pathname === "/api/health/analytics-engine") {
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

      const auth = request.headers.get("Authorization");
      if (auth !== `Bearer ${env.ANALYTICS_API_TOKEN}`) {
        return new Response("Unauthorized", {
          status: 401,
          headers: corsHeaders
        });
      }

      const started = performance.now();
      const checkedAt = new Date().toISOString();

      if (!analyticsEngineConfigured(env)) {
        return new Response(
          JSON.stringify({
            status: "degraded",
            latencyMs: 0,
            lastError: "unconfigured",
            checkedAt
          }),
          {
            status: 503,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
              ...corsHeaders
            }
          }
        );
      }

      const datasetIdent = getAnalyticsDatasetIdentifier(env);
      try {
        await analyticsEngineQuery(
          env,
          `SELECT 1 FROM ${datasetIdent} LIMIT 1 FORMAT JSON`
        );
        const latencyMs = Math.round(performance.now() - started);
        console.log("health:ae", {
          status: "ok",
          latencyMs
        });

        return new Response(
          JSON.stringify({
            status: "ok",
            latencyMs,
            checkedAt
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
              ...corsHeaders
            }
          }
        );
      } catch (error) {
        const latencyMs = Math.round(performance.now() - started);
        const lastError = String(error?.message || error);
        console.error("health:ae-failed", error);
        return new Response(
          JSON.stringify({
            status: "degraded",
            latencyMs,
            lastError,
            checkedAt
          }),
          {
            status: 503,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
              ...corsHeaders
            }
          }
        );
      }
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
