import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchVendorCSV, type ParsedVendorCSV } from '../utils/csvParser';
import { useSchema, useDateRangeOptions, useContractVersionCheck, useMinSampleSizes } from '../contexts/SchemaContext';
import { getSchemaCacheInfo } from '../services/schemaService';
import EngagementQualityPanel from '../components/EngagementQualityPanel';
import TrafficSourcesPanel from '../components/TrafficSourcesPanel';
import VendorMetadataBadges from '../components/VendorMetadataBadges';
import SchemaDebugPanel, { useSchemaDebugMode } from '../components/SchemaDebugPanel';
import KpiRow from '../components/KpiRow';
import EngagementFunnel from '../components/EngagementFunnel';
import { featureFlags } from '../config/features';
import { detectOpportunity, type VendorMetrics } from '../utils/derivedMetrics';
import { diagnosticFetch, formatDiagnostics, downloadDiagnostics, type RequestDiagnostics } from '../utils/performanceDiagnostics';

// Data flow:
// 1. Site-wide overview: Fetch /api/stats only (no vendor selected)
// 2. Vendor detail: Fetch /api/export/vendor.csv only (vendor selected)
// 3. Never mix data sources
// 4. Schema from /schema defines valid ranges, plans, placements

interface VendorData {
  name: string;
  websiteClicks: number;
  instagramClicks: number;
  totalClicks: number;
  views: number | null;
  uniqueViews: number | null;
  ctr: number | null;
  // Metadata from contract
  plan?: string;
  placementsActive?: string[];
  metaStatus?: 'ok' | 'missing' | 'mismatch';
}

interface FetchDiagnostics {
  endpoint: string;
  status: number;
  latency: number;
  cache: 'hit' | 'miss';
  timestamp: Date;
  source: 'stats' | 'csv' | 'fallback';
  availableSeries: string[];
  // Contract info
  contractVersion?: string;
  schemaVersion?: string;
  schemaCacheTTL?: number;
  metaStatus?: 'ok' | 'missing' | 'mismatch';
  // AE/KV storage backend info
  storageBackend?: 'ae' | 'kv';
  storageWarning?: string;
  serverCache?: 'HIT' | 'MISS';
  // Legacy tier fallback detection
  legacyTierMappingCount?: number;
  unknownPlansCount?: number;
  unknownPlacementsCount?: number;
  // Data details
  csvSample?: {
    date: string;
    views: number;
    unique: number;
    website: number;
    instagram: number;
  };
  rawFields?: string[];
  error?: string;
  validationWarnings?: string[];
}

interface StorageHealthStatus {
  status: 'ok' | 'error' | 'unconfigured' | 'loading' | 'unknown';
  latencyMs?: number;
  error?: string;
  dataset?: string;
  rows?: number;
  generatedAt?: string;
}

interface ReferrerData {
  source: string;
  count: number;
}

interface ApiResponse {
  site: string;
  range: string;
  contractVersion?: string;
  views?: number;
  uniqueViews?: number;
  totalDaysTracked?: number;
  trackingStarted?: string;
  vendors: Array<{
    vendor: string;
    website: number;
    instagram: number;
    views?: number;
    uniqueViews?: number;
    ctr?: number;
    // Visit payload now includes plan directly; tier is legacy fallback
    plan?: string;
    tier?: string; // Legacy fallback when plan is missing
    placements?: string[]; // Current field name from visit payload
    placementsActive?: string[]; // Legacy alias
    metaStatus?: 'ok' | 'missing' | 'mismatch';
  }>;
  daily: Array<{
    date: string;
    total: number;
  }>;
  dailyViews?: Array<{
    date: string;
    total: number;
  }>;
  dailyUniqueViews?: Array<{
    date: string;
    total: number;
  }>;
  topReferrers?: {
    internal?: ReferrerData[];
    external?: ReferrerData[];
  };
}

interface DailyData {
  date: string;
  clicks: number;
  views: number;
  uniqueViews: number;
  websiteClicks: number;
  instagramClicks: number;
  fullDate: string;
  isoDate: string;
}

type SortColumn = 'views' | 'uniqueViews' | 'websiteClicks' | 'instagramClicks' | 'totalClicks' | 'ctr';
type SortDirection = 'asc' | 'desc';

const CACHE_TTL = 60000; // 60 seconds for data cache

const formatLastUpdated = (date: Date): string => {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  return `${hours}:${minutes}, ${month} ${day}, ${year}`;
};

const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  return `${month} ${day}, ${year}`;
};

const formatDailyDataFromApi = (
  dailyClicks: Array<{ date: string; total: number }>,
  dailyViews?: Array<{ date: string; total: number }>,
  dailyUniqueViews?: Array<{ date: string; total: number }>
): DailyData[] => {
  return dailyClicks.map(item => {
    const date = new Date(item.date);
    const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getDay()];
    const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getMonth()];
    const fullDate = `${dayOfWeek}, ${month} ${date.getDate()}`;
    
    const viewsItem = dailyViews?.find(v => v.date === item.date);
    const uniqueViewsItem = dailyUniqueViews?.find(v => v.date === item.date);
    
    return {
      date: `${month} ${date.getDate()}`,
      clicks: item.total,
      views: viewsItem?.total || 0,
      uniqueViews: uniqueViewsItem?.total || 0,
      websiteClicks: 0, // Not available in stats mode
      instagramClicks: 0, // Not available in stats mode
      fullDate,
      isoDate: item.date,
    };
  });
};

const formatDailyDataFromCSV = (csv: ParsedVendorCSV): DailyData[] => {
  return csv.rows.map(row => {
    const date = new Date(row.date);
    const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getDay()];
    const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getMonth()];
    const fullDate = `${dayOfWeek}, ${month} ${date.getDate()}`;
    
    return {
      date: `${month} ${date.getDate()}`,
      clicks: row.totalClicks,
      views: row.views,
      uniqueViews: row.uniqueViews,
      websiteClicks: row.websiteClicks,
      instagramClicks: row.instagramClicks,
      fullDate,
      isoDate: row.date,
    };
  });
};

const formatCTR = (ctr: number | null, views: number | null): string => {
  if (ctr === null || views === null || views < 25) return '—';
  return `${ctr.toFixed(1)}%`;
};

const getAvailableSeries = (source: 'stats' | 'csv' | 'fallback'): string[] => {
  if (source === 'csv') {
    return ['views', 'uniqueViews', 'websiteClicks', 'instagramClicks', 'clicks'];
  }
  return ['views', 'uniqueViews', 'clicks'];
};

const hasSeriesData = (dailyData: DailyData[], seriesKey: keyof DailyData): boolean => {
  return dailyData.some(d => {
    const value = d[seriesKey];
    return typeof value === 'number' && value > 0;
  });
};

// 60-second in-memory cache
const siteCache = new Map<string, { 
  vendors: VendorData[], 
  daily: DailyData[], 
  totalViews: number,
  totalUniqueViews: number,
  totalClicks: number,
  totalWebsiteClicks: number,
  totalInstagramClicks: number,
  totalDaysTracked: number,
  trackingStarted: string | null,
  referrers: { internal: ReferrerData[], external: ReferrerData[] },
  contractVersion: string | null,
  timestamp: Date 
}>();
const vendorCSVCache = new Map<string, { 
  parsed: ParsedVendorCSV,
  timestamp: Date 
}>();

export default function Dashboard() {
  const { schema, contractVersion, isLoading: schemaLoading, error: schemaError } = useSchema();
  const dateRangeOptions = useDateRangeOptions();
  const checkContractVersion = useContractVersionCheck();
  useMinSampleSizes(); // Used by child components via context
  const isDebugMode = useSchemaDebugMode();
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  
  const [availableSites] = useState<string[]>(['StartMyLoveEngine']);
  const [selectedSite, setSelectedSite] = useState(() => {
    return localStorage.getItem('selectedSite') || 'StartMyLoveEngine';
  });
  
  // Convert UI site name to API slug (StartMyLoveEngine -> startmyloveengine)
  const siteSlug = selectedSite.toLowerCase().replace(/\s+/g, '');
  const [selectedRange, setSelectedRange] = useState('7d');
  const [data, setData] = useState<VendorData[]>([]);
  const [dailyData, setDailyData] = useState<DailyData[]>([]);
  const [totalViews, setTotalViews] = useState(0);
  const [totalUniqueViews, setTotalUniqueViews] = useState(0);
  const [totalClicks, setTotalClicks] = useState(0);
  const [totalWebsiteClicks, setTotalWebsiteClicks] = useState(0);
  const [totalInstagramClicks, setTotalInstagramClicks] = useState(0);
  const [totalDaysTracked, setTotalDaysTracked] = useState(0);
  const [trackingStarted, setTrackingStarted] = useState<string | null>(null);
  const [referrers, setReferrers] = useState<{ internal: ReferrerData[], external: ReferrerData[] }>({
    internal: [],
    external: []
  });
  const [apiContractVersion, setApiContractVersion] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{
    message: string;
    details?: string;
    timestamp: Date;
  } | null>(null);
  const [sortColumn, setSortColumn] = useState<SortColumn>('totalClicks');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [selectedVendor, setSelectedVendor] = useState<string | null>(null);
  const [selectedVendorMeta, setSelectedVendorMeta] = useState<{
    plan?: string;
    placementsActive?: string[];
    metaStatus?: 'ok' | 'missing' | 'mismatch';
  } | null>(null);
  const [loadingVendor, setLoadingVendor] = useState(false);
  const [visibleLines, setVisibleLines] = useState<Set<string>>(new Set(['views', 'clicks']));
  const [fetchDiagnostics, setFetchDiagnostics] = useState<FetchDiagnostics | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [currentSource, setCurrentSource] = useState<'stats' | 'csv' | 'fallback'>('stats');
  const [performanceDiagnostics, setPerformanceDiagnostics] = useState<RequestDiagnostics | null>(null);
  const [storageHealth, setStorageHealth] = useState<StorageHealthStatus>({ status: 'unknown' });
  const debounceTimer = useRef<NodeJS.Timeout | undefined>(undefined);

  // Fetch storage health status from the analytics engine health endpoint
  const fetchStorageHealth = useCallback(async () => {
    setStorageHealth({ status: 'loading' });
    try {
      const tokenResponse = await fetch('/api/analytics-token');
      if (!tokenResponse.ok) {
        setStorageHealth({ status: 'error', error: 'Failed to get auth token' });
        return;
      }
      const { token } = await tokenResponse.json();

      const response = await fetch('https://go.startmyloveengine.com/api/health/analytics-engine', {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (response.status === 503) {
        const data = await response.json().catch(() => ({}));
        if (data.status === 'unconfigured') {
          setStorageHealth({ status: 'unconfigured' });
        } else {
          setStorageHealth({ status: 'error', error: data.error || 'Service unavailable' });
        }
        return;
      }

      if (!response.ok) {
        setStorageHealth({ status: 'error', error: `HTTP ${response.status}` });
        return;
      }

      const data = await response.json();
      setStorageHealth({
        status: data.status || 'ok',
        latencyMs: data.latencyMs,
        dataset: data.dataset,
        rows: data.rows,
        generatedAt: data.generatedAt,
        error: data.error,
      });
    } catch (err) {
      setStorageHealth({ status: 'error', error: err instanceof Error ? err.message : 'Unknown error' });
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('selectedSite', selectedSite);
  }, [selectedSite]);

  useEffect(() => {
    setSelectedVendor(null);
    setSelectedVendorMeta(null);
  }, [selectedSite, selectedRange]);

  useEffect(() => {
    if (selectedVendor) {
      setVisibleLines(new Set(['views', 'uniqueViews', 'clicks']));
      setCurrentSource('csv');
    } else {
      setVisibleLines(new Set(['views', 'clicks']));
      setCurrentSource('stats');
    }
  }, [selectedVendor]);

  const fetchSiteData = useCallback(async (clearError: boolean = true) => {
    const cacheKey = `${selectedSite}-${selectedRange}`;
    const endpoint = `/api/analytics?site=${siteSlug}&range=${selectedRange}`;
    const startTime = performance.now();
    const source: 'stats' | 'csv' | 'fallback' = 'stats';
    const availableSeries = getAvailableSeries(source);
    const validationWarnings: string[] = [];
    
    // Check cache first
    if (siteCache.has(cacheKey)) {
      const cached = siteCache.get(cacheKey)!;
      const age = Date.now() - cached.timestamp.getTime();
      if (age < CACHE_TTL) {
        setData(cached.vendors);
        setDailyData(cached.daily);
        setTotalViews(cached.totalViews);
        setTotalUniqueViews(cached.totalUniqueViews);
        setTotalClicks(cached.totalClicks);
        setTotalWebsiteClicks(cached.totalWebsiteClicks);
        setTotalInstagramClicks(cached.totalInstagramClicks);
        setTotalDaysTracked(cached.totalDaysTracked);
        setTrackingStarted(cached.trackingStarted);
        setReferrers(cached.referrers);
        setApiContractVersion(cached.contractVersion);
        setLastUpdated(cached.timestamp);
        setCurrentSource(source);
        if (clearError) setError(null);
        
        const schemaCacheInfo = getSchemaCacheInfo();
        setFetchDiagnostics({
          endpoint,
          status: 200,
          latency: performance.now() - startTime,
          cache: 'hit',
          timestamp: cached.timestamp,
          source,
          availableSeries,
          contractVersion: cached.contractVersion || undefined,
          schemaVersion: schema?.version,
          schemaCacheTTL: schemaCacheInfo.ttlRemaining || undefined,
        });
        return;
      }
    }

    setLoading(true);
    if (clearError) setError(null);

    try {
      const fetchStart = performance.now();
      const { response, diagnostics: perfDiag } = await diagnosticFetch(
        `/api/analytics?site=${siteSlug}&range=${selectedRange}`,
        {},
        `range_change:${selectedRange}`
      );
      const latency = performance.now() - fetchStart;
      
      // Read AE/KV fallback headers (CORS exposes these)
      const dataSourceHeader = response.headers.get('X-Data-Source');
      const dataWarningHeader = response.headers.get('X-Data-Warning');
      const cacheHeader = response.headers.get('X-Cache');
      
      // Store performance diagnostics
      setPerformanceDiagnostics(perfDiag);
      
      if (response.status === 401) {
        setError({ message: "Access denied", details: "HTTP 401", timestamp: new Date() });
        setData([]);
        setDailyData([]);
        setLoading(false);
        return;
      }

      if (response.status === 404) {
        setError({ message: "No data available", details: "HTTP 404", timestamp: new Date() });
        setData([]);
        setDailyData([]);
        setLoading(false);
        return;
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        setError({ message: "Analytics temporarily unavailable", details: `HTTP ${response.status}: ${errorText}`, timestamp: new Date() });
        setData([]);
        setDailyData([]);
        setLoading(false);
        return;
      }

      const apiData: ApiResponse & { dataSource?: 'ae' | 'kv'; dataWarning?: string } = await response.json();
      
      // Resolve storage backend (prefer headers, fallback to JSON fields)
      const storageBackend: 'ae' | 'kv' | undefined = 
        (dataSourceHeader === 'ae' || dataSourceHeader === 'kv') ? dataSourceHeader :
        apiData.dataSource;
      const storageWarning = dataWarningHeader || apiData.dataWarning;
      const serverCache: 'HIT' | 'MISS' | undefined = 
        (cacheHeader === 'HIT' || cacheHeader === 'MISS') ? cacheHeader : undefined;
      
      // Check contract version and trigger auto-refresh if needed
      if (apiData.contractVersion) {
        const didRefresh = await checkContractVersion(apiData.contractVersion);
        if (didRefresh) {
          validationWarnings.push(`Schema auto-refreshed: contract version changed to ${apiData.contractVersion}`);
        } else if (contractVersion && apiData.contractVersion !== contractVersion) {
          validationWarnings.push(`Contract version mismatch: API=${apiData.contractVersion}, Schema=${contractVersion}`);
        }
      }
      
      // Build vendor data with metadata
      // Visit payload includes plan directly; use tier as legacy fallback
      let legacyTierMappingCount = 0;
      let unknownPlansCount = 0;
      let unknownPlacementsCount = 0;
      
      const vendorData: VendorData[] = apiData.vendors.map(v => {
        // Track legacy tier fallback usage
        const usedLegacyTier = !v.plan && v.tier;
        if (usedLegacyTier) {
          legacyTierMappingCount++;
        }
        
        // Resolve plan (plan primary, tier fallback)
        const resolvedPlan = v.plan || v.tier;
        
        // Validate plan against schema allowlist
        if (resolvedPlan && schema) {
          const allowedPlans = schema.allowedPlans.length > 0 ? schema.allowedPlans : schema.plans;
          if (!allowedPlans.includes(resolvedPlan) && resolvedPlan !== 'unknown') {
            unknownPlansCount++;
            console.warn(`[Analytics] Vendor "${v.vendor}" has plan "${resolvedPlan}" not in schema allowlist`);
          }
        }
        
        // Resolve placements - use placementsActive (simple string array)
        // The placements field contains objects with counts, but we only need the string array
        const resolvedPlacements = v.placementsActive || [];
        
        // Validate placements against schema allowlist
        if (resolvedPlacements.length > 0 && schema) {
          const allowedPlacements = schema.allowedPlacements.length > 0 ? schema.allowedPlacements : schema.placements;
          if (allowedPlacements.length > 0) {
            for (const placement of resolvedPlacements) {
              if (!allowedPlacements.includes(placement)) {
                unknownPlacementsCount++;
                console.warn(`[Analytics] Vendor "${v.vendor}" has placement "${placement}" not in schema allowlist`);
              }
            }
          }
        }
        
        return {
          name: v.vendor,
          websiteClicks: v.website,
          instagramClicks: v.instagram,
          totalClicks: v.website + v.instagram,
          views: v.views || null,
          uniqueViews: v.uniqueViews || null,
          ctr: v.ctr || null,
          plan: resolvedPlan,
          placementsActive: resolvedPlacements,
          metaStatus: v.metaStatus,
        };
      });

      // Check for vendors with issues
      const missingVendors = vendorData.filter(v => v.metaStatus === 'missing');
      const mismatchVendors = vendorData.filter(v => v.metaStatus === 'mismatch');
      if (missingVendors.length > 0) {
        validationWarnings.push(`${missingVendors.length} vendor(s) with missing data`);
      }
      if (mismatchVendors.length > 0) {
        validationWarnings.push(`${mismatchVendors.length} vendor(s) with data mismatch`);
      }
      
      // Warn about legacy tier fallback usage
      if (legacyTierMappingCount > 0) {
        validationWarnings.push(`${legacyTierMappingCount} vendor(s) using legacy tier→plan mapping`);
      }
      
      // Warn about unknown plans/placements not in schema
      if (unknownPlansCount > 0) {
        validationWarnings.push(`${unknownPlansCount} vendor(s) with plan not in schema allowlist`);
      }
      if (unknownPlacementsCount > 0) {
        validationWarnings.push(`${unknownPlacementsCount} placement(s) not in schema allowlist`);
      }

      const formattedDailyData = apiData.daily && apiData.daily.length > 0 
        ? formatDailyDataFromApi(apiData.daily, apiData.dailyViews, apiData.dailyUniqueViews)
        : [];

      const views = apiData.views || (apiData.dailyViews?.reduce((sum, day) => sum + day.total, 0) || 0);
      const uniqueViews = apiData.uniqueViews || (apiData.dailyUniqueViews?.reduce((sum, day) => sum + day.total, 0) || 0);
      const clicks = vendorData.reduce((sum, v) => sum + v.totalClicks, 0);
      const websiteClicks = vendorData.reduce((sum, v) => sum + v.websiteClicks, 0);
      const instagramClicks = vendorData.reduce((sum, v) => sum + v.instagramClicks, 0);
      const daysTracked = apiData.totalDaysTracked || 0;
      const started = apiData.trackingStarted || null;
      
      const referrerData = {
        internal: apiData.topReferrers?.internal?.slice(0, 5) || [],
        external: apiData.topReferrers?.external?.slice(0, 5) || [],
      };

      const now = new Date();
      setData(vendorData);
      setDailyData(formattedDailyData);
      setTotalViews(views);
      setTotalUniqueViews(uniqueViews);
      setTotalClicks(clicks);
      setTotalWebsiteClicks(websiteClicks);
      setTotalInstagramClicks(instagramClicks);
      setTotalDaysTracked(daysTracked);
      setTrackingStarted(started);
      setReferrers(referrerData);
      setApiContractVersion(apiData.contractVersion || null);
      setLastUpdated(now);
      setCurrentSource(source);
      
      siteCache.set(cacheKey, { 
        vendors: vendorData, 
        daily: formattedDailyData, 
        totalViews: views,
        totalUniqueViews: uniqueViews,
        totalClicks: clicks,
        totalWebsiteClicks: websiteClicks,
        totalInstagramClicks: instagramClicks,
        totalDaysTracked: daysTracked,
        trackingStarted: started,
        referrers: referrerData,
        contractVersion: apiData.contractVersion || null,
        timestamp: now 
      });
      
      const schemaCacheInfo = getSchemaCacheInfo();
      setFetchDiagnostics({
        endpoint,
        status: 200,
        latency,
        cache: 'miss',
        timestamp: now,
        source,
        availableSeries,
        contractVersion: apiData.contractVersion,
        schemaVersion: schema?.version,
        schemaCacheTTL: schemaCacheInfo.ttlRemaining || undefined,
        storageBackend,
        storageWarning,
        serverCache,
        legacyTierMappingCount: legacyTierMappingCount > 0 ? legacyTierMappingCount : undefined,
        unknownPlansCount: unknownPlansCount > 0 ? unknownPlansCount : undefined,
        unknownPlacementsCount: unknownPlacementsCount > 0 ? unknownPlacementsCount : undefined,
        validationWarnings: validationWarnings.length > 0 ? validationWarnings : undefined,
      });
      
      if (clearError) setError(null);
    } catch (err) {
      console.error('Site data fetch failed:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError({ message: "Analytics temporarily unavailable", details: errorMessage, timestamp: new Date() });
      setData([]);
      setDailyData([]);
    } finally {
      setLoading(false);
    }
  }, [selectedSite, selectedRange, contractVersion, schema, checkContractVersion, siteSlug]);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => { fetchSiteData(); }, 300);
    return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current); };
  }, [fetchSiteData]);

  // Auto-run health check when date range changes
  useEffect(() => {
    fetchStorageHealth();
  }, [selectedRange, fetchStorageHealth]);

  const fetchVendorDataFromCSV = async (vendorName: string, fallbackToStats: boolean = false) => {
    const cacheKey = `${vendorName}-${selectedRange}-csv`;
    const endpoint = `https://go.startmyloveengine.com/api/export/vendor.csv?site=${siteSlug}&vendor=${encodeURIComponent(vendorName)}&range=${selectedRange}`;
    const startTime = performance.now();
    const source: 'stats' | 'csv' | 'fallback' = 'csv';
    const availableSeries = getAvailableSeries(source);
    
    // Get vendor metadata from data array
    const vendorMeta = data.find(v => v.name === vendorName);
    setSelectedVendorMeta(vendorMeta ? {
      plan: vendorMeta.plan,
      placementsActive: vendorMeta.placementsActive,
      metaStatus: vendorMeta.metaStatus,
    } : null);
    
    // Check cache first
    if (vendorCSVCache.has(cacheKey)) {
      const cached = vendorCSVCache.get(cacheKey)!;
      const age = Date.now() - cached.timestamp.getTime();
      if (age < CACHE_TTL) {
        const formattedData = formatDailyDataFromCSV(cached.parsed);
        setDailyData(formattedData);
        setTotalViews(cached.parsed.totalViews);
        setTotalUniqueViews(cached.parsed.totalUniqueViews);
        setTotalClicks(cached.parsed.totalClicks);
        setTotalWebsiteClicks(cached.parsed.totalWebsiteClicks);
        setTotalInstagramClicks(cached.parsed.totalInstagramClicks);
        setCurrentSource(source);
        setError(null);
        
        const csvSample = cached.parsed.sampleRow ? {
          date: cached.parsed.sampleRow.date,
          views: cached.parsed.sampleRow.views,
          unique: cached.parsed.sampleRow.uniqueViews,
          website: cached.parsed.sampleRow.websiteClicks,
          instagram: cached.parsed.sampleRow.instagramClicks,
        } : undefined;
        
        const schemaCacheInfo = getSchemaCacheInfo();
        setFetchDiagnostics({
          endpoint,
          status: 200,
          latency: performance.now() - startTime,
          cache: 'hit',
          timestamp: cached.timestamp,
          source,
          availableSeries,
          csvSample,
          rawFields: cached.parsed.rawFields,
          contractVersion: apiContractVersion || undefined,
          schemaVersion: schema?.version,
          schemaCacheTTL: schemaCacheInfo.ttlRemaining || undefined,
          metaStatus: vendorMeta?.metaStatus,
          storageBackend: cached.parsed.responseHeaders?.dataSource,
          storageWarning: cached.parsed.responseHeaders?.dataWarning,
          serverCache: cached.parsed.responseHeaders?.cache,
        });
        return;
      }
    }

    setLoadingVendor(true);

    try {
      const tokenResponse = await fetch('/api/analytics-token');
      if (!tokenResponse.ok) throw new Error(`API token fetch failed (HTTP ${tokenResponse.status})`);
      const { token } = await tokenResponse.json();

      const fetchStart = performance.now();
      const parsed = await fetchVendorCSV(vendorName, selectedRange as '7d' | '28d' | '90d', token, siteSlug);
      const latency = performance.now() - fetchStart;
      const now = new Date();
      
      const formattedData = formatDailyDataFromCSV(parsed);
      
      setDailyData(formattedData);
      setTotalViews(parsed.totalViews);
      setTotalUniqueViews(parsed.totalUniqueViews);
      setTotalClicks(parsed.totalClicks);
      setTotalWebsiteClicks(parsed.totalWebsiteClicks);
      setTotalInstagramClicks(parsed.totalInstagramClicks);
      setCurrentSource(source);
      setError(null);
      
      vendorCSVCache.set(cacheKey, { parsed, timestamp: now });
      
      const csvSample = parsed.sampleRow ? {
        date: parsed.sampleRow.date,
        views: parsed.sampleRow.views,
        unique: parsed.sampleRow.uniqueViews,
        website: parsed.sampleRow.websiteClicks,
        instagram: parsed.sampleRow.instagramClicks,
      } : undefined;
      
      const schemaCacheInfo = getSchemaCacheInfo();
      setFetchDiagnostics({
        endpoint,
        status: 200,
        latency,
        cache: 'miss',
        timestamp: now,
        source,
        availableSeries,
        csvSample,
        rawFields: parsed.rawFields,
        contractVersion: apiContractVersion || undefined,
        schemaVersion: schema?.version,
        schemaCacheTTL: schemaCacheInfo.ttlRemaining || undefined,
        metaStatus: vendorMeta?.metaStatus,
        storageBackend: parsed.responseHeaders?.dataSource,
        storageWarning: parsed.responseHeaders?.dataWarning,
        serverCache: parsed.responseHeaders?.cache,
      });
    } catch (err) {
      console.error('CSV fetch failed:', vendorName, err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      
      if (fallbackToStats) {
        setError({ message: `Vendor analytics temporarily unavailable`, details: `Falling back to aggregate. Error: ${errorMessage}`, timestamp: new Date() });
        await fetchSiteData(false);
        setCurrentSource('fallback');
      } else {
        setError({ message: `Unable to load data for ${vendorName}`, details: errorMessage, timestamp: new Date() });
        setDailyData([]);
        setTotalViews(0);
        setTotalUniqueViews(0);
        setTotalClicks(0);
        setTotalWebsiteClicks(0);
        setTotalInstagramClicks(0);
      }
    } finally {
      setLoadingVendor(false);
    }
  };

  const handleVendorClick = async (vendorName: string) => {
    if (selectedVendor === vendorName) {
      setSelectedVendor(null);
      setSelectedVendorMeta(null);
      await fetchSiteData();
    } else {
      setSelectedVendor(vendorName);
      await fetchVendorDataFromCSV(vendorName);
    }
  };

  const toggleLine = (line: string) => {
    const available = getAvailableSeries(currentSource);
    if (!available.includes(line)) return;
    
    setVisibleLines(prev => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
  };

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const sortedData = [...data].sort((a, b) => {
    const aValue = a[sortColumn];
    const bValue = b[sortColumn];
    if (aValue === null && bValue === null) return 0;
    if (aValue === null) return sortDirection === 'asc' ? -1 : 1;
    if (bValue === null) return sortDirection === 'asc' ? 1 : -1;
    return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
  });

  // Compute vendor metrics for opportunity detection (memoized)
  const vendorMetrics: VendorMetrics[] = useMemo(() => 
    data.map(v => ({
      name: v.name,
      views: v.views,
      clicks: v.totalClicks,
      ctr: v.ctr,
    })),
    [data]
  );

  // Memoized opportunity detection results
  const opportunityFlags = useMemo(() => {
    if (!featureFlags.opportunityDetection) return new Map<string, boolean>();
    
    const flags = new Map<string, boolean>();
    for (const vendor of vendorMetrics) {
      const result = detectOpportunity(vendor, vendorMetrics);
      if (result.isOpportunity) {
        flags.set(vendor.name, true);
      }
    }
    return flags;
  }, [vendorMetrics]);

  const getDataMaturityMessage = () => {
    if (totalDaysTracked < 14) return 'Collecting data';
    if (totalViews < 20) return 'Limited sample';
    return null;
  };

  const handleDownloadRawCSV = async () => {
    if (!selectedVendor) return;
    try {
      const tokenResponse = await fetch('/api/analytics-token');
      if (!tokenResponse.ok) throw new Error('Failed to fetch analytics token');
      const { token } = await tokenResponse.json();

      const url = `https://go.startmyloveengine.com/api/export/vendor.csv?vendor=${encodeURIComponent(selectedVendor)}&range=${selectedRange}`;
      const response = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
      if (!response.ok) throw new Error('CSV download failed');

      const csvText = await response.text();
      const lines = csvText.split('\n');
      const modifiedLines = lines.map((line, index) => {
        if (index === 0) {
          const parts = line.split(',');
          return [parts[0], 'vendor', ...parts.slice(1)].join(',');
        } else if (line.trim()) {
          const parts = line.split(',');
          return [parts[0], selectedVendor, ...parts.slice(1)].join(',');
        }
        return line;
      });
      
      const blob = new Blob([modifiedLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const downloadUrl = URL.createObjectURL(blob);
      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const filename = `${selectedVendor}-raw-export-${selectedRange}-${dateStr}.csv`;

      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      console.error('CSV download failed:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError({ message: 'Failed to download CSV', details: errorMessage, timestamp: new Date() });
    }
  };

  const SortIcon = ({ column }: { column: SortColumn }) => {
    if (sortColumn !== column) return null;
    return <span className="ml-1 text-neutral-500">{sortDirection === 'asc' ? '↑' : '↓'}</span>;
  };

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ value: number; payload: DailyData; dataKey: string }> }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white px-3 py-2 border border-neutral-200 shadow-sm text-xs">
          <div className="font-medium text-neutral-900 mb-2">{data.fullDate}</div>
          {payload.map((entry) => {
            let label = '';
            let color = '';
            if (entry.dataKey === 'clicks') { label = 'Outbound clicks'; color = '#B8A15A'; }
            else if (entry.dataKey === 'websiteClicks') { label = 'Website clicks'; color = '#9CA3AF'; }
            else if (entry.dataKey === 'instagramClicks') { label = 'Instagram clicks'; color = '#D1D5DB'; }
            else if (entry.dataKey === 'views') { label = 'Profile views'; color = '#2C2C2C'; }
            else if (entry.dataKey === 'uniqueViews') { label = 'Unique visitors'; color = '#8A8A8A'; }
            
            return (
              <div key={entry.dataKey} className="flex items-center justify-between gap-4 py-0.5">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-neutral-600">{label}</span>
                </div>
                <span className="font-medium text-neutral-900">{entry.value.toLocaleString()}</span>
              </div>
            );
          })}
        </div>
      );
    }
    return null;
  };

  const ChartControls = () => {
    const available = getAvailableSeries(currentSource);
    const controls = [
      { key: 'views', label: 'Views', color: '#2C2C2C' },
      { key: 'uniqueViews', label: 'Unique', color: '#8A8A8A' },
      { key: 'websiteClicks', label: 'Website', color: '#9CA3AF' },
      { key: 'instagramClicks', label: 'Instagram', color: '#D1D5DB' },
      { key: 'clicks', label: 'Outbound Clicks', color: '#B8A15A' },
    ];

    return (
      <div className="flex items-center gap-2 mb-4">
        {controls.map(control => {
          const isAvailable = available.includes(control.key);
          const isEnabled = visibleLines.has(control.key);
          return (
            <button
              key={control.key}
              onClick={() => toggleLine(control.key)}
              disabled={!isAvailable}
              className={`px-3 py-1.5 text-xs border transition-colors ${
                !isAvailable ? 'border-neutral-200 text-neutral-300 cursor-not-allowed'
                : isEnabled ? 'border-neutral-900 text-neutral-900'
                : 'border-neutral-300 text-neutral-500 hover:border-neutral-400'
              }`}
              style={isAvailable && isEnabled ? { borderColor: control.color, color: control.color } : {}}
              title={!isAvailable ? 'Available in vendor view' : ''}
            >
              {control.label}
            </button>
          );
        })}
      </div>
    );
  };

  // Show schema loading state
  if (schemaLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-neutral-500">Loading configuration...</div>
      </div>
    );
  }

  // Show schema error banner but continue with fallback
  const showSchemaBanner = schemaError && !schema;

  return (
    <div className="min-h-screen bg-white">
      {/* Schema Debug Panel (activated via ?debug=schema or clicking contract version) */}
      {(isDebugMode || showDebugPanel) && (
        <SchemaDebugPanel 
          isVisible={true} 
          onClose={() => setShowDebugPanel(false)} 
        />
      )}
      
      {/* Schema error banner */}
      {showSchemaBanner && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-3">
          <div className="max-w-7xl mx-auto flex items-center gap-2 text-amber-800 text-sm">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span>Unable to load schema configuration. Using defaults.</span>
          </div>
        </div>
      )}
      
      {/* Top Bar */}
      <div className="sticky top-0 z-10 bg-white border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex flex-col lg:flex-row lg:items-center gap-4 lg:gap-6">
            {/* Selectors row */}
            <div className="flex items-center gap-6">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-neutral-600">Select site</label>
                <select
                  value={selectedSite}
                  onChange={(e) => setSelectedSite(e.target.value)}
                  className="px-3 py-2 border border-neutral-300 rounded bg-white text-sm text-neutral-900 focus:outline-none focus:border-neutral-500 cursor-pointer min-w-[220px]"
                >
                  {availableSites.map(site => (
                    <option key={site} value={site}>{site}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-neutral-600">Date range</label>
                <select
                  value={selectedRange}
                  onChange={(e) => setSelectedRange(e.target.value)}
                  className="px-3 py-2 border border-neutral-300 rounded bg-white text-sm text-neutral-900 focus:outline-none focus:border-neutral-500 cursor-pointer min-w-[160px]"
                >
                  {dateRangeOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>
            
            {/* Actions row */}
            <div className="flex items-center gap-4">
              {/* Contract version indicator (clickable to toggle debug panel) */}
              {contractVersion && (
                <button
                  onClick={() => setShowDebugPanel(!showDebugPanel)}
                  className="flex flex-col gap-1 hover:bg-neutral-50 px-2 py-1 rounded transition-colors cursor-pointer"
                  title="Click to toggle debug panel"
                >
                  <span className="text-xs text-neutral-400">Contract</span>
                  <span className={`text-xs font-mono ${showDebugPanel ? 'text-blue-600' : 'text-neutral-500'}`}>
                    v{contractVersion}
                  </span>
                </button>
              )}
              
              <button 
                onClick={() => setShowDiagnostics(!showDiagnostics)} 
                className="text-xs text-neutral-600 hover:text-neutral-900 transition-colors"
              >
                {showDiagnostics ? 'Hide' : 'Show'} diagnostics
              </button>
              
              <div className="flex items-center gap-2">
                {performanceDiagnostics && (
                  <button 
                    onClick={() => downloadDiagnostics(performanceDiagnostics, `perf-diag-${selectedRange}-${Date.now()}.txt`)} 
                    className="text-xs text-neutral-600 hover:text-neutral-900 transition-colors"
                  >
                    Download perf report
                  </button>
                )}
                {storageHealth.status !== 'unknown' && (
                  <span className={`text-xs ${
                    storageHealth.status === 'ok' ? 'text-green-600' :
                    storageHealth.status === 'loading' ? 'text-blue-600' :
                    storageHealth.status === 'error' ? 'text-red-600' : 'text-amber-600'
                  }`}>
                    {storageHealth.status === 'ok' ? '✓' :
                     storageHealth.status === 'loading' ? '⋯' :
                     storageHealth.status === 'error' ? '✗' : '○'}
                  </span>
                )}
              </div>
            </div>
          </div>
          {trackingStarted && (
            <div className="mt-2 text-xs text-neutral-500">
              Showing data since {formatDate(trackingStarted)}
            </div>
          )}
        </div>
      </div>

      {/* Diagnostics Panel - appears right below top bar when toggled */}
      {showDiagnostics && fetchDiagnostics && (
        <div className="border-b border-neutral-200 bg-neutral-50">
          <div className="max-w-7xl mx-auto px-6 py-4">
            <div className="p-4 bg-white border border-neutral-200 text-xs font-mono">
              <div className="flex items-center justify-between mb-3">
                <div className="font-medium text-neutral-700 font-sans text-sm">Data Diagnostics</div>
                {performanceDiagnostics && (
                  <button
                    onClick={() => {
                      console.log('=== Performance Diagnostics ===');
                      console.log(formatDiagnostics(performanceDiagnostics));
                      console.log('=== Raw Diagnostics Object ===');
                      console.log(performanceDiagnostics);
                    }}
                    className="text-xs text-blue-600 hover:text-blue-800 font-sans"
                  >
                    Log to console
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3">
                <div>
                  <span className="text-neutral-500 block mb-1">Data Source</span>
                  <span className={`font-medium ${
                    fetchDiagnostics.source === 'csv' ? 'text-green-600' :
                    fetchDiagnostics.source === 'fallback' ? 'text-orange-600' : 'text-blue-600'
                  }`}>
                    {fetchDiagnostics.source === 'csv' ? 'Vendor CSV (authoritative)' :
                     fetchDiagnostics.source === 'fallback' ? 'Fallback (aggregate)' : 'Stats API (aggregate)'}
                  </span>
                </div>
                
                <div>
                  <span className="text-neutral-500 block mb-1">Storage Backend</span>
                  <span className={`font-medium ${
                    fetchDiagnostics.storageBackend === 'ae' ? 'text-green-600' :
                    fetchDiagnostics.storageBackend === 'kv' ? 'text-amber-600' : 'text-neutral-400'
                  }`}>
                    {fetchDiagnostics.storageBackend === 'ae' ? 'Analytics Engine' :
                     fetchDiagnostics.storageBackend === 'kv' ? 'KV (fallback)' : 'Unknown'}
                  </span>
                  {fetchDiagnostics.storageWarning && (
                    <span className="text-red-500 ml-2 text-[10px]">⚠ {fetchDiagnostics.storageWarning}</span>
                  )}
                </div>
                
                <div>
                  <span className="text-neutral-500 block mb-1">Server Cache</span>
                  <span className={`font-medium ${
                    fetchDiagnostics.serverCache === 'HIT' ? 'text-blue-600' :
                    fetchDiagnostics.serverCache === 'MISS' ? 'text-neutral-600' : 'text-neutral-400'
                  }`}>
                    {fetchDiagnostics.serverCache || 'Not enabled'}
                  </span>
                </div>
                
                <div>
                  <span className="text-neutral-500 block mb-1">Aggregation</span>
                  <span className="text-neutral-900">{fetchDiagnostics.source === 'csv' ? 'Per-vendor daily rollup' : 'Site-wide rollup'}</span>
                </div>
                
                <div>
                  <span className="text-neutral-500 block mb-1">Sample Size</span>
                  <span className="text-neutral-900">{totalViews.toLocaleString()} views / {totalUniqueViews.toLocaleString()} unique</span>
                  <span className="text-neutral-400 block text-[10px] mt-0.5">Unique views clamped to total views server-side</span>
                </div>
                
                <div>
                  <span className="text-neutral-500 block mb-1">Contract Version</span>
                  <span className={`${fetchDiagnostics.contractVersion ? 'text-neutral-900' : 'text-neutral-400'}`}>
                    {fetchDiagnostics.contractVersion || 'Not provided'}
                  </span>
                </div>
                
                <div>
                  <span className="text-neutral-500 block mb-1">Schema Version</span>
                  <span className={`${fetchDiagnostics.schemaVersion ? 'text-neutral-900' : 'text-neutral-400'}`}>
                    {fetchDiagnostics.schemaVersion || 'Default'}
                  </span>
                </div>
                
                <div>
                  <span className="text-neutral-500 block mb-1">Schema Cache TTL</span>
                  <span className="text-neutral-900">
                    {fetchDiagnostics.schemaCacheTTL !== undefined 
                      ? `${Math.floor(fetchDiagnostics.schemaCacheTTL / 60)}m ${fetchDiagnostics.schemaCacheTTL % 60}s`
                      : 'Not cached'}
                  </span>
                </div>
                
                {fetchDiagnostics.metaStatus && (
                  <div>
                    <span className="text-neutral-500 block mb-1">Meta Status</span>
                    <span className={`${
                      fetchDiagnostics.metaStatus === 'ok' ? 'text-green-600' :
                      fetchDiagnostics.metaStatus === 'missing' ? 'text-red-600' : 'text-amber-600'
                    }`}>
                      {fetchDiagnostics.metaStatus}
                    </span>
                  </div>
                )}
                
                <div>
                  <span className="text-neutral-500 block mb-1">HTTP Status</span>
                  <span className={fetchDiagnostics.status === 200 ? 'text-green-600' : 'text-red-600'}>
                    {fetchDiagnostics.status === 0 ? 'Network Error' : fetchDiagnostics.status}
                  </span>
                </div>
                
                <div>
                  <span className="text-neutral-500 block mb-1">Latency</span>
                  <span className="text-neutral-900">{fetchDiagnostics.latency.toFixed(0)}ms</span>
                </div>
                
                <div>
                  <span className="text-neutral-500 block mb-1">Data Cache</span>
                  <span className={fetchDiagnostics.cache === 'hit' ? 'text-blue-600' : 'text-neutral-900'}>
                    {fetchDiagnostics.cache === 'hit' ? 'Cache hit (60s TTL)' : 'Fresh fetch'}
                  </span>
                </div>
                
                <div>
                  <span className="text-neutral-500 block mb-1">Tracking Duration</span>
                  <span className={`${totalDaysTracked < 7 ? 'text-amber-600' : 'text-neutral-900'}`}>
                    {totalDaysTracked > 0 ? `${totalDaysTracked} days` : 'Unknown'}
                  </span>
                </div>
                
                <div>
                  <span className="text-neutral-500 block mb-1">Data Quality</span>
                  <span className={`${
                    totalViews >= 100 && totalDaysTracked >= 14 ? 'text-green-600' :
                    totalViews >= 25 ? 'text-amber-600' : 'text-red-600'
                  }`}>
                    {totalViews >= 100 && totalDaysTracked >= 14 ? '✓ Reliable' :
                     totalViews >= 25 ? '◐ Moderate' : '✗ Low confidence'}
                  </span>
                </div>
                
                <div>
                  <span className="text-neutral-500 block mb-1">Fetched At</span>
                  <span className="text-neutral-900">{fetchDiagnostics.timestamp.toLocaleTimeString()}</span>
                </div>
                
                <div className="col-span-2 md:col-span-3">
                  <span className="text-neutral-500 block mb-1">Available Metrics</span>
                  <span className="text-neutral-900">{fetchDiagnostics.availableSeries.join(', ')}</span>
                  {fetchDiagnostics.source !== 'csv' && (
                    <span className="text-amber-600 ml-2">(click breakdown unavailable in aggregate mode)</span>
                  )}
                </div>
                
                <div className="col-span-2 md:col-span-3">
                  <span className="text-neutral-500 block mb-1">Endpoint</span>
                  <span className="text-neutral-700 break-all">{fetchDiagnostics.endpoint}</span>
                </div>
                
                {fetchDiagnostics.rawFields && fetchDiagnostics.rawFields.length > 0 && (
                  <div className="col-span-2 md:col-span-3">
                    <span className="text-neutral-500 block mb-1">CSV Fields</span>
                    <span className="text-neutral-900">{fetchDiagnostics.rawFields.join(', ')}</span>
                  </div>
                )}
                
                {fetchDiagnostics.csvSample && (
                  <div className="col-span-2 md:col-span-3">
                    <span className="text-neutral-500 block mb-1">Sample Row</span>
                    <code className="text-neutral-800 bg-neutral-100 px-2 py-1 rounded block mt-1">
                      {JSON.stringify(fetchDiagnostics.csvSample, null, 0)}
                    </code>
                  </div>
                )}
                
                {fetchDiagnostics.validationWarnings && fetchDiagnostics.validationWarnings.length > 0 && (
                  <div className="col-span-2 md:col-span-3 border-t border-amber-200 pt-2 mt-2">
                    <span className="text-amber-600 block mb-1">Validation Warnings</span>
                    <ul className="text-amber-700 list-disc list-inside">
                      {fetchDiagnostics.validationWarnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
                
                {fetchDiagnostics.error && (
                  <div className="col-span-2 md:col-span-3 border-t border-red-200 pt-2 mt-2">
                    <span className="text-red-500 block mb-1">Error</span>
                    <span className="text-red-600 break-all">{fetchDiagnostics.error}</span>
                  </div>
                )}
              </div>
              
              {/* Analytics Engine Health */}
              <div className="mt-4 pt-4 border-t border-neutral-300">
                <div className="flex items-center justify-between mb-3">
                  <h5 className="text-xs font-semibold text-neutral-700 uppercase tracking-wider">
                    Analytics Engine Health
                  </h5>
                  <button
                    onClick={() => fetchStorageHealth()}
                    className="text-xs text-blue-600 hover:text-blue-800 underline"
                  >
                    Check Now
                  </button>
                </div>
                {storageHealth.status !== 'unknown' ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                    <div>
                      <span className="text-neutral-500 block mb-1">Status</span>
                      <span className={`font-semibold ${
                        storageHealth.status === 'ok' ? 'text-green-600' :
                        storageHealth.status === 'error' ? 'text-red-600' :
                        storageHealth.status === 'loading' ? 'text-blue-600' : 'text-amber-600'
                      }`}>
                        {storageHealth.status === 'ok' ? '✓ OK' :
                         storageHealth.status === 'error' ? '✗ Error' :
                         storageHealth.status === 'loading' ? '⋯ Loading' : '○ Unconfigured'}
                      </span>
                    </div>
                    {storageHealth.latencyMs !== undefined && (
                      <div>
                        <span className="text-neutral-500 block mb-1">Query Latency</span>
                        <span className="text-neutral-900">{storageHealth.latencyMs}ms</span>
                      </div>
                    )}
                    {storageHealth.dataset && (
                      <div>
                        <span className="text-neutral-500 block mb-1">Dataset</span>
                        <span className="text-neutral-900 font-mono text-[10px]">{storageHealth.dataset}</span>
                      </div>
                    )}
                    {storageHealth.rows !== undefined && (
                      <div>
                        <span className="text-neutral-500 block mb-1">Rows Queried</span>
                        <span className="text-neutral-900">{storageHealth.rows.toLocaleString()}</span>
                      </div>
                    )}
                    {storageHealth.error && (
                      <div className="col-span-2 md:col-span-3">
                        <span className="text-neutral-500 block mb-1">Error Details</span>
                        <span className="text-red-600 text-[10px] font-mono">{storageHealth.error}</span>
                      </div>
                    )}
                    {storageHealth.generatedAt && (
                      <div>
                        <span className="text-neutral-500 block mb-1">Checked At</span>
                        <span className="text-neutral-600 text-[10px]">{new Date(storageHealth.generatedAt).toLocaleTimeString()}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-neutral-400 text-xs italic">Click "Check Now" to test Analytics Engine connectivity</p>
                )}
              </div>
              
              {/* Performance Diagnostics (Client-Side) */}
              {performanceDiagnostics && (
                <div className="mt-4 pt-4 border-t border-neutral-300">
                  <div className="font-medium text-neutral-700 mb-3 font-sans text-sm">Client-Side Performance</div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3">
                    <div>
                      <span className="text-neutral-500 block mb-1">Browser</span>
                      <span className="text-neutral-900">{performanceDiagnostics.context.browser} {performanceDiagnostics.context.browserVersion}</span>
                    </div>
                    
                    <div>
                      <span className="text-neutral-500 block mb-1">Device</span>
                      <span className="text-neutral-900">{performanceDiagnostics.context.device}</span>
                    </div>
                    
                    <div>
                      <span className="text-neutral-500 block mb-1">Network Type</span>
                      <span className="text-neutral-900">{performanceDiagnostics.context.networkType || 'Unknown'}</span>
                    </div>
                    
                    <div>
                      <span className="text-neutral-500 block mb-1">Connection Speed</span>
                      <span className="text-neutral-900">{performanceDiagnostics.context.connectionSpeed || 'Unknown'}</span>
                    </div>
                    
                    <div>
                      <span className="text-neutral-500 block mb-1">DNS Time</span>
                      <span className="text-neutral-900">{performanceDiagnostics.timing.dns.toFixed(2)}ms</span>
                    </div>
                    
                    <div>
                      <span className="text-neutral-500 block mb-1">TCP Time</span>
                      <span className="text-neutral-900">{performanceDiagnostics.timing.tcp.toFixed(2)}ms</span>
                    </div>
                    
                    <div>
                      <span className="text-neutral-500 block mb-1">TLS Time</span>
                      <span className="text-neutral-900">{performanceDiagnostics.timing.tls.toFixed(2)}ms</span>
                    </div>
                    
                    <div>
                      <span className="text-neutral-500 block mb-1">TTFB</span>
                      <span className={`font-medium ${performanceDiagnostics.timing.ttfb > 5000 ? 'text-red-600' : performanceDiagnostics.timing.ttfb > 1000 ? 'text-amber-600' : 'text-green-600'}`}>
                        {performanceDiagnostics.timing.ttfb.toFixed(2)}ms
                      </span>
                    </div>
                    
                    <div>
                      <span className="text-neutral-500 block mb-1">Download Time</span>
                      <span className="text-neutral-900">{performanceDiagnostics.timing.download.toFixed(2)}ms</span>
                    </div>
                    
                    <div>
                      <span className="text-neutral-500 block mb-1">Total Request Time</span>
                      <span className={`font-medium ${performanceDiagnostics.timing.total > 10000 ? 'text-red-600' : performanceDiagnostics.timing.total > 3000 ? 'text-amber-600' : 'text-green-600'}`}>
                        {performanceDiagnostics.timing.total.toFixed(2)}ms
                      </span>
                    </div>
                    
                    <div>
                      <span className="text-neutral-500 block mb-1">Response Size</span>
                      <span className="text-neutral-900">{performanceDiagnostics.responseSize} bytes</span>
                    </div>
                    
                    <div>
                      <span className="text-neutral-500 block mb-1">Compressed</span>
                      <span className="text-neutral-900">{performanceDiagnostics.compressed ? 'Yes' : 'No'}</span>
                    </div>
                    
                    <div>
                      <span className="text-neutral-500 block mb-1">Concurrent Requests</span>
                      <span className="text-neutral-900">{performanceDiagnostics.concurrentRequests}</span>
                    </div>
                    
                    <div className="col-span-2 md:col-span-3">
                      <span className="text-neutral-500 block mb-1">Cache-Control</span>
                      <span className="text-neutral-900">{performanceDiagnostics.cache.cacheControl || 'Not set'}</span>
                    </div>
                    
                    {performanceDiagnostics.cache.age !== undefined && (
                      <div>
                        <span className="text-neutral-500 block mb-1">Age Header</span>
                        <span className="text-neutral-900">{performanceDiagnostics.cache.age}s</span>
                      </div>
                    )}
                    
                    {performanceDiagnostics.cache.etag && (
                      <div className="col-span-2">
                        <span className="text-neutral-500 block mb-1">ETag</span>
                        <span className="text-neutral-700 break-all">{performanceDiagnostics.cache.etag}</span>
                      </div>
                    )}
                    
                    {performanceDiagnostics.cache.cdnCache && (
                      <div>
                        <span className="text-neutral-500 block mb-1">CDN Cache Status</span>
                        <span className="text-neutral-900">{performanceDiagnostics.cache.cdnCache}</span>
                      </div>
                    )}
                    
                    {performanceDiagnostics.correlationIds.requestId && (
                      <div className="col-span-2 md:col-span-3">
                        <span className="text-neutral-500 block mb-1">Request ID</span>
                        <span className="text-neutral-700 break-all">{performanceDiagnostics.correlationIds.requestId}</span>
                      </div>
                    )}
                    
                    {performanceDiagnostics.correlationIds.traceId && (
                      <div className="col-span-2 md:col-span-3">
                        <span className="text-neutral-500 block mb-1">Trace ID</span>
                        <span className="text-neutral-700 break-all">{performanceDiagnostics.correlationIds.traceId}</span>
                      </div>
                    )}
                    
                    {performanceDiagnostics.correlationIds.traceparent && (
                      <div className="col-span-2 md:col-span-3">
                        <span className="text-neutral-500 block mb-1">Traceparent</span>
                        <span className="text-neutral-700 break-all">{performanceDiagnostics.correlationIds.traceparent}</span>
                      </div>
                    )}
                  </div>
                  
                  <div className="mt-3 text-xs text-neutral-500 font-sans">
                    Click "Download perf report" for complete diagnostic details including all headers
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Vendor metadata header when vendor selected */}
        {selectedVendor && selectedVendorMeta && (
          <div className="mb-6 flex items-center gap-4">
            <h1 className="text-lg font-medium text-neutral-900">{selectedVendor}</h1>
            <VendorMetadataBadges
              plan={selectedVendorMeta.plan}
              placementsActive={selectedVendorMeta.placementsActive}
              metaStatus={selectedVendorMeta.metaStatus}
            />
          </div>
        )}
        
        {/* KPI Row - Responsive component */}
        {!error && (
          <KpiRow
            totalViews={totalViews}
            totalUniqueViews={totalUniqueViews}
            totalClicks={totalClicks}
            totalWebsiteClicks={totalWebsiteClicks}
            totalInstagramClicks={totalInstagramClicks}
            totalDaysTracked={totalDaysTracked}
            selectedVendor={selectedVendor}
            getDataMaturityMessage={getDataMaturityMessage}
          />
        )}

        {/* Engagement Funnel - Responsive component */}
        {!error && totalViews > 0 && (
          <EngagementFunnel
            totalViews={totalViews}
            totalUniqueViews={totalUniqueViews}
            totalClicks={totalClicks}
          />
        )}

        {/* Engagement Quality Panel */}
        {!error && totalViews > 0 && (
          <EngagementQualityPanel
            totalViews={totalViews}
            totalUniqueViews={totalUniqueViews}
            totalClicks={totalClicks}
            vendorName={selectedVendor}
          />
        )}

        {/* Performance Chart */}
        <div className="mb-8">
          <div className="border border-neutral-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-neutral-700">
                {selectedVendor ? `${selectedVendor} performance` : 'Performance overview'}
              </h2>
              {selectedVendor && (
                <div className="flex items-center gap-3">
                  <button onClick={handleDownloadRawCSV} className="text-xs text-neutral-600 hover:text-neutral-900 transition-colors">
                    Download raw CSV
                  </button>
                  <button onClick={() => handleVendorClick(selectedVendor)} className="text-xs text-neutral-600 hover:text-neutral-900 transition-colors">
                    Show all vendors
                  </button>
                </div>
              )}
            </div>
            
            <ChartControls />
            {!error && dailyData.length > 0 ? (
              <div className={loading || loadingVendor ? 'opacity-40' : ''}>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={dailyData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#737373' }} tickLine={false} axisLine={{ stroke: '#e5e5e5' }} />
                    <YAxis tick={{ fontSize: 12, fill: '#737373' }} tickLine={false} axisLine={{ stroke: '#e5e5e5' }} tickFormatter={(value) => value.toLocaleString()} />
                    <Tooltip content={<CustomTooltip />} />
                    {visibleLines.has('views') && hasSeriesData(dailyData, 'views') && (
                      <Line type="monotone" dataKey="views" stroke="#2C2C2C" strokeWidth={2} dot={false} />
                    )}
                    {visibleLines.has('uniqueViews') && hasSeriesData(dailyData, 'uniqueViews') && (
                      <Line type="monotone" dataKey="uniqueViews" stroke="#8A8A8A" strokeWidth={2} dot={false} />
                    )}
                    {visibleLines.has('clicks') && hasSeriesData(dailyData, 'clicks') && (
                      <Line type="monotone" dataKey="clicks" stroke="#B8A15A" strokeWidth={2} dot={false} />
                    )}
                    {visibleLines.has('websiteClicks') && hasSeriesData(dailyData, 'websiteClicks') && (
                      <Line type="monotone" dataKey="websiteClicks" stroke="#9CA3AF" strokeWidth={1.5} dot={false} />
                    )}
                    {visibleLines.has('instagramClicks') && hasSeriesData(dailyData, 'instagramClicks') && (
                      <Line type="monotone" dataKey="instagramClicks" stroke="#D1D5DB" strokeWidth={1.5} dot={false} />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[240px] flex items-center justify-center">
                <div className="text-sm text-neutral-600">No data available for this property</div>
              </div>
            )}
          </div>
        </div>

        {/* Vendor Table */}
        <div>
          {lastUpdated && (
            <div className="flex justify-end mb-2">
              <span className="text-xs text-neutral-500">Last updated: {formatLastUpdated(lastUpdated)}</span>
            </div>
          )}
          
          {error && (
            <div className="mb-8 border border-red-200 bg-red-50 p-4 rounded">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  <svg className="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-medium text-red-900 mb-1">{error.message}</h3>
                  {error.details && (
                    <div className="text-xs text-red-700 font-mono bg-red-100 p-2 rounded mt-2">{error.details}</div>
                  )}
                  <div className="text-xs text-red-600 mt-2">{error.timestamp.toLocaleTimeString()}</div>
                </div>
                <button onClick={() => setError(null)} className="flex-shrink-0 text-red-400 hover:text-red-600 transition-colors">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
          )}
          
          <div className="border border-neutral-200 mb-8 overflow-x-auto">
            {error && data.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-neutral-400">No data to display</div>
            ) : (
              <table className="w-full" role="table">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50">
                    <th scope="col" rowSpan={2} className="text-left px-6 py-3 text-xs font-medium text-neutral-600 uppercase tracking-wider align-bottom">Vendor</th>
                    <th scope="col" rowSpan={2} className="text-right px-6 py-3 text-xs font-medium text-neutral-600 uppercase tracking-wider cursor-pointer hover:bg-neutral-100 align-bottom" onClick={() => handleSort('views')}>
                      <div className="flex items-center justify-end">Views<SortIcon column="views" /></div>
                    </th>
                    <th scope="col" rowSpan={2} className="text-right px-6 py-3 text-xs font-medium text-neutral-600 uppercase tracking-wider cursor-pointer hover:bg-neutral-100 align-bottom hidden md:table-cell" onClick={() => handleSort('uniqueViews')}>
                      <div className="flex items-center justify-end">Unique<SortIcon column="uniqueViews" /></div>
                    </th>
                    <th scope="colgroup" colSpan={2} className="text-center px-6 py-2 text-xs font-medium text-neutral-600 uppercase tracking-wider border-b border-neutral-200 hidden md:table-cell">Outbound Clicks</th>
                    <th scope="col" rowSpan={2} className="text-right px-6 py-3 text-xs font-medium text-neutral-600 uppercase tracking-wider cursor-pointer hover:bg-neutral-100 align-bottom md:hidden" onClick={() => handleSort('totalClicks')}>
                      <div className="flex items-center justify-end">Clicks<SortIcon column="totalClicks" /></div>
                    </th>
                    <th scope="col" rowSpan={2} className="text-right px-6 py-3 text-xs font-medium text-neutral-600 uppercase tracking-wider cursor-pointer hover:bg-neutral-100 align-bottom" onClick={() => handleSort('ctr')}>
                      <div className="flex items-center justify-end">CTR<SortIcon column="ctr" /></div>
                    </th>
                  </tr>
                  <tr className="border-b border-neutral-200 bg-neutral-50 hidden md:table-row">
                    <th scope="col" className="text-right px-6 py-2 text-xs font-medium text-neutral-500 uppercase tracking-wider cursor-pointer hover:bg-neutral-100" onClick={() => handleSort('websiteClicks')}>
                      <div className="flex items-center justify-end">Website<SortIcon column="websiteClicks" /></div>
                    </th>
                    <th scope="col" className="text-right px-6 py-2 text-xs font-medium text-neutral-500 uppercase tracking-wider cursor-pointer hover:bg-neutral-100" onClick={() => handleSort('instagramClicks')}>
                      <div className="flex items-center justify-end">Instagram<SortIcon column="instagramClicks" /></div>
                    </th>
                  </tr>
                </thead>
                <tbody className={loading ? 'opacity-40' : ''}>
                  {sortedData.length === 0 && !loading && (
                    <tr><td colSpan={6} className="px-6 py-12 text-center text-sm text-neutral-600">No data for this property and date range</td></tr>
                  )}
                  {sortedData.map((vendor) => {
                    const isSelected = selectedVendor === vendor.name;
                    return (
                      <tr
                        key={vendor.name}
                        className={`border-b border-neutral-100 transition-colors cursor-pointer hover:bg-neutral-50 ${isSelected ? 'bg-neutral-100' : ''} ${vendor.metaStatus === 'missing' ? 'bg-red-50/30' : ''}`}
                        onClick={() => handleVendorClick(vendor.name)}
                      >
                        <th scope="row" className="px-6 py-3 text-sm text-neutral-900 text-left font-normal">
                          <div className="flex items-center gap-2">
                            <span>{vendor.name}</span>
                            <VendorMetadataBadges
                              plan={vendor.plan}
                              placementsActive={vendor.placementsActive}
                              metaStatus={vendor.metaStatus}
                              compact={true}
                            />
                            {featureFlags.opportunityDetection && opportunityFlags.get(vendor.name) && (
                              <span 
                                className="text-amber-500 cursor-help" 
                                title="High traffic, below-average conversion"
                              >
                                ⚠
                              </span>
                            )}
                          </div>
                        </th>
                        <td className="px-6 py-3 text-sm text-neutral-700 text-right tabular-nums">
                          {vendor.views !== null ? vendor.views.toLocaleString() : '—'}
                        </td>
                        <td className="px-6 py-3 text-sm text-neutral-700 text-right tabular-nums hidden md:table-cell">
                          {vendor.uniqueViews !== null ? vendor.uniqueViews.toLocaleString() : '—'}
                        </td>
                        <td className="px-6 py-3 text-sm text-neutral-700 text-right tabular-nums hidden md:table-cell">
                          {vendor.websiteClicks.toLocaleString()}
                        </td>
                        <td className="px-6 py-3 text-sm text-neutral-700 text-right tabular-nums hidden md:table-cell">
                          {vendor.instagramClicks.toLocaleString()}
                        </td>
                        <td className="px-6 py-3 text-sm text-neutral-700 text-right tabular-nums md:hidden">
                          {vendor.totalClicks.toLocaleString()}
                        </td>
                        <td className="px-6 py-3 text-sm text-neutral-700 text-right tabular-nums">
                          {formatCTR(vendor.ctr, vendor.views)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {sortedData.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-neutral-300 bg-neutral-50 font-semibold">
                      <th scope="row" className="px-6 py-3 text-sm text-neutral-900 text-left">Total</th>
                      <td className="px-6 py-3 text-sm text-neutral-900 text-right tabular-nums">{sortedData.reduce((sum, v) => sum + (v.views ?? 0), 0).toLocaleString()}</td>
                      <td className="px-6 py-3 text-sm text-neutral-900 text-right tabular-nums hidden md:table-cell">{sortedData.reduce((sum, v) => sum + (v.uniqueViews ?? 0), 0).toLocaleString()}</td>
                      <td className="px-6 py-3 text-sm text-neutral-900 text-right tabular-nums hidden md:table-cell">{sortedData.reduce((sum, v) => sum + v.websiteClicks, 0).toLocaleString()}</td>
                      <td className="px-6 py-3 text-sm text-neutral-900 text-right tabular-nums hidden md:table-cell">{sortedData.reduce((sum, v) => sum + v.instagramClicks, 0).toLocaleString()}</td>
                      <td className="px-6 py-3 text-sm text-neutral-900 text-right tabular-nums md:hidden">{sortedData.reduce((sum, v) => sum + v.totalClicks, 0).toLocaleString()}</td>
                      <td className="px-6 py-3 text-sm text-neutral-700 text-right tabular-nums">—</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </div>
        </div>

        {/* Traffic Sources Panel */}
        {!error && !selectedVendor && (referrers.internal.length > 0 || referrers.external.length > 0) && (
          <TrafficSourcesPanel internal={referrers.internal} external={referrers.external} vendorName={selectedVendor} />
        )}
      </div>
    </div>
  );
}
