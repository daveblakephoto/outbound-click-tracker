/**
 * Schema Service - Contract-First API Configuration
 * 
 * Fetches and caches the analytics contract from GET /schema.
 * This is the single source of truth for:
 * - Valid date ranges (defaultRanges)
 * - Valid plans (allowedPlans)
 * - Valid placements (allowedPlacements)
 * - Valid click types
 * - API version
 * - CORS configuration
 */

// Required fields for a valid schema response
const REQUIRED_SCHEMA_FIELDS = [
  'apiVersion',
] as const;

// Optional but recommended fields
const RECOMMENDED_SCHEMA_FIELDS = [
  'allowedPlans',
  'allowedPlacements',
  'defaultRanges',
  'cors',
] as const;

export interface AnalyticsSchema {
  // Core version info
  version: string;
  apiVersion: string;
  contractVersion: string;
  
  // Allowlists from contract (canonical names)
  allowedPlans: string[];
  allowedPlacements: string[];
  defaultRanges: string[];
  allowedClickTypes: string[];
  
  // Legacy aliases for backwards compatibility
  ranges: string[];
  pages: string[];
  plans: string[];
  placements: string[];
  clickTypes: string[];
  
  // Validation rules
  minSampleSizes: {
    ctr: number;
    clicksPerVisitor: number;
  };
  
  // CORS and metadata
  cors?: {
    origins?: string[];
  };
  corsOrigins?: string[];
}

export interface VendorMetadata {
  vendor: string;
  plan: string;
  placementsActive: string[];
  metaStatus: 'ok' | 'missing' | 'mismatch';
}

export interface SchemaValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  missingRequired: string[];
  missingRecommended: string[];
}

export interface SchemaCacheInfo {
  isCached: boolean;
  fetchedAt: Date | null;
  expiresAt: Date | null;
  ttlRemaining: number | null;
  isStale: boolean;
  lastSuccessfulFetch: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  fetchCount: number;
  version: string | null;
  apiVersion: string | null;
}

interface SchemaCache {
  schema: AnalyticsSchema;
  fetchedAt: number;
  expiresAt: number;
}

// Cache TTL: 1 hour (3600 seconds) as per requirements
const SCHEMA_CACHE_TTL_MS = 3600 * 1000;

// Module-level state
let schemaCache: SchemaCache | null = null;
let lastSuccessfulFetch: Date | null = null;
let lastError: string | null = null;
let lastErrorAt: Date | null = null;
let fetchCount = 0;
let isFetching = false;
let fetchPromise: Promise<AnalyticsSchema> | null = null;

// Event listeners for schema refresh
type SchemaRefreshListener = (schema: AnalyticsSchema, reason: string) => void;
const refreshListeners: Set<SchemaRefreshListener> = new Set();

/**
 * Default schema fallback when /schema is unavailable
 * Used for graceful degradation
 */
const DEFAULT_SCHEMA: AnalyticsSchema = {
  version: 'unknown',
  apiVersion: 'unknown',
  contractVersion: 'unknown',
  
  // Canonical names
  allowedPlans: ['unpaid', 'basic', 'featured', 'unknown'],
  allowedPlacements: [],
  defaultRanges: ['7d', '28d', '90d'],
  allowedClickTypes: ['website', 'instagram'],
  
  // Legacy aliases
  ranges: ['7d', '28d', '90d'],
  pages: [],
  plans: ['unpaid', 'basic', 'featured', 'unknown'],
  placements: [],
  clickTypes: ['website', 'instagram'],
  
  minSampleSizes: {
    ctr: 25,
    clicksPerVisitor: 10,
  },
};

/**
 * Validate schema response against required fields
 */
export function validateSchemaResponse(data: Record<string, unknown>): SchemaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const missingRequired: string[] = [];
  const missingRecommended: string[] = [];
  
  // Check required fields
  for (const field of REQUIRED_SCHEMA_FIELDS) {
    if (data[field] === undefined || data[field] === null) {
      missingRequired.push(field);
      errors.push(`Missing required field: ${field}`);
    }
  }
  
  // Check recommended fields
  for (const field of RECOMMENDED_SCHEMA_FIELDS) {
    if (data[field] === undefined || data[field] === null) {
      missingRecommended.push(field);
      warnings.push(`Missing recommended field: ${field}`);
    }
  }
  
  // Validate array fields if present
  const arrayFields = ['allowedPlans', 'allowedPlacements', 'defaultRanges', 'ranges', 'plans', 'placements'];
  for (const field of arrayFields) {
    if (data[field] !== undefined && !Array.isArray(data[field])) {
      errors.push(`Field ${field} should be an array`);
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    missingRequired,
    missingRecommended,
  };
}

/**
 * Parse raw schema response into AnalyticsSchema
 */
function parseSchemaResponse(data: Record<string, unknown>): AnalyticsSchema {
  const minSampleSizesData = data.minSampleSizes as Record<string, unknown> | undefined;
  const corsData = data.cors as Record<string, unknown> | undefined;
  
  // Support both new canonical names and legacy names
  const allowedPlans = Array.isArray(data.allowedPlans) ? data.allowedPlans :
                       Array.isArray(data.plans) ? data.plans : DEFAULT_SCHEMA.allowedPlans;
  const allowedPlacements = Array.isArray(data.allowedPlacements) ? data.allowedPlacements :
                            Array.isArray(data.placements) ? data.placements : [];
  const defaultRanges = Array.isArray(data.defaultRanges) ? data.defaultRanges :
                        Array.isArray(data.ranges) ? data.ranges : DEFAULT_SCHEMA.defaultRanges;
  const allowedClickTypes = Array.isArray(data.allowedClickTypes) ? data.allowedClickTypes :
                            Array.isArray(data.clickTypes) ? data.clickTypes : DEFAULT_SCHEMA.allowedClickTypes;
  
  return {
    version: String(data.version || 'unknown'),
    apiVersion: String(data.apiVersion || data.version || 'unknown'),
    contractVersion: String(data.contractVersion || data.apiVersion || data.version || 'unknown'),
    
    // Canonical names
    allowedPlans,
    allowedPlacements,
    defaultRanges,
    allowedClickTypes,
    
    // Legacy aliases (for backwards compatibility)
    ranges: defaultRanges,
    pages: Array.isArray(data.pages) ? data.pages : [],
    plans: allowedPlans,
    placements: allowedPlacements,
    clickTypes: allowedClickTypes,
    
    minSampleSizes: {
      ctr: Number(minSampleSizesData?.ctr) || 25,
      clicksPerVisitor: Number(minSampleSizesData?.clicksPerVisitor) || 10,
    },
    cors: corsData ? {
      origins: Array.isArray(corsData.origins) ? corsData.origins : undefined,
    } : undefined,
    corsOrigins: Array.isArray(data.corsOrigins) ? data.corsOrigins : undefined,
  };
}

/**
 * Subscribe to schema refresh events
 */
export function onSchemaRefresh(listener: SchemaRefreshListener): () => void {
  refreshListeners.add(listener);
  return () => refreshListeners.delete(listener);
}

/**
 * Notify all listeners of schema refresh
 */
function notifyRefreshListeners(schema: AnalyticsSchema, reason: string) {
  console.log(`[Schema] Refresh triggered: ${reason}`);
  refreshListeners.forEach(listener => {
    try {
      listener(schema, reason);
    } catch (err) {
      console.error('[Schema] Listener error:', err);
    }
  });
}

/**
 * Check if schema needs refresh based on API contract version
 */
export function needsRefreshForVersion(apiContractVersion: string): boolean {
  if (!schemaCache) return true;
  
  const currentVersion = schemaCache.schema.apiVersion;
  if (currentVersion === 'unknown') return false; // Can't compare
  if (apiContractVersion === 'unknown') return false;
  
  return currentVersion !== apiContractVersion;
}

/**
 * Check if schema cache is expired
 */
export function isCacheExpired(): boolean {
  if (!schemaCache) return true;
  return Date.now() >= schemaCache.expiresAt;
}

/**
 * Fetch schema from the contract endpoint
 * Prevents duplicate concurrent fetches
 */
export async function fetchSchema(forceRefresh = false): Promise<AnalyticsSchema> {
  const now = Date.now();
  
  // Return cached schema if valid and not forcing refresh
  if (!forceRefresh && schemaCache && now < schemaCache.expiresAt) {
    return schemaCache.schema;
  }
  
  // Prevent duplicate concurrent fetches
  if (isFetching && fetchPromise) {
    return fetchPromise;
  }
  
  isFetching = true;
  fetchCount++;
  
  fetchPromise = (async () => {
    try {
      const response = await fetch('/api/schema');
      
      if (!response.ok) {
        const errorMsg = `Schema fetch failed: ${response.status}`;
        console.warn(errorMsg);
        lastError = errorMsg;
        lastErrorAt = new Date();
        
        // Return cached schema if available, otherwise default
        if (schemaCache) {
          console.warn('Using stale cached schema');
          return schemaCache.schema;
        }
        console.warn('Using default fallback schema');
        return DEFAULT_SCHEMA;
      }
      
      const data = await response.json() as Record<string, unknown>;
      
      // Validate schema response
      const validation = validateSchemaResponse(data);
      if (!validation.isValid) {
        console.error('[Schema] Validation errors:', validation.errors);
        lastError = `Validation failed: ${validation.errors.join(', ')}`;
        lastErrorAt = new Date();
        
        // Still parse what we can and fall back to defaults for missing fields
        if (schemaCache) {
          console.warn('Using stale cached schema due to validation errors');
          return schemaCache.schema;
        }
      }
      
      if (validation.warnings.length > 0) {
        console.warn('[Schema] Validation warnings:', validation.warnings);
      }
      
      // Parse schema
      const schema = parseSchemaResponse(data);
      
      // Check if this is a version change
      const previousVersion = schemaCache?.schema.apiVersion;
      const isVersionChange = previousVersion && previousVersion !== schema.apiVersion;
      
      // Update cache
      schemaCache = {
        schema,
        fetchedAt: now,
        expiresAt: now + SCHEMA_CACHE_TTL_MS,
      };
      
      lastSuccessfulFetch = new Date();
      lastError = null;
      lastErrorAt = null;
      
      console.log('[Schema] Fetched and cached:', {
        version: schema.version,
        apiVersion: schema.apiVersion,
        contractVersion: schema.contractVersion,
        ranges: schema.defaultRanges,
        plans: schema.allowedPlans,
        cacheExpiresIn: SCHEMA_CACHE_TTL_MS / 1000 + 's',
      });
      
      // Notify listeners if this was a forced refresh or version change
      if (forceRefresh || isVersionChange) {
        const reason = isVersionChange 
          ? `version_change:${previousVersion}->${schema.apiVersion}`
          : 'forced_refresh';
        notifyRefreshListeners(schema, reason);
      }
      
      return schema;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Schema] Fetch error:', error);
      lastError = errorMsg;
      lastErrorAt = new Date();
      
      // Return cached schema if available, otherwise default
      if (schemaCache) {
        console.warn('Using stale cached schema due to error');
        return schemaCache.schema;
      }
      
      console.warn('Using default fallback schema due to error');
      return DEFAULT_SCHEMA;
    } finally {
      isFetching = false;
      fetchPromise = null;
    }
  })();
  
  return fetchPromise;
}

/**
 * Trigger schema refresh due to contract version mismatch
 */
export async function refreshForContractMismatch(apiContractVersion: string): Promise<AnalyticsSchema> {
  console.log(`[Schema] Contract version mismatch detected. API: ${apiContractVersion}, Cached: ${schemaCache?.schema.apiVersion}`);
  return fetchSchema(true);
}

/**
 * Get current cached schema without fetching
 */
export function getCachedSchema(): AnalyticsSchema | null {
  if (schemaCache && Date.now() < schemaCache.expiresAt) {
    return schemaCache.schema;
  }
  return null;
}

/**
 * Get the default fallback schema
 */
export function getDefaultSchema(): AnalyticsSchema {
  return { ...DEFAULT_SCHEMA };
}

/**
 * Get schema cache metadata for diagnostics
 */
export function getSchemaCacheInfo(): SchemaCacheInfo {
  const cachedVersion = schemaCache?.schema.version || null;
  const cachedApiVersion = schemaCache?.schema.apiVersion || null;
  
  if (!schemaCache) {
    return {
      isCached: false,
      fetchedAt: null,
      expiresAt: null,
      ttlRemaining: null,
      isStale: false,
      lastSuccessfulFetch,
      lastError,
      lastErrorAt,
      fetchCount,
      version: cachedVersion,
      apiVersion: cachedApiVersion,
    };
  }
  
  const now = Date.now();
  const isStale = now >= schemaCache.expiresAt;
  
  return {
    isCached: true,
    fetchedAt: new Date(schemaCache.fetchedAt),
    expiresAt: new Date(schemaCache.expiresAt),
    ttlRemaining: isStale ? 0 : Math.floor((schemaCache.expiresAt - now) / 1000),
    isStale,
    lastSuccessfulFetch,
    lastError,
    lastErrorAt,
    fetchCount,
    version: cachedVersion,
    apiVersion: cachedApiVersion,
  };
}

/**
 * Validate a value against schema allowlist
 */
export function isValidRange(range: string, schema: AnalyticsSchema): boolean {
  return schema.defaultRanges.includes(range) || schema.ranges.includes(range);
}

export function isValidPlan(plan: string, schema: AnalyticsSchema): boolean {
  return schema.allowedPlans.includes(plan) || schema.plans.includes(plan);
}

export function isValidPlacement(placement: string, schema: AnalyticsSchema): boolean {
  const placements = schema.allowedPlacements.length > 0 ? schema.allowedPlacements : schema.placements;
  return placements.length === 0 || placements.includes(placement);
}

export function isValidClickType(clickType: string, schema: AnalyticsSchema): boolean {
  return schema.allowedClickTypes.includes(clickType) || schema.clickTypes.includes(clickType);
}

/**
 * Map UI date range label to API range code
 * Uses schema allowlist to validate
 */
export function dateRangeToApiCode(
  label: string,
  schema: AnalyticsSchema
): string {
  const mapping: Record<string, string> = {
    'Last 7 days': '7d',
    'Last 28 days': '28d',
    'Last 3 months': '90d',
  };
  
  const code = mapping[label] || '7d';
  const validRanges = schema.defaultRanges.length > 0 ? schema.defaultRanges : schema.ranges;
  
  // Validate against schema
  if (!validRanges.includes(code)) {
    console.warn(`Range "${code}" not in schema allowlist:`, validRanges);
    return validRanges[0] || '7d';
  }
  
  return code;
}

/**
 * Get human-readable label for API range code
 */
export function apiCodeToDateRangeLabel(code: string): string {
  const mapping: Record<string, string> = {
    '7d': 'Last 7 days',
    '28d': 'Last 28 days',
    '90d': 'Last 3 months',
  };
  return mapping[code] || code;
}

/**
 * Generate date range options from schema
 */
export function getDateRangeOptions(schema: AnalyticsSchema): Array<{
  label: string;
  value: string;
}> {
  const ranges = schema.defaultRanges.length > 0 ? schema.defaultRanges : schema.ranges;
  return ranges.map(code => ({
    label: apiCodeToDateRangeLabel(code),
    value: code,
  }));
}

/**
 * Get plan display configuration
 * Dynamically handles unknown plans with graceful fallback
 */
export function getPlanDisplayConfig(plan: string, schema?: AnalyticsSchema): {
  label: string;
  color: string;
  bgColor: string;
  isKnown: boolean;
} {
  // Known plan configurations
  const configs: Record<string, { label: string; color: string; bgColor: string }> = {
    featured: { label: 'Featured', color: 'text-amber-700', bgColor: 'bg-amber-100' },
    basic: { label: 'Basic', color: 'text-blue-700', bgColor: 'bg-blue-100' },
    unpaid: { label: 'Unpaid', color: 'text-neutral-600', bgColor: 'bg-neutral-100' },
    unknown: { label: 'Unknown', color: 'text-neutral-500', bgColor: 'bg-neutral-50' },
  };
  
  const knownConfig = configs[plan];
  if (knownConfig) {
    return { ...knownConfig, isKnown: true };
  }
  
  // Check if plan is in schema but not in our config (new plan added to contract)
  const isInSchema = schema 
    ? (schema.allowedPlans.includes(plan) || schema.plans.includes(plan))
    : false;
  
  // Generate config for unknown plans
  return {
    label: plan.charAt(0).toUpperCase() + plan.slice(1).replace(/_/g, ' '),
    color: 'text-purple-700',
    bgColor: 'bg-purple-100',
    isKnown: isInSchema,
  };
}

/**
 * Get placement display configuration
 * Dynamically handles unknown placements
 */
export function getPlacementDisplayConfig(placement: string, schema?: AnalyticsSchema): {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  isKnown: boolean;
} {
  // Known placement configurations
  const configs: Record<string, { label: string; color: string; bgColor: string; borderColor: string }> = {
    spotlight: { label: 'Spotlight', color: 'text-green-700', bgColor: 'bg-green-50', borderColor: 'border-green-200' },
    home_feature: { label: 'Home', color: 'text-green-700', bgColor: 'bg-green-50', borderColor: 'border-green-200' },
    search_boost: { label: 'Search', color: 'text-green-700', bgColor: 'bg-green-50', borderColor: 'border-green-200' },
    category_feature: { label: 'Category', color: 'text-green-700', bgColor: 'bg-green-50', borderColor: 'border-green-200' },
  };
  
  const knownConfig = configs[placement];
  if (knownConfig) {
    return { ...knownConfig, isKnown: true };
  }
  
  // Check if placement is in schema but not in our config
  const isInSchema = schema
    ? (schema.allowedPlacements.includes(placement) || schema.placements.includes(placement))
    : false;
  
  // Generate config for unknown placements
  return {
    label: placement.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    color: 'text-teal-700',
    bgColor: 'bg-teal-50',
    borderColor: 'border-teal-200',
    isKnown: isInSchema,
  };
}

/**
 * Clear schema cache (for testing or forced refresh)
 */
export function clearSchemaCache(): void {
  schemaCache = null;
  lastSuccessfulFetch = null;
  lastError = null;
  lastErrorAt = null;
  fetchCount = 0;
}
