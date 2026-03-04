/**
 * Derived metrics utilities for frontend-only analytics computations
 * All calculations use existing API data without backend changes
 */

import { opportunityThresholds } from '../config/features';

/**
 * Calculate clicks per visitor ratio
 * Returns null if insufficient data
 */
export function calculateClicksPerVisitor(
  clicks: number,
  uniqueVisitors: number
): number | null {
  if (uniqueVisitors <= 0 || !Number.isFinite(clicks) || !Number.isFinite(uniqueVisitors)) {
    return null;
  }
  const ratio = clicks / uniqueVisitors;
  return Number.isFinite(ratio) ? ratio : null;
}

/**
 * Format clicks per visitor as multiplier string (e.g., "1.52×")
 * Returns "—" for invalid or insufficient data
 */
export function formatClicksPerVisitor(
  clicks: number,
  uniqueVisitors: number,
  minSampleSize: number = 1
): string {
  if (uniqueVisitors < minSampleSize) {
    return '—';
  }
  const ratio = calculateClicksPerVisitor(clicks, uniqueVisitors);
  if (ratio === null) {
    return '—';
  }
  return `${ratio.toFixed(2)}×`;
}

/**
 * Calculate CTR (click-through rate) as percentage
 * Returns null if insufficient data
 */
export function calculateCTR(
  clicks: number,
  views: number
): number | null {
  if (views <= 0 || !Number.isFinite(clicks) || !Number.isFinite(views)) {
    return null;
  }
  const ctr = (clicks / views) * 100;
  return Number.isFinite(ctr) ? ctr : null;
}

/**
 * Calculate median of an array of numbers
 * Returns null for empty arrays
 */
export function calculateMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export interface VendorMetrics {
  name: string;
  views: number | null;
  clicks: number;
  ctr: number | null;
}

export interface OpportunityResult {
  isOpportunity: boolean;
  reason: string | null;
  medianViews: number | null;
  medianCTR: number | null;
}

/**
 * Detect optimization opportunities using median-based heuristics
 * A vendor is flagged if: views > medianViews AND CTR < medianCTR
 * 
 * @param vendor - The vendor to evaluate
 * @param allVendors - All vendors for computing medians
 * @returns OpportunityResult with detection status and context
 */
export function detectOpportunity(
  vendor: VendorMetrics,
  allVendors: VendorMetrics[]
): OpportunityResult {
  const {
    minVendorsForMedian,
    minViewsForOpportunity,
    minViewsForCTR,
  } = opportunityThresholds;

  // Need enough vendors for meaningful comparison
  if (allVendors.length < minVendorsForMedian) {
    return {
      isOpportunity: false,
      reason: null,
      medianViews: null,
      medianCTR: null,
    };
  }

  // Vendor must have minimum views
  if (vendor.views === null || vendor.views < minViewsForOpportunity) {
    return {
      isOpportunity: false,
      reason: null,
      medianViews: null,
      medianCTR: null,
    };
  }

  // Calculate medians from vendors with sufficient data
  const vendorsWithViews = allVendors.filter(
    (v) => v.views !== null && v.views >= minViewsForOpportunity
  );

  if (vendorsWithViews.length < minVendorsForMedian) {
    return {
      isOpportunity: false,
      reason: null,
      medianViews: null,
      medianCTR: null,
    };
  }

  const viewsArray = vendorsWithViews.map((v) => v.views as number);
  const medianViews = calculateMedian(viewsArray);

  // Calculate CTRs for vendors with sufficient views
  const vendorsWithCTR = vendorsWithViews.filter(
    (v) => v.views !== null && v.views >= minViewsForCTR
  );

  if (vendorsWithCTR.length < minVendorsForMedian) {
    return {
      isOpportunity: false,
      reason: null,
      medianViews,
      medianCTR: null,
    };
  }

  const ctrArray = vendorsWithCTR
    .map((v) => {
      const ctr = calculateCTR(v.clicks, v.views as number);
      return ctr;
    })
    .filter((ctr): ctr is number => ctr !== null);

  if (ctrArray.length < minVendorsForMedian) {
    return {
      isOpportunity: false,
      reason: null,
      medianViews,
      medianCTR: null,
    };
  }

  const medianCTR = calculateMedian(ctrArray);

  if (medianViews === null || medianCTR === null) {
    return {
      isOpportunity: false,
      reason: null,
      medianViews,
      medianCTR,
    };
  }

  // Check if vendor meets opportunity criteria
  // High views (above median) AND low CTR (below median)
  const vendorCTR = calculateCTR(vendor.clicks, vendor.views);
  
  if (vendor.views < minViewsForCTR || vendorCTR === null) {
    return {
      isOpportunity: false,
      reason: null,
      medianViews,
      medianCTR,
    };
  }

  const isHighViews = vendor.views > medianViews;
  const isLowCTR = vendorCTR < medianCTR;

  if (isHighViews && isLowCTR) {
    return {
      isOpportunity: true,
      reason: 'High traffic, below-average conversion',
      medianViews,
      medianCTR,
    };
  }

  return {
    isOpportunity: false,
    reason: null,
    medianViews,
    medianCTR,
  };
}

/**
 * Cache key generator for derived stats
 */
export function getDerivedStatsCacheKey(site: string, range: string): string {
  return `derived-${site}-${range}`;
}
