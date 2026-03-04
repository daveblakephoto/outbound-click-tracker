/**
 * EngagementFunnel - Responsive engagement funnel component
 * 
 * Mobile layout (≤768px):
 * - Vertical stacked cards, full width
 * - Conversion % shown under each metric
 * - Arrows hidden
 * 
 * Desktop layout:
 * - Horizontal funnel with arrows between steps
 * - Conversion rates between steps
 */

import { featureFlags } from '../config/features';
import { formatClicksPerVisitor } from '../utils/derivedMetrics';

interface EngagementFunnelProps {
  totalViews: number;
  totalUniqueViews: number;
  totalClicks: number;
}

export default function EngagementFunnel({
  totalViews,
  totalUniqueViews,
  totalClicks,
}: EngagementFunnelProps) {
  if (totalViews <= 0) return null;

  // Calculate conversion rates
  const uniqueRate = totalViews > 0 ? ((totalUniqueViews / totalViews) * 100).toFixed(1) : '—';
  const clickRate = featureFlags.funnelClicksPerVisitor
    ? formatClicksPerVisitor(totalClicks, totalUniqueViews)
    : totalUniqueViews > 0 ? `${((totalClicks / totalUniqueViews) * 100).toFixed(1)}%` : '—';

  return (
    <div className="mb-8 border border-neutral-200 p-4 md:p-6">
      <h2 className="text-sm font-medium text-neutral-700 mb-4">Engagement funnel</h2>
      
      {/* Desktop Layout - Horizontal */}
      <div className="hidden md:flex items-center gap-4">
        <FunnelStep 
          value={totalViews} 
          label="Profile Views" 
        />
        <FunnelArrow rate={`${uniqueRate}%`} />
        <FunnelStep 
          value={totalUniqueViews} 
          label="Unique Visitors" 
        />
        <FunnelArrow 
          rate={clickRate} 
          tooltip={featureFlags.funnelClicksPerVisitor ? 'Average clicks per unique visitor' : undefined}
        />
        <FunnelStep 
          value={totalClicks} 
          label="Outbound Clicks" 
        />
      </div>

      {/* Mobile Layout - Vertical stacked cards */}
      <div className="md:hidden space-y-3">
        <MobileFunnelStep 
          value={totalViews} 
          label="Profile Views"
          sublabel={`100% of traffic`}
        />
        
        <MobileConversionIndicator rate={`${uniqueRate}%`} label="became unique visitors" />
        
        <MobileFunnelStep 
          value={totalUniqueViews} 
          label="Unique Visitors"
          sublabel={`${uniqueRate}% of views`}
        />
        
        <MobileConversionIndicator 
          rate={clickRate} 
          label={featureFlags.funnelClicksPerVisitor ? 'clicks per visitor' : 'clicked outbound'}
        />
        
        <MobileFunnelStep 
          value={totalClicks} 
          label="Outbound Clicks"
          sublabel={totalViews > 0 ? `${((totalClicks / totalViews) * 100).toFixed(1)}% of views` : '—'}
        />
      </div>
    </div>
  );
}

/**
 * Desktop funnel step
 */
function FunnelStep({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex-1">
      <div className="bg-neutral-50 border border-neutral-200 px-4 py-3 text-center">
        <div className="text-2xl font-light text-neutral-900 tabular-nums">
          {value.toLocaleString()}
        </div>
        <div className="text-xs text-neutral-500 mt-1 uppercase tracking-wider">
          {label}
        </div>
      </div>
    </div>
  );
}

/**
 * Desktop arrow with conversion rate
 */
function FunnelArrow({ rate, tooltip }: { rate: string; tooltip?: string }) {
  return (
    <div className="flex flex-col items-center px-2 group relative">
      <svg className="w-6 h-6 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
      <div className="text-xs text-neutral-600 font-medium mt-1 tabular-nums">
        {rate}
      </div>
      {tooltip && (
        <div className="absolute top-full mt-2 px-3 py-2 bg-neutral-900 text-white text-xs rounded shadow-lg z-10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
          {tooltip}
        </div>
      )}
    </div>
  );
}

/**
 * Mobile funnel step - full width card
 */
function MobileFunnelStep({ 
  value, 
  label, 
  sublabel 
}: { 
  value: number; 
  label: string; 
  sublabel: string;
}) {
  return (
    <div className="bg-neutral-50 border border-neutral-200 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-2xl font-light text-neutral-900 tabular-nums">
            {value.toLocaleString()}
          </div>
          <div className="text-xs text-neutral-500 mt-0.5 uppercase tracking-wider">
            {label}
          </div>
        </div>
        <div className="text-xs text-neutral-400 text-right">
          {sublabel}
        </div>
      </div>
    </div>
  );
}

/**
 * Mobile conversion indicator between steps
 */
function MobileConversionIndicator({ rate, label }: { rate: string; label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-1">
      <svg className="w-4 h-4 text-neutral-300 rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
      <span className="text-sm text-neutral-600">
        <span className="font-medium tabular-nums">{rate}</span>
        <span className="text-neutral-400 ml-1">{label}</span>
      </span>
    </div>
  );
}
