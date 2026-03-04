interface DataConfidenceBadgeProps {
  views: number;
  uniqueViews?: number;
  daysTracked?: number;
  className?: string;
  showDetails?: boolean;
}

type ConfidenceLevel = 'high' | 'medium' | 'low';

interface ConfidenceFactors {
  sampleSize: 'high' | 'medium' | 'low';
  trackingDuration: 'high' | 'medium' | 'low' | 'unknown';
}

export default function DataConfidenceBadge({ 
  views, 
  uniqueViews,
  daysTracked,
  className = '',
  showDetails = false,
}: DataConfidenceBadgeProps) {
  // Evaluate multiple confidence factors
  const factors: ConfidenceFactors = {
    sampleSize: views >= 100 ? 'high' : views >= 25 ? 'medium' : 'low',
    trackingDuration: daysTracked === undefined ? 'unknown' 
      : daysTracked >= 14 ? 'high' 
      : daysTracked >= 7 ? 'medium' 
      : 'low',
  };
  
  // Compute overall confidence (conservative: use the lowest factor)
  let level: ConfidenceLevel;
  const factorValues = [factors.sampleSize];
  if (factors.trackingDuration !== 'unknown') {
    factorValues.push(factors.trackingDuration);
  }
  
  if (factorValues.every(f => f === 'high')) {
    level = 'high';
  } else if (factorValues.some(f => f === 'low')) {
    level = 'low';
  } else {
    level = 'medium';
  }
  
  const config = {
    high: {
      label: 'High confidence',
      color: 'bg-green-100 text-green-700 border-green-200',
      dotColor: 'bg-green-500',
    },
    medium: {
      label: 'Medium confidence',
      color: 'bg-amber-100 text-amber-700 border-amber-200',
      dotColor: 'bg-amber-500',
    },
    low: {
      label: 'Low confidence',
      color: 'bg-red-100 text-red-700 border-red-200',
      dotColor: 'bg-red-500',
    },
  };
  
  const { label, color, dotColor } = config[level];
  
  // Build detailed tooltip
  const tooltipLines = [
    `Sample size: ${views.toLocaleString()} views (${factors.sampleSize === 'high' ? '✓ ≥100' : factors.sampleSize === 'medium' ? '◐ 25-99' : '✗ <25'})`,
  ];
  
  if (uniqueViews !== undefined) {
    tooltipLines.push(`Unique visitors: ${uniqueViews.toLocaleString()}`);
  }
  
  if (daysTracked !== undefined) {
    tooltipLines.push(`Tracking duration: ${daysTracked} days (${factors.trackingDuration === 'high' ? '✓ ≥14' : factors.trackingDuration === 'medium' ? '◐ 7-13' : '✗ <7'})`);
  }
  
  tooltipLines.push('');
  tooltipLines.push(level === 'high' 
    ? 'Sufficient data for reliable metrics' 
    : level === 'medium' 
    ? 'Metrics may fluctuate with new data' 
    : 'Collect more data before drawing conclusions');
  
  const tooltipText = tooltipLines.join('\n');

  return (
    <span 
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium border rounded cursor-help ${color} ${className}`}
      title={tooltipText}
    >
      <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${dotColor}`} />
      {label}
      {showDetails && (
        <span className="ml-1 text-[10px] opacity-70">
          ({views >= 100 ? '100+' : views} views)
        </span>
      )}
    </span>
  );
}
