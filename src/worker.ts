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

        const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const key = `${vendor}:${type}:${date}`;
        const current = parseInt((await env.CLICKS.get(key)) || "0", 10);
        await env.CLICKS.put(key, String(current + 1));

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

      // Daily KV key
      const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const key = `${vendor}:${type}:${date}`;

      const current = parseInt((await env.CLICKS.get(key)) || "0", 10);
      await env.CLICKS.put(key, String(current + 1));

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
            } else {
              await incrementCounter(
                env,
                `ref:${vendor}:ext:${hostname}:${date}`
              );
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

      const site = url.searchParams.get("site");
      const range = url.searchParams.get("range") || "28d";

      if (!site) {
        return new Response("Missing site", { status: 400 });
      }

      const rangeDays = getRangeDays(range);
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

      const vendorAgg = {};
      const viewAgg = {};
      const uniqueAgg = {};
      const pageAgg = {};
      const refAgg = {};
      const vendorTierSeen = {};
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
        const list = await env.CLICKS.list({ cursor });

        for (const key of list.keys) {
          const parts = key.name.split(":");
          if (parts[0] === "rollup") continue;
          if (parts[0] === "rl" || parts[0] === "uviewlock") continue;
          if (parts[0] === "raw") continue;

          if (parts[0] === "tview" && parts.length === 3) {
            const [, tier, date] = parts;
            if (!(date in dailyViews)) continue;

            const value = parseInt(await env.CLICKS.get(key.name)) || 0;
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
            parts[0] === "plcview" ||
            parts[0] === "tview"
          ) {
            continue;
          }

          if (parts[0] === "pview" && parts.length === 3) {
            continue;
          }

          if (parts[0] === "view" && parts.length === 3) {
            const [, vendor, date] = parts;
            if (!(date in dailyViews)) continue;

            const value = parseInt(await env.CLICKS.get(key.name)) || 0;
            if (!value) continue;

            viewAgg[vendor] = (viewAgg[vendor] || 0) + value;
            dailyViews[date] += value;
            continue;
          }

          if (parts[0] === "uview" && parts.length === 3) {
            const [, vendor, date] = parts;
            if (!(date in dailyUniqueViews)) continue;

            const value = parseInt(await env.CLICKS.get(key.name)) || 0;
            if (!value) continue;

            uniqueAgg[vendor] = (uniqueAgg[vendor] || 0) + value;
            dailyUniqueViews[date] += value;
            continue;
          }

          if (parts[0] === "pview" && parts.length === 4) {
            const [, vendor, page, date] = parts;
            if (!(date in dailyViews)) continue;

            const value = parseInt(await env.CLICKS.get(key.name)) || 0;
            if (!value) continue;

            if (!pageAgg[vendor]) pageAgg[vendor] = {};
            pageAgg[vendor][page] =
              (pageAgg[vendor][page] || 0) + value;
            continue;
          }

          if (parts[0] === "ref" && parts.length === 5) {
            const [, vendor, scope, bucket, date] = parts;
            if (!(date in dailyViews)) continue;

            const value = parseInt(await env.CLICKS.get(key.name)) || 0;
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

          const value = parseInt(await env.CLICKS.get(key.name)) || 0;
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
        ...Object.keys(refAgg)
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

      return new Response(
        JSON.stringify({
          site,
          range,
          contractVersion: CONTRACT_VERSION,
          generatedAt: new Date().toISOString(),
          vendors,
          daily,
          dailyViews: dailyViewTotals,
          dailyUniqueViews: dailyUniqueViewTotals,
          tierViews
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
          }
        }
      );
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

      if (!vendor) {
        return new Response("Missing vendor", { status: 400, headers: corsHeaders });
      }

      if (vendor.length > 64 || !isSafeSlug(vendor)) {
        return new Response("Invalid vendor", { status: 400, headers: corsHeaders });
      }

      const rangeDays = getRangeDays(range);
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
