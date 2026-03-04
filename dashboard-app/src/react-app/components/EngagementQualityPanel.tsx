/**
 * EngagementQualityPanel - Responsive engagement quality metrics
 * 
 * Mobile layout (≤768px):
 * - 2x2 grid for metrics
 * - Warning text in collapsible info row
 * - "Derived metrics" label hidden
 * 
 * Desktop layout:
 * - 4-column grid
 * - Full warning text visible
 */

import { useState } from 'react';

interface EngagementQualityProps {
  totalViews: number;
  totalUniqueViews: number;
  totalClicks: number;
  vendorName?: string | null;
}

interface DerivedMetric {
  label: string;
  shortLabel: string; // Abbreviated label for mobile
  value: string;
  formula: string;
  interpretation: string;
  sampleNote?: string;
  warning?: string;
}

export default function EngagementQualityPanel({
  totalViews,
  totalUniqueViews,
  totalClicks,
  vendorName,
}: EngagementQualityProps) {
  const [showInfo, setShowInfo] = useState(false);
  const metrics: DerivedMetric[] = [];
  
  // Minimum sample sizes for statistical validity
  const MIN_VIEWS_FOR_RATIOS = 10;
  const MIN_VIEWS_FOR_ENGAGEMENT = 25;
  
  // Validate inputs
  const hasValidData = !isNaN(totalViews) && !isNaN(totalUniqueViews) && !isNaN(totalClicks) 
    && isFinite(totalViews) && isFinite(totalUniqueViews) && isFinite(totalClicks);
  
  if (!hasValidData) {
    console.warn('EngagementQualityPanel: Invalid input data', { totalViews, totalUniqueViews, totalClicks });
  }

  // 1. Unique Visitor Rate
  const uniqueVisitorRate = totalViews > 0 ? (totalUniqueViews / totalViews) * 100 : 0;
  const repeatLoadRate = 100 - uniqueVisitorRate;
  
  if (totalViews >= MIN_VIEWS_FOR_RATIOS) {
    metrics.push({
      label: 'Unique Visitor Rate',
      shortLabel: 'Unique Rate',
      value: `${uniqueVisitorRate.toFixed(1)}%`,
      formula: 'unique_visitors ÷ total_views × 100',
      interpretation: uniqueVisitorRate >= 80 
        ? 'Healthy: Most views are from new visitors'
        : uniqueVisitorRate >= 50 
        ? 'Mixed: Balance of new and returning visitors'
        : 'High repeat traffic: Consider if this is expected',
      sampleNote: `Based on ${totalViews.toLocaleString()} views`,
      warning: repeatLoadRate > 60 ? 'High repeat load rate may indicate refresh loops or bots' : undefined,
    });
  } else {
    metrics.push({
      label: 'Unique Visitor Rate',
      shortLabel: 'Unique Rate',
      value: '—',
      formula: 'unique_visitors ÷ total_views × 100',
      interpretation: 'Percentage of views from distinct visitors',
      sampleNote: `Requires ${MIN_VIEWS_FOR_RATIOS}+ views (currently ${totalViews})`,
    });
  }

  // 2. Click Rate (CTR)
  const ctr = totalViews > 0 ? (totalClicks / totalViews) * 100 : 0;
  
  if (totalViews >= MIN_VIEWS_FOR_ENGAGEMENT) {
    metrics.push({
      label: 'Click Rate (CTR)',
      shortLabel: 'CTR',
      value: `${ctr.toFixed(1)}%`,
      formula: 'outbound_clicks ÷ total_views × 100',
      interpretation: ctr >= 10 
        ? 'Strong: High visitor engagement'
        : ctr >= 3 
        ? 'Typical: Normal click-through behavior'
        : 'Low: Visitors may not be finding what they need',
      sampleNote: `Based on ${totalViews.toLocaleString()} views`,
    });
  } else {
    metrics.push({
      label: 'Click Rate (CTR)',
      shortLabel: 'CTR',
      value: '—',
      formula: 'outbound_clicks ÷ total_views × 100',
      interpretation: 'Percentage of views resulting in outbound clicks',
      sampleNote: `Requires ${MIN_VIEWS_FOR_ENGAGEMENT}+ views (currently ${totalViews})`,
    });
  }

  // 3. Clicks per Unique Visitor
  const clicksPerVisitor = totalUniqueViews > 0 ? totalClicks / totalUniqueViews : 0;
  
  if (totalUniqueViews >= MIN_VIEWS_FOR_RATIOS) {
    metrics.push({
      label: 'Clicks per Visitor',
      shortLabel: 'Clicks/Visitor',
      value: clicksPerVisitor.toFixed(2),
      formula: 'outbound_clicks ÷ unique_visitors',
      interpretation: clicksPerVisitor >= 1.5 
        ? 'Highly engaged visitors clicking multiple links'
        : clicksPerVisitor >= 0.5 
        ? 'Moderate engagement with outbound content'
        : 'Low click engagement per visitor',
      sampleNote: `Based on ${totalUniqueViews.toLocaleString()} unique visitors`,
      warning: clicksPerVisitor > 5 ? 'Unusually high - verify tracking accuracy' : undefined,
    });
  } else {
    metrics.push({
      label: 'Clicks per Visitor',
      shortLabel: 'Clicks/Visitor',
      value: '—',
      formula: 'outbound_clicks ÷ unique_visitors',
      interpretation: 'Average outbound clicks per unique visitor',
      sampleNote: `Requires ${MIN_VIEWS_FOR_RATIOS}+ unique visitors (currently ${totalUniqueViews})`,
    });
  }

  // 4. Engagement Quality Assessment
  const hasEnoughData = totalViews >= MIN_VIEWS_FOR_ENGAGEMENT;
  let qualityAssessment: { label: string; level: 'good' | 'fair' | 'low' | 'insufficient' };
  
  if (!hasEnoughData) {
    qualityAssessment = { label: 'Insufficient data', level: 'insufficient' };
  } else if (ctr >= 5 && uniqueVisitorRate >= 60) {
    qualityAssessment = { label: 'Good', level: 'good' };
  } else if (ctr >= 2 && uniqueVisitorRate >= 40) {
    qualityAssessment = { label: 'Fair', level: 'fair' };
  } else {
    qualityAssessment = { label: 'Needs attention', level: 'low' };
  }
  
  metrics.push({
    label: 'Engagement Quality',
    shortLabel: 'Quality',
    value: qualityAssessment.label,
    formula: 'Qualitative: CTR ≥5% + Unique Rate ≥60% = Good',
    interpretation: qualityAssessment.level === 'insufficient'
      ? 'Collect more data for reliable assessment'
      : qualityAssessment.level === 'good'
      ? 'Strong click rates with healthy visitor mix'
      : qualityAssessment.level === 'fair'
      ? 'Acceptable engagement, room for improvement'
      : 'Review content or traffic sources',
    sampleNote: hasEnoughData 
      ? `CTR: ${ctr.toFixed(1)}%, Unique Rate: ${uniqueVisitorRate.toFixed(0)}%` 
      : `Requires ${MIN_VIEWS_FOR_ENGAGEMENT}+ views`,
  });

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'good': return 'text-green-700';
      case 'fair': return 'text-amber-700';
      case 'low': return 'text-red-700';
      default: return 'text-neutral-500';
    }
  };

  // Check if any warnings exist
  const hasWarnings = metrics.some(m => m.warning);
  const lowSampleWarning = totalViews < MIN_VIEWS_FOR_ENGAGEMENT;

  return (
    <div className="border border-neutral-200 p-4 md:p-6 mb-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium text-neutral-700">
          {vendorName ? `${vendorName} – Engagement quality` : 'Engagement quality'}
        </h2>
        {/* Hide "Derived metrics" label on mobile */}
        <span className="hidden md:inline text-xs text-neutral-400">Derived metrics</span>
      </div>
      
      {/* Desktop: 4-column grid */}
      <div className="hidden md:grid grid-cols-4 gap-6">
        {metrics.map((metric, idx) => (
          <MetricCard
            key={idx}
            metric={metric}
            qualityLevel={metric.label === 'Engagement Quality' ? qualityAssessment.level : undefined}
            getLevelColor={getLevelColor}
          />
        ))}
      </div>
      
      {/* Mobile: 2x2 grid */}
      <div className="md:hidden grid grid-cols-2 gap-4">
        {metrics.map((metric, idx) => (
          <MobileMetricCard
            key={idx}
            metric={metric}
            qualityLevel={metric.label === 'Engagement Quality' ? qualityAssessment.level : undefined}
            getLevelColor={getLevelColor}
          />
        ))}
      </div>
      
      {/* Collapsible info row for warnings (mobile) */}
      {(hasWarnings || lowSampleWarning) && (
        <div className="md:hidden mt-4">
          <button
            onClick={() => setShowInfo(!showInfo)}
            className="flex items-center gap-2 text-xs text-neutral-500 hover:text-neutral-700"
          >
            <svg 
              className={`w-4 h-4 transition-transform ${showInfo ? 'rotate-180' : ''}`}
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            {showInfo ? 'Hide details' : 'Show details'}
          </button>
          
          {showInfo && (
            <div className="mt-3 p-3 bg-neutral-50 border border-neutral-200 rounded text-xs space-y-2">
              {lowSampleWarning && (
                <div className="text-amber-600">
                  ⚠ Low sample size ({totalViews} views). Need {MIN_VIEWS_FOR_ENGAGEMENT - totalViews} more for stable readings.
                </div>
              )}
              {metrics.filter(m => m.warning).map((m, i) => (
                <div key={i} className="text-amber-600">
                  ⚠ {m.shortLabel}: {m.warning}
                </div>
              ))}
              <div className="text-neutral-500 pt-2 border-t border-neutral-200">
                Based on {totalViews.toLocaleString()} views and {totalUniqueViews.toLocaleString()} unique visitors
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* Desktop: Sample size footer */}
      <div className="hidden md:block mt-4 pt-4 border-t border-neutral-100 text-xs text-neutral-400">
        {totalViews >= MIN_VIEWS_FOR_ENGAGEMENT ? (
          <span>Metrics based on {totalViews.toLocaleString()} views and {totalUniqueViews.toLocaleString()} unique visitors</span>
        ) : (
          <span className="text-amber-600">
            ⚠ Low sample size ({totalViews} views). Metrics may be unreliable. Collect {MIN_VIEWS_FOR_ENGAGEMENT - totalViews} more views for stable readings.
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Desktop metric card with hover tooltip
 */
function MetricCard({ 
  metric, 
  qualityLevel,
  getLevelColor 
}: { 
  metric: DerivedMetric;
  qualityLevel?: string;
  getLevelColor: (level: string) => string;
}) {
  return (
    <div className="group relative">
      <div className={`text-2xl font-light tabular-nums ${
        qualityLevel ? getLevelColor(qualityLevel) : 'text-neutral-900'
      }`}>
        {metric.value}
      </div>
      <div className="text-xs text-neutral-500 mt-1 uppercase tracking-wider">
        {metric.label}
      </div>
      {metric.warning && (
        <div className="text-xs text-amber-600 mt-1 flex items-center gap-1">
          <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          {metric.warning}
        </div>
      )}
      {/* Tooltip */}
      <div className="absolute bottom-full left-0 mb-2 px-4 py-3 bg-neutral-900 text-white text-xs rounded shadow-lg z-10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none min-w-[240px] max-w-[300px]">
        <div className="font-medium mb-2">{metric.label}</div>
        <div className="text-neutral-300 mb-2">
          <span className="text-neutral-500">Formula: </span>
          <code className="bg-neutral-800 px-1 rounded">{metric.formula}</code>
        </div>
        <div className="text-neutral-200 mb-2">{metric.interpretation}</div>
        {metric.sampleNote && (
          <div className="text-neutral-400 text-[11px] border-t border-neutral-700 pt-2 mt-2">
            {metric.sampleNote}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Mobile metric card - compact with abbreviated label
 */
function MobileMetricCard({ 
  metric, 
  qualityLevel,
  getLevelColor 
}: { 
  metric: DerivedMetric;
  qualityLevel?: string;
  getLevelColor: (level: string) => string;
}) {
  return (
    <div className="bg-neutral-50 border border-neutral-200 p-3">
      <div className={`text-xl font-light tabular-nums ${
        qualityLevel ? getLevelColor(qualityLevel) : 'text-neutral-900'
      }`}>
        {metric.value}
      </div>
      <div className="text-[10px] text-neutral-500 mt-1 uppercase tracking-wider">
        {metric.shortLabel}
      </div>
      {metric.warning && (
        <div className="text-amber-500 text-[10px] mt-1">⚠</div>
      )}
    </div>
  );
}
