/**
 * KpiRow - Responsive KPI display component
 * 
 * Mobile layout (≤768px):
 * - 2 columns per row, max 2 rows visible without scroll
 * - CTR + Confidence stacked below primary KPIs
 * - 12-14% reduced font size
 * - Compact confidence indicator (icon + tooltip)
 * 
 * Desktop layout:
 * - 5-column horizontal layout
 * - Full confidence badge
 */

import DataConfidenceBadge from './DataConfidenceBadge';
import { useMinSampleSizes } from '../contexts/SchemaContext';

interface KpiRowProps {
  totalViews: number;
  totalUniqueViews: number;
  totalClicks: number;
  totalWebsiteClicks: number;
  totalInstagramClicks: number;
  totalDaysTracked: number;
  selectedVendor: string | null;
  getDataMaturityMessage: () => string | null;
}

export default function KpiRow({
  totalViews,
  totalUniqueViews,
  totalClicks,
  totalWebsiteClicks,
  totalInstagramClicks,
  totalDaysTracked,
  selectedVendor,
  getDataMaturityMessage,
}: KpiRowProps) {
  const minSampleSizes = useMinSampleSizes();
  
  // Calculate derived metrics
  const clicksPerVisitor = totalUniqueViews > 0 ? totalClicks / totalUniqueViews : 0;
  const ctr = totalViews > 0 ? (totalClicks / totalViews) * 100 : 0;
  
  const maturityMessage = getDataMaturityMessage();

  return (
    <>
      {/* Desktop Layout - 5 columns */}
      <div className="hidden md:grid grid-cols-5 gap-6 mb-8">
        {/* Profile Views */}
        <div>
          <div className="flex items-center gap-2">
            <div className="text-4xl font-light text-neutral-900 tabular-nums">
              {totalViews > 0 ? totalViews.toLocaleString() : '—'}
            </div>
            {totalViews > 0 && (
              <DataConfidenceBadge 
                views={totalViews} 
                uniqueViews={totalUniqueViews} 
                daysTracked={totalDaysTracked} 
              />
            )}
          </div>
          <div className="text-xs text-neutral-500 mt-1 uppercase tracking-wider">
            {selectedVendor ? 'Profile views' : 'All Vendors – Profile views'}
          </div>
          {maturityMessage && (
            <div className="text-xs text-neutral-400 mt-1">{maturityMessage}</div>
          )}
        </div>
        
        {/* Unique Visitors */}
        <div>
          <div className="text-4xl font-light text-neutral-900 tabular-nums">
            {totalUniqueViews > 0 ? totalUniqueViews.toLocaleString() : '—'}
          </div>
          <div className="text-xs text-neutral-500 mt-1 uppercase tracking-wider">
            {selectedVendor ? 'Unique visitors' : 'All Vendors – Unique visitors'}
          </div>
        </div>
        
        {/* Outbound Clicks */}
        <div>
          <div className="text-4xl font-light text-neutral-900 tabular-nums">
            {totalClicks > 0 ? totalClicks.toLocaleString() : '—'}
          </div>
          <div className="text-xs text-neutral-500 mt-1 uppercase tracking-wider">
            {selectedVendor ? 'Outbound clicks' : 'All Vendors – Outbound clicks'}
          </div>
          {selectedVendor && (
            <div className="text-xs text-neutral-400 mt-1">
              {totalWebsiteClicks.toLocaleString()} web / {totalInstagramClicks.toLocaleString()} ig
            </div>
          )}
        </div>
        
        {/* Clicks per Visitor */}
        <div className="group relative">
          <div className="text-4xl font-light text-neutral-900 tabular-nums">
            {totalUniqueViews >= minSampleSizes.clicksPerVisitor 
              ? clicksPerVisitor.toFixed(1) : '—'}
          </div>
          <div className="text-xs text-neutral-500 mt-1 uppercase tracking-wider">Clicks per visitor</div>
          {totalUniqueViews < minSampleSizes.clicksPerVisitor && totalUniqueViews > 0 && (
            <div className="text-xs text-amber-600 mt-1">Low sample size ({totalUniqueViews} visitors)</div>
          )}
          <KpiTooltip
            title="Clicks per Visitor"
            formula="clicks ÷ unique_visitors"
            description="Average outbound clicks per unique visitor."
            note={`Requires ${minSampleSizes.clicksPerVisitor}+ unique visitors. Current: ${totalUniqueViews.toLocaleString()}.`}
          />
        </div>
        
        {/* CTR */}
        <div className="group relative">
          <div className="text-4xl font-light text-neutral-900 tabular-nums">
            {totalViews >= minSampleSizes.ctr ? `${ctr.toFixed(1)}%` : '—'}
          </div>
          <div className="text-xs text-neutral-500 mt-1 uppercase tracking-wider">
            {selectedVendor ? 'Click-through rate' : 'All Vendors – Click-through rate'}
          </div>
          {totalViews < minSampleSizes.ctr && totalViews > 0 && (
            <div className="text-xs text-amber-600 mt-1">Low sample size ({totalViews} views)</div>
          )}
          <KpiTooltip
            title="Click-through Rate (CTR)"
            formula="clicks ÷ views × 100"
            description="Percentage of views resulting in an outbound click."
            note={`Requires ${minSampleSizes.ctr}+ views. Current: ${totalViews.toLocaleString()}.`}
          />
        </div>
      </div>

      {/* Mobile Layout - 2x2 grid + CTR row */}
      <div className="md:hidden mb-8">
        {/* Primary metrics: 2x2 grid */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          {/* Profile Views */}
          <div className="bg-neutral-50 border border-neutral-200 p-4">
            <div className="flex items-center gap-2">
              <div className="text-2xl font-light text-neutral-900 tabular-nums">
                {totalViews > 0 ? totalViews.toLocaleString() : '—'}
              </div>
              {/* Compact confidence indicator on mobile */}
              {totalViews > 0 && (
                <CompactConfidenceBadge 
                  views={totalViews} 
                  uniqueViews={totalUniqueViews} 
                  daysTracked={totalDaysTracked} 
                />
              )}
            </div>
            <div className="text-[10px] text-neutral-500 mt-1 uppercase tracking-wider">
              Views
            </div>
          </div>
          
          {/* Unique Visitors */}
          <div className="bg-neutral-50 border border-neutral-200 p-4">
            <div className="text-2xl font-light text-neutral-900 tabular-nums">
              {totalUniqueViews > 0 ? totalUniqueViews.toLocaleString() : '—'}
            </div>
            <div className="text-[10px] text-neutral-500 mt-1 uppercase tracking-wider">
              Unique
            </div>
          </div>
          
          {/* Outbound Clicks */}
          <div className="bg-neutral-50 border border-neutral-200 p-4">
            <div className="text-2xl font-light text-neutral-900 tabular-nums">
              {totalClicks > 0 ? totalClicks.toLocaleString() : '—'}
            </div>
            <div className="text-[10px] text-neutral-500 mt-1 uppercase tracking-wider">
              Clicks
            </div>
          </div>
          
          {/* Clicks per Visitor */}
          <div className="bg-neutral-50 border border-neutral-200 p-4 group relative">
            <div className="text-2xl font-light text-neutral-900 tabular-nums">
              {totalUniqueViews >= minSampleSizes.clicksPerVisitor 
                ? clicksPerVisitor.toFixed(1) : '—'}
            </div>
            <div className="text-[10px] text-neutral-500 mt-1 uppercase tracking-wider">
              Clicks/Visitor
            </div>
          </div>
        </div>
        
        {/* CTR + Confidence row - full width */}
        <div className="bg-neutral-50 border border-neutral-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-2xl font-light text-neutral-900 tabular-nums">
                {totalViews >= minSampleSizes.ctr ? `${ctr.toFixed(1)}%` : '—'}
              </div>
              <div className="text-[10px] text-neutral-500 mt-1 uppercase tracking-wider">
                Click-through Rate
              </div>
            </div>
            
            {/* Confidence status */}
            <div className="text-right">
              <ConfidenceStatus 
                views={totalViews} 
                uniqueViews={totalUniqueViews}
                daysTracked={totalDaysTracked}
              />
            </div>
          </div>
          
          {/* Sample size warnings */}
          {(totalViews < minSampleSizes.ctr && totalViews > 0) && (
            <div className="text-xs text-amber-600 mt-2 pt-2 border-t border-neutral-200">
              Low sample: {totalViews} views (need {minSampleSizes.ctr}+)
            </div>
          )}
          {maturityMessage && (
            <div className="text-xs text-neutral-400 mt-1">{maturityMessage}</div>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Reusable KPI tooltip component
 */
function KpiTooltip({ 
  title, 
  formula, 
  description, 
  note 
}: { 
  title: string; 
  formula: string; 
  description: string; 
  note: string;
}) {
  return (
    <div className="absolute bottom-full left-0 mb-2 px-4 py-3 bg-neutral-900 text-white text-xs rounded shadow-lg z-10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none min-w-[240px]">
      <div className="font-medium mb-2">{title}</div>
      <div className="text-neutral-300 mb-2">
        <span className="text-neutral-500">Formula: </span>
        <code className="bg-neutral-800 px-1 rounded">{formula}</code>
      </div>
      <div className="text-neutral-200 mb-2">{description}</div>
      <div className="text-neutral-400 text-[11px] border-t border-neutral-700 pt-2 mt-2">
        {note}
      </div>
    </div>
  );
}

/**
 * Compact confidence badge for mobile - icon only with tooltip
 */
function CompactConfidenceBadge({ 
  views, 
  uniqueViews, 
  daysTracked 
}: { 
  views: number; 
  uniqueViews: number; 
  daysTracked: number;
}) {
  const level = getConfidenceLevel(views, uniqueViews, daysTracked);
  
  const colors = {
    high: 'text-green-600',
    medium: 'text-amber-500',
    low: 'text-red-500',
  };
  
  const icons = {
    high: '✓',
    medium: '◐',
    low: '!',
  };
  
  return (
    <span 
      className={`${colors[level]} text-sm cursor-help`}
      title={`${level.charAt(0).toUpperCase() + level.slice(1)} confidence: ${views} views, ${daysTracked} days`}
    >
      {icons[level]}
    </span>
  );
}

/**
 * Confidence status display for mobile CTR row
 */
function ConfidenceStatus({ 
  views, 
  uniqueViews, 
  daysTracked 
}: { 
  views: number; 
  uniqueViews: number; 
  daysTracked: number;
}) {
  const level = getConfidenceLevel(views, uniqueViews, daysTracked);
  
  const config = {
    high: { label: 'High confidence', color: 'text-green-600', bg: 'bg-green-50' },
    medium: { label: 'Moderate', color: 'text-amber-600', bg: 'bg-amber-50' },
    low: { label: 'Low confidence', color: 'text-red-600', bg: 'bg-red-50' },
  };
  
  const { label, color, bg } = config[level];
  
  return (
    <div className={`px-2 py-1 rounded text-[10px] ${color} ${bg}`}>
      {label}
    </div>
  );
}

/**
 * Calculate confidence level based on sample metrics
 */
function getConfidenceLevel(
  views: number, 
  _uniqueViews: number, 
  daysTracked: number
): 'high' | 'medium' | 'low' {
  if (views >= 100 && daysTracked >= 14) return 'high';
  if (views >= 25 && daysTracked >= 7) return 'medium';
  return 'low';
}
