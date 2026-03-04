/**
 * Frontend feature flags for dashboard enhancements
 * These control UI-only features that compute derived metrics from existing API data
 */

export const featureFlags = {
  /**
   * Show clicks per visitor as multiplier (e.g., "1.5×") instead of percentage
   * in the engagement funnel between unique visitors and outbound clicks
   */
  funnelClicksPerVisitor: true,

  /**
   * Flag vendors with high views but below-average CTR as optimization opportunities
   * Uses median-based heuristics computed from available vendor data
   */
  opportunityDetection: true,
};

/**
 * Thresholds for opportunity detection
 * A vendor is flagged if: views > medianViews AND CTR < medianCTR
 */
export const opportunityThresholds = {
  /**
   * Minimum vendors required to compute meaningful medians
   */
  minVendorsForMedian: 3,

  /**
   * Minimum views required for a vendor to be considered for opportunity flagging
   */
  minViewsForOpportunity: 10,

  /**
   * Minimum sample size for CTR calculation to be reliable
   */
  minViewsForCTR: 25,
};
