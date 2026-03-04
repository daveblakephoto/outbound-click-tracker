/**
 * SchemaContext - Contract-First Configuration Provider
 * 
 * Provides the analytics schema to all components.
 * Features:
 * - Fetches on app boot and caches for 1 hour
 * - Auto-recovers from contract version drift
 * - Validates schema on load
 * - Persists diagnostics across route changes
 */

import { createContext, useContext, useEffect, useState, useCallback, useMemo, ReactNode } from 'react';
import { 
  fetchSchema, 
  getSchemaCacheInfo,
  onSchemaRefresh,
  needsRefreshForVersion,
  refreshForContractMismatch,
  getDefaultSchema,
  type AnalyticsSchema,
  type SchemaCacheInfo,
  type SchemaValidationResult,
} from '../services/schemaService';

interface SchemaRefreshEvent {
  timestamp: Date;
  reason: string;
  previousVersion: string | null;
  newVersion: string;
}

interface SchemaContextValue {
  schema: AnalyticsSchema;
  isLoading: boolean;
  error: string | null;
  isUsingFallback: boolean;
  
  // Version info
  apiVersion: string | null;
  contractVersion: string | null;
  
  // Validation
  validation: SchemaValidationResult | null;
  
  // Cache info for diagnostics (persists across route changes)
  cacheInfo: SchemaCacheInfo;
  
  // Refresh history
  refreshHistory: SchemaRefreshEvent[];
  lastRefreshEvent: SchemaRefreshEvent | null;
  
  // Actions
  refresh: () => Promise<void>;
  checkContractVersion: (apiContractVersion: string) => Promise<boolean>;
}

const SchemaContext = createContext<SchemaContextValue | null>(null);

interface SchemaProviderProps {
  children: ReactNode;
}

export function SchemaProvider({ children }: SchemaProviderProps) {
  const [schema, setSchema] = useState<AnalyticsSchema | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUsingFallback, setIsUsingFallback] = useState(false);
  const [validation] = useState<SchemaValidationResult | null>(null);
  const [cacheInfo, setCacheInfo] = useState<SchemaCacheInfo>(() => getSchemaCacheInfo());
  const [refreshHistory, setRefreshHistory] = useState<SchemaRefreshEvent[]>([]);

  const loadSchema = useCallback(async (forceRefresh = false) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const fetchedSchema = await fetchSchema(forceRefresh);
      
      // Check if we're using the fallback
      const isFallback = fetchedSchema.apiVersion === 'unknown';
      setIsUsingFallback(isFallback);
      
      setSchema(fetchedSchema);
      
      // Update cache info
      setCacheInfo(getSchemaCacheInfo());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load schema';
      setError(message);
      console.error('[SchemaContext] Load error:', err);
      
      // Use default schema on error
      setSchema(getDefaultSchema());
      setIsUsingFallback(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Check API contract version and trigger refresh if mismatched
  const checkContractVersion = useCallback(async (apiContractVersion: string): Promise<boolean> => {
    if (!apiContractVersion || apiContractVersion === 'unknown') {
      return false;
    }
    
    if (needsRefreshForVersion(apiContractVersion)) {
      console.log(`[SchemaContext] Contract version mismatch detected. Triggering refresh.`);
      
      const previousVersion = schema?.apiVersion || null;
      
      try {
        const newSchema = await refreshForContractMismatch(apiContractVersion);
        setSchema(newSchema);
        setCacheInfo(getSchemaCacheInfo());
        
        // Record refresh event
        const event: SchemaRefreshEvent = {
          timestamp: new Date(),
          reason: 'contract_version_mismatch',
          previousVersion,
          newVersion: newSchema.apiVersion,
        };
        setRefreshHistory(prev => [...prev.slice(-9), event]); // Keep last 10
        
        return true;
      } catch (err) {
        console.error('[SchemaContext] Contract refresh failed:', err);
        return false;
      }
    }
    
    return false;
  }, [schema?.apiVersion]);

  // Fetch schema on mount
  useEffect(() => {
    loadSchema();
  }, [loadSchema]);

  // Subscribe to schema refresh events from the service
  useEffect(() => {
    const unsubscribe = onSchemaRefresh((newSchema, reason) => {
      console.log(`[SchemaContext] Schema refresh event received: ${reason}`);
      setSchema(newSchema);
      setCacheInfo(getSchemaCacheInfo());
      
      const event: SchemaRefreshEvent = {
        timestamp: new Date(),
        reason,
        previousVersion: schema?.apiVersion || null,
        newVersion: newSchema.apiVersion,
      };
      setRefreshHistory(prev => [...prev.slice(-9), event]);
    });
    
    return unsubscribe;
  }, [schema?.apiVersion]);

  // Periodically update cache info (every 60s)
  useEffect(() => {
    const interval = setInterval(() => {
      setCacheInfo(getSchemaCacheInfo());
    }, 60000);
    
    return () => clearInterval(interval);
  }, []);

  // Memoized value to prevent unnecessary re-renders
  const value = useMemo<SchemaContextValue>(() => ({
    schema: schema || getDefaultSchema(),
    isLoading,
    error,
    isUsingFallback,
    apiVersion: schema?.apiVersion || null,
    contractVersion: schema?.contractVersion || null,
    validation,
    cacheInfo,
    refreshHistory,
    lastRefreshEvent: refreshHistory.length > 0 ? refreshHistory[refreshHistory.length - 1] : null,
    refresh: () => loadSchema(true),
    checkContractVersion,
  }), [schema, isLoading, error, isUsingFallback, validation, cacheInfo, refreshHistory, loadSchema, checkContractVersion]);

  return (
    <SchemaContext.Provider value={value}>
      {children}
    </SchemaContext.Provider>
  );
}

export function useSchema(): SchemaContextValue {
  const context = useContext(SchemaContext);
  
  if (!context) {
    throw new Error('useSchema must be used within a SchemaProvider');
  }
  
  return context;
}

/**
 * Hook to get validated date range options from schema
 */
export function useDateRangeOptions(): Array<{ label: string; value: string }> {
  const { schema } = useSchema();
  
  // Map schema ranges to options dynamically
  const ranges = schema.defaultRanges.length > 0 ? schema.defaultRanges : schema.ranges;
  
  const labelMap: Record<string, string> = {
    '7d': 'Last 7 days',
    '28d': 'Last 28 days',
    '90d': 'Last 3 months',
  };
  
  return ranges.map(code => ({
    label: labelMap[code] || code,
    value: code,
  }));
}

/**
 * Hook to validate a range against schema
 */
export function useValidateRange(range: string): boolean {
  const { schema } = useSchema();
  const ranges = schema.defaultRanges.length > 0 ? schema.defaultRanges : schema.ranges;
  return ranges.includes(range);
}

/**
 * Hook to get allowed plans from schema
 */
export function useAllowedPlans(): string[] {
  const { schema } = useSchema();
  return schema.allowedPlans.length > 0 ? schema.allowedPlans : schema.plans;
}

/**
 * Hook to get allowed placements from schema
 */
export function useAllowedPlacements(): string[] {
  const { schema } = useSchema();
  return schema.allowedPlacements.length > 0 ? schema.allowedPlacements : schema.placements;
}

/**
 * Hook for contract version monitoring
 * Returns a function to check and potentially refresh on mismatch
 */
export function useContractVersionCheck(): (apiVersion: string) => Promise<boolean> {
  const { checkContractVersion } = useSchema();
  return checkContractVersion;
}

/**
 * Hook to get sample size thresholds from schema
 */
export function useMinSampleSizes(): { ctr: number; clicksPerVisitor: number } {
  const { schema } = useSchema();
  return schema.minSampleSizes;
}
