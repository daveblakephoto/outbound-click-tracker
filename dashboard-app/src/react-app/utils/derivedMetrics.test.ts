import { describe, it, expect } from 'vitest';
import {
  calculateClicksPerVisitor,
  formatClicksPerVisitor,
  calculateCTR,
  calculateMedian,
  detectOpportunity,
  type VendorMetrics,
} from './derivedMetrics';

describe('calculateClicksPerVisitor', () => {
  it('calculates ratio correctly', () => {
    expect(calculateClicksPerVisitor(150, 100)).toBe(1.5);
    expect(calculateClicksPerVisitor(50, 100)).toBe(0.5);
    expect(calculateClicksPerVisitor(100, 100)).toBe(1);
  });

  it('returns null for zero or negative visitors', () => {
    expect(calculateClicksPerVisitor(100, 0)).toBeNull();
    expect(calculateClicksPerVisitor(100, -1)).toBeNull();
  });

  it('handles zero clicks', () => {
    expect(calculateClicksPerVisitor(0, 100)).toBe(0);
  });

  it('returns null for non-finite values', () => {
    expect(calculateClicksPerVisitor(Infinity, 100)).toBeNull();
    expect(calculateClicksPerVisitor(100, NaN)).toBeNull();
  });
});

describe('formatClicksPerVisitor', () => {
  it('formats ratio with multiplier symbol', () => {
    expect(formatClicksPerVisitor(150, 100)).toBe('1.50×');
    expect(formatClicksPerVisitor(75, 100)).toBe('0.75×');
  });

  it('returns dash for insufficient sample size', () => {
    expect(formatClicksPerVisitor(10, 5, 10)).toBe('—');
  });

  it('returns dash for zero visitors', () => {
    expect(formatClicksPerVisitor(100, 0)).toBe('—');
  });
});

describe('calculateCTR', () => {
  it('calculates CTR as percentage', () => {
    expect(calculateCTR(10, 100)).toBe(10);
    expect(calculateCTR(25, 100)).toBe(25);
  });

  it('returns null for zero views', () => {
    expect(calculateCTR(10, 0)).toBeNull();
  });

  it('handles zero clicks', () => {
    expect(calculateCTR(0, 100)).toBe(0);
  });
});

describe('calculateMedian', () => {
  it('calculates median for odd-length array', () => {
    expect(calculateMedian([1, 3, 5])).toBe(3);
    expect(calculateMedian([1, 2, 3, 4, 5])).toBe(3);
  });

  it('calculates median for even-length array', () => {
    expect(calculateMedian([1, 2, 3, 4])).toBe(2.5);
    expect(calculateMedian([1, 2])).toBe(1.5);
  });

  it('handles unsorted input', () => {
    expect(calculateMedian([5, 1, 3])).toBe(3);
  });

  it('returns null for empty array', () => {
    expect(calculateMedian([])).toBeNull();
  });

  it('returns single value for single-element array', () => {
    expect(calculateMedian([42])).toBe(42);
  });
});

describe('detectOpportunity', () => {
  const createVendors = (data: Array<{ views: number; clicks: number }>): VendorMetrics[] =>
    data.map((d, i) => ({
      name: `vendor-${i}`,
      views: d.views,
      clicks: d.clicks,
      ctr: d.views > 0 ? (d.clicks / d.views) * 100 : null,
    }));

  it('flags high-views low-CTR vendor as opportunity', () => {
    const vendors = createVendors([
      { views: 100, clicks: 20 }, // CTR 20%
      { views: 80, clicks: 16 },  // CTR 20%
      { views: 60, clicks: 12 },  // CTR 20%
      { views: 200, clicks: 10 }, // CTR 5% - high views, low CTR
    ]);

    const result = detectOpportunity(vendors[3], vendors);
    expect(result.isOpportunity).toBe(true);
    expect(result.reason).toBe('High traffic, below-average conversion');
  });

  it('does not flag vendor with low views', () => {
    const vendors = createVendors([
      { views: 100, clicks: 20 },
      { views: 80, clicks: 16 },
      { views: 60, clicks: 12 },
      { views: 30, clicks: 1 }, // Low views, low CTR - not flagged
    ]);

    const result = detectOpportunity(vendors[3], vendors);
    expect(result.isOpportunity).toBe(false);
  });

  it('does not flag vendor with high CTR', () => {
    const vendors = createVendors([
      { views: 100, clicks: 10 }, // CTR 10%
      { views: 80, clicks: 8 },   // CTR 10%
      { views: 60, clicks: 6 },   // CTR 10%
      { views: 200, clicks: 40 }, // CTR 20% - high views, high CTR
    ]);

    const result = detectOpportunity(vendors[3], vendors);
    expect(result.isOpportunity).toBe(false);
  });

  it('returns false when too few vendors', () => {
    const vendors = createVendors([
      { views: 100, clicks: 20 },
      { views: 200, clicks: 5 },
    ]);

    const result = detectOpportunity(vendors[1], vendors);
    expect(result.isOpportunity).toBe(false);
  });

  it('handles vendor with null views', () => {
    const vendors: VendorMetrics[] = [
      { name: 'v1', views: 100, clicks: 20, ctr: 20 },
      { name: 'v2', views: 80, clicks: 16, ctr: 20 },
      { name: 'v3', views: null, clicks: 10, ctr: null },
    ];

    const result = detectOpportunity(vendors[2], vendors);
    expect(result.isOpportunity).toBe(false);
  });

  it('provides median values in result', () => {
    const vendors = createVendors([
      { views: 100, clicks: 20 },
      { views: 80, clicks: 16 },
      { views: 60, clicks: 12 },
    ]);

    const result = detectOpportunity(vendors[0], vendors);
    expect(result.medianViews).toBe(80);
    expect(result.medianCTR).toBe(20);
  });
});
