/**
 * SchemaDebugPanel - Developer debugging tool
 * 
 * Activated via ?debug=schema URL parameter.
 * Shows:
 * - Raw schema JSON
 * - Resolved UI configuration
 * - Validation output
 * - Cache lifecycle info
 * - Refresh history
 */

import { useState, useMemo } from 'react';
import { useSchema, useAllowedPlans, useAllowedPlacements, useDateRangeOptions, useMinSampleSizes } from '../contexts/SchemaContext';
import { getSchemaCacheInfo, getPlanDisplayConfig, getPlacementDisplayConfig, validateSchemaResponse } from '../services/schemaService';

type DebugTab = 'raw' | 'config' | 'validation' | 'cache' | 'history';

interface SchemaDebugPanelProps {
  isVisible?: boolean;
  onClose?: () => void;
}

export default function SchemaDebugPanel({ isVisible = true, onClose }: SchemaDebugPanelProps = {}) {
  const { schema, isLoading, error, isUsingFallback, apiVersion, contractVersion, refreshHistory, refresh } = useSchema();
  const allowedPlans = useAllowedPlans();
  const allowedPlacements = useAllowedPlacements();
  const dateRangeOptions = useDateRangeOptions();
  const minSampleSizes = useMinSampleSizes();
  const cacheInfo = getSchemaCacheInfo();
  
  const [activeTab, setActiveTab] = useState<DebugTab>('raw');
  const [isMinimized, setIsMinimized] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Compute resolved UI config
  const resolvedConfig = useMemo(() => ({
    dateRanges: dateRangeOptions,
    plans: allowedPlans.map(plan => ({
      value: plan,
      ...getPlanDisplayConfig(plan, schema),
    })),
    placements: allowedPlacements.map(placement => ({
      value: placement,
      ...getPlacementDisplayConfig(placement, schema),
    })),
    minSampleSizes,
    apiVersion,
    contractVersion,
    isUsingFallback,
  }), [dateRangeOptions, allowedPlans, allowedPlacements, minSampleSizes, apiVersion, contractVersion, isUsingFallback, schema]);

  // Compute validation output
  const validationOutput = useMemo(() => {
    if (!schema) return null;
    // Re-validate against the schema structure
    const schemaAsRecord = schema as unknown as Record<string, unknown>;
    return validateSchemaResponse(schemaAsRecord);
  }, [schema]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  const tabs: Array<{ key: DebugTab; label: string }> = [
    { key: 'raw', label: 'Raw Schema' },
    { key: 'config', label: 'UI Config' },
    { key: 'validation', label: 'Validation' },
    { key: 'cache', label: 'Cache' },
    { key: 'history', label: 'History' },
  ];

  if (!isVisible) {
    return null;
  }

  if (isMinimized) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <button
          onClick={() => setIsMinimized(false)}
          className="bg-neutral-900 text-white px-3 py-2 rounded shadow-lg text-xs font-mono hover:bg-neutral-800 transition-colors"
        >
          🔧 Schema Debug
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[600px] max-h-[70vh] bg-neutral-900 text-neutral-100 rounded-lg shadow-2xl overflow-hidden font-mono text-xs">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-neutral-800 border-b border-neutral-700">
        <div className="flex items-center gap-2">
          <span className="text-neutral-400">🔧</span>
          <span className="font-medium">Schema Debug Panel</span>
          {isLoading && <span className="text-amber-400 animate-pulse">Loading...</span>}
          {isUsingFallback && <span className="text-amber-500 bg-amber-900/30 px-1.5 py-0.5 rounded">Fallback</span>}
          {error && <span className="text-red-400 bg-red-900/30 px-1.5 py-0.5 rounded">Error</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="text-neutral-400 hover:text-white transition-colors disabled:opacity-50"
            title="Force refresh schema"
          >
            {isRefreshing ? '⏳' : '🔄'}
          </button>
          <button
            onClick={() => setIsMinimized(true)}
            className="text-neutral-400 hover:text-white transition-colors"
            title="Minimize"
          >
            ▼
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="text-neutral-400 hover:text-white transition-colors"
              title="Close"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-neutral-700 bg-neutral-850">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-xs transition-colors ${
              activeTab === tab.key
                ? 'bg-neutral-700 text-white border-b-2 border-blue-500'
                : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="overflow-auto max-h-[50vh] p-4">
        {activeTab === 'raw' && (
          <div>
            <div className="text-neutral-500 mb-2">Raw schema from /api/schema:</div>
            <pre className="bg-neutral-800 p-3 rounded overflow-x-auto text-[11px] leading-relaxed">
              {JSON.stringify(schema, null, 2)}
            </pre>
          </div>
        )}

        {activeTab === 'config' && (
          <div className="space-y-4">
            <div>
              <div className="text-neutral-500 mb-2">Resolved UI Configuration:</div>
              <pre className="bg-neutral-800 p-3 rounded overflow-x-auto text-[11px] leading-relaxed">
                {JSON.stringify(resolvedConfig, null, 2)}
              </pre>
            </div>
            
            <div>
              <div className="text-neutral-500 mb-2">Plan Pills Preview:</div>
              <div className="flex flex-wrap gap-2 bg-neutral-800 p-3 rounded">
                {resolvedConfig.plans.map(plan => (
                  <span
                    key={plan.value}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${plan.bgColor} ${plan.color}`}
                  >
                    {plan.label}
                    {!plan.isKnown && <span className="ml-1 opacity-60">?</span>}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <div className="text-neutral-500 mb-2">Placement Badges Preview:</div>
              <div className="flex flex-wrap gap-2 bg-neutral-800 p-3 rounded">
                {resolvedConfig.placements.length > 0 ? resolvedConfig.placements.map(placement => (
                  <span
                    key={placement.value}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${placement.bgColor} ${placement.color} border ${placement.borderColor}`}
                  >
                    {placement.label}
                    {!placement.isKnown && <span className="ml-0.5 opacity-60">?</span>}
                  </span>
                )) : (
                  <span className="text-neutral-500">No placements defined in schema</span>
                )}
              </div>
            </div>

            <div>
              <div className="text-neutral-500 mb-2">Date Range Options:</div>
              <div className="flex flex-wrap gap-2 bg-neutral-800 p-3 rounded">
                {resolvedConfig.dateRanges.map(range => (
                  <span
                    key={range.value}
                    className="px-2 py-0.5 rounded bg-neutral-700 text-neutral-200 text-[10px]"
                  >
                    {range.label} ({range.value})
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'validation' && (
          <div className="space-y-4">
            {validationOutput ? (
              <>
                <div className="flex items-center gap-2">
                  <span className={validationOutput.isValid ? 'text-green-400' : 'text-red-400'}>
                    {validationOutput.isValid ? '✓ Valid' : '✗ Invalid'}
                  </span>
                </div>

                {validationOutput.errors.length > 0 && (
                  <div>
                    <div className="text-red-400 mb-2">Errors:</div>
                    <ul className="bg-red-900/20 p-3 rounded text-red-300 list-disc list-inside">
                      {validationOutput.errors.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {validationOutput.warnings.length > 0 && (
                  <div>
                    <div className="text-amber-400 mb-2">Warnings:</div>
                    <ul className="bg-amber-900/20 p-3 rounded text-amber-300 list-disc list-inside">
                      {validationOutput.warnings.map((warn, i) => (
                        <li key={i}>{warn}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {validationOutput.missingRequired.length > 0 && (
                  <div>
                    <div className="text-red-400 mb-2">Missing Required Fields:</div>
                    <div className="bg-neutral-800 p-3 rounded">
                      <code className="text-red-300">{validationOutput.missingRequired.join(', ')}</code>
                    </div>
                  </div>
                )}

                {validationOutput.missingRecommended.length > 0 && (
                  <div>
                    <div className="text-amber-400 mb-2">Missing Recommended Fields:</div>
                    <div className="bg-neutral-800 p-3 rounded">
                      <code className="text-amber-300">{validationOutput.missingRecommended.join(', ')}</code>
                    </div>
                  </div>
                )}

                {validationOutput.isValid && validationOutput.warnings.length === 0 && (
                  <div className="text-green-400 bg-green-900/20 p-3 rounded">
                    ✓ Schema passes all validation checks
                  </div>
                )}
              </>
            ) : (
              <div className="text-neutral-500">No schema loaded</div>
            )}
          </div>
        )}

        {activeTab === 'cache' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-neutral-500 mb-1">Cache Status</div>
                <div className={cacheInfo.isCached ? 'text-green-400' : 'text-amber-400'}>
                  {cacheInfo.isCached ? '✓ Cached' : '○ Not Cached'}
                </div>
              </div>
              <div>
                <div className="text-neutral-500 mb-1">Stale</div>
                <div className={cacheInfo.isStale ? 'text-amber-400' : 'text-green-400'}>
                  {cacheInfo.isStale ? '⚠ Stale' : '✓ Fresh'}
                </div>
              </div>
              <div>
                <div className="text-neutral-500 mb-1">Fetched At</div>
                <div>{cacheInfo.fetchedAt?.toLocaleString() || '—'}</div>
              </div>
              <div>
                <div className="text-neutral-500 mb-1">Expires At</div>
                <div>{cacheInfo.expiresAt?.toLocaleString() || '—'}</div>
              </div>
              <div>
                <div className="text-neutral-500 mb-1">TTL Remaining</div>
                <div>
                  {cacheInfo.ttlRemaining !== null 
                    ? `${Math.floor(cacheInfo.ttlRemaining / 60)}m ${cacheInfo.ttlRemaining % 60}s`
                    : '—'}
                </div>
              </div>
              <div>
                <div className="text-neutral-500 mb-1">Fetch Count</div>
                <div>{cacheInfo.fetchCount}</div>
              </div>
              <div>
                <div className="text-neutral-500 mb-1">Version</div>
                <div>{cacheInfo.version || '—'}</div>
              </div>
              <div>
                <div className="text-neutral-500 mb-1">API Version</div>
                <div>{cacheInfo.apiVersion || '—'}</div>
              </div>
              <div>
                <div className="text-neutral-500 mb-1">Last Successful Fetch</div>
                <div>{cacheInfo.lastSuccessfulFetch?.toLocaleString() || '—'}</div>
              </div>
              <div>
                <div className="text-neutral-500 mb-1">Last Error</div>
                <div className={cacheInfo.lastError ? 'text-red-400' : ''}>
                  {cacheInfo.lastError || '—'}
                </div>
              </div>
            </div>
            
            {cacheInfo.lastErrorAt && (
              <div className="text-red-400 bg-red-900/20 p-3 rounded mt-4">
                Last error at: {cacheInfo.lastErrorAt.toLocaleString()}
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div>
            <div className="text-neutral-500 mb-2">Schema Refresh History (last 10):</div>
            {refreshHistory.length > 0 ? (
              <div className="space-y-2">
                {[...refreshHistory].reverse().map((event, i) => (
                  <div key={i} className="bg-neutral-800 p-3 rounded">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-blue-400">{event.reason}</span>
                      <span className="text-neutral-500">{event.timestamp.toLocaleString()}</span>
                    </div>
                    <div className="text-[10px] text-neutral-400">
                      {event.previousVersion ? `${event.previousVersion} → ` : ''}{event.newVersion}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-neutral-500 bg-neutral-800 p-3 rounded">
                No refresh events recorded
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 bg-neutral-800 border-t border-neutral-700 text-neutral-500 text-[10px]">
        Activated via ?debug=schema • Press refresh to force schema reload
      </div>
    </div>
  );
}

/**
 * Hook to check if debug mode is enabled
 */
export function useSchemaDebugMode(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('debug') === 'schema';
}
