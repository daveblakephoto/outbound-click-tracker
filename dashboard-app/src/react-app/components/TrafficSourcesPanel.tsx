import { useState } from 'react';

interface ReferrerData {
  source: string;
  count: number;
}

interface TrafficSourcesPanelProps {
  internal: ReferrerData[];
  external: ReferrerData[];
  vendorName?: string | null;
}

export default function TrafficSourcesPanel({
  internal,
  external,
  vendorName,
}: TrafficSourcesPanelProps) {
  const [expandedSection, setExpandedSection] = useState<'internal' | 'external' | null>(null);

  // Calculate total referrer counts
  const totalInternal = internal.reduce((sum, r) => sum + r.count, 0);
  const totalExternal = external.reduce((sum, r) => sum + r.count, 0);
  const totalReferrers = totalInternal + totalExternal;
  
  // Get max count for bar scaling
  const maxCount = Math.max(
    ...internal.map(r => r.count),
    ...external.map(r => r.count),
    1
  );

  // Validate data
  if (internal.some(r => isNaN(r.count) || !isFinite(r.count))) {
    console.warn('Invalid internal referrer data detected');
  }
  if (external.some(r => isNaN(r.count) || !isFinite(r.count))) {
    console.warn('Invalid external referrer data detected');
  }

  const renderBar = (count: number, color: string) => {
    const width = maxCount > 0 ? (count / maxCount) * 100 : 0;
    return (
      <div className="w-full bg-neutral-100 h-2 rounded-full overflow-hidden">
        <div 
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${width}%`, backgroundColor: color }}
        />
      </div>
    );
  };

  const renderPercentage = (count: number) => {
    if (totalReferrers === 0) return '—';
    const pct = (count / totalReferrers) * 100;
    return `${pct.toFixed(1)}%`;
  };

  const SourceRow = ({ source, count, color }: { source: string; count: number; color: string }) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-neutral-700 truncate max-w-[180px]" title={source}>
          {source}
        </span>
        <div className="flex items-center gap-3">
          <span className="text-neutral-400 text-xs tabular-nums">
            {renderPercentage(count)}
          </span>
          <span className="text-neutral-600 tabular-nums w-16 text-right">
            {count.toLocaleString()}
          </span>
        </div>
      </div>
      {renderBar(count, color)}
    </div>
  );

  if (internal.length === 0 && external.length === 0) {
    return null;
  }

  return (
    <div className="border border-neutral-200 p-6 mb-8">
      <h2 className="text-sm font-medium text-neutral-700 mb-4">
        {vendorName ? `${vendorName} – Traffic sources` : 'Traffic sources'}
      </h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Internal Sources */}
        <div>
          <button
            onClick={() => setExpandedSection(expandedSection === 'internal' ? null : 'internal')}
            className="flex items-center justify-between w-full text-left mb-3 group"
          >
            <div className="text-xs text-neutral-500 uppercase tracking-wider">
              Internal ({totalInternal.toLocaleString()})
            </div>
            <svg 
              className={`w-4 h-4 text-neutral-400 transition-transform ${expandedSection === 'internal' ? 'rotate-180' : ''}`}
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          
          {internal.length > 0 ? (
            <div className="space-y-3">
              {(expandedSection === 'internal' ? internal : internal.slice(0, 5)).map((ref, idx) => (
                <SourceRow 
                  key={idx} 
                  source={ref.source} 
                  count={ref.count} 
                  color="#2C2C2C" 
                />
              ))}
              {!expandedSection && internal.length > 5 && (
                <button 
                  onClick={() => setExpandedSection('internal')}
                  className="text-xs text-neutral-500 hover:text-neutral-700"
                >
                  +{internal.length - 5} more
                </button>
              )}
            </div>
          ) : (
            <div className="text-sm text-neutral-400">No internal referrers</div>
          )}
        </div>

        {/* External Sources */}
        <div>
          <button
            onClick={() => setExpandedSection(expandedSection === 'external' ? null : 'external')}
            className="flex items-center justify-between w-full text-left mb-3 group"
          >
            <div className="text-xs text-neutral-500 uppercase tracking-wider">
              External ({totalExternal.toLocaleString()})
            </div>
            <svg 
              className={`w-4 h-4 text-neutral-400 transition-transform ${expandedSection === 'external' ? 'rotate-180' : ''}`}
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          
          {external.length > 0 ? (
            <div className="space-y-3">
              {(expandedSection === 'external' ? external : external.slice(0, 5)).map((ref, idx) => (
                <SourceRow 
                  key={idx} 
                  source={ref.source} 
                  count={ref.count} 
                  color="#B8A15A" 
                />
              ))}
              {!expandedSection && external.length > 5 && (
                <button 
                  onClick={() => setExpandedSection('external')}
                  className="text-xs text-neutral-500 hover:text-neutral-700"
                >
                  +{external.length - 5} more
                </button>
              )}
            </div>
          ) : (
            <div className="text-sm text-neutral-400">No external referrers</div>
          )}
        </div>
      </div>
    </div>
  );
}
