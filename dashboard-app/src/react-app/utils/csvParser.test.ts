import { describe, it, expect } from 'vitest';
import { parseVendorCSV } from './csvParser';

describe('parseVendorCSV', () => {
  it('should parse valid CSV correctly', () => {
    const csv = `date,views,unique_views,website_clicks,instagram_clicks,ctr
2024-01-01,100,80,10,5,15.0000
2024-01-02,150,120,15,8,15.3333
2024-01-03,200,160,20,12,16.0000`;

    const result = parseVendorCSV(csv);

    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toEqual({
      date: '2024-01-01',
      views: 100,
      uniqueViews: 80,
      websiteClicks: 10,
      instagramClicks: 5,
      ctr: 15.0000,
    });

    expect(result.totalViews).toBe(450);
    expect(result.totalUniqueViews).toBe(360);
    expect(result.totalWebsiteClicks).toBe(45);
    expect(result.totalInstagramClicks).toBe(25);
    expect(result.totalClicks).toBe(70);
    expect(result.averageCTR).toBeCloseTo(15.4444, 4);
  });

  it('should handle empty values as null', () => {
    const csv = `date,views,unique_views,website_clicks,instagram_clicks,ctr
2024-01-01,100,,10,5,
2024-01-02,,120,15,,15.3333`;

    const result = parseVendorCSV(csv);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].uniqueViews).toBeNull();
    expect(result.rows[0].ctr).toBeNull();
    expect(result.rows[1].views).toBeNull();
    expect(result.rows[1].instagramClicks).toBeNull();

    expect(result.totalViews).toBe(100);
    expect(result.totalUniqueViews).toBe(120);
    expect(result.totalWebsiteClicks).toBe(25);
    expect(result.totalInstagramClicks).toBe(5);
  });

  it('should handle zero values correctly', () => {
    const csv = `date,views,unique_views,website_clicks,instagram_clicks,ctr
2024-01-01,0,0,0,0,0.0000`;

    const result = parseVendorCSV(csv);

    expect(result.rows[0].views).toBe(0);
    expect(result.rows[0].uniqueViews).toBe(0);
    expect(result.rows[0].websiteClicks).toBe(0);
    expect(result.rows[0].instagramClicks).toBe(0);
    expect(result.rows[0].ctr).toBe(0);

    expect(result.totalViews).toBe(0);
    expect(result.totalClicks).toBe(0);
  });

  it('should handle missing data gracefully', () => {
    const csv = `date,views,unique_views,website_clicks,instagram_clicks,ctr
2024-01-01,100,80,10,5,`;

    const result = parseVendorCSV(csv);

    expect(result.rows[0].ctr).toBeNull();
    expect(result.averageCTR).toBeNull();
  });

  it('should calculate average CTR from server values only', () => {
    const csv = `date,views,unique_views,website_clicks,instagram_clicks,ctr
2024-01-01,100,80,10,5,15.0000
2024-01-02,150,120,15,8,
2024-01-03,200,160,20,12,16.0000`;

    const result = parseVendorCSV(csv);

    // Should average only the two valid CTR values (15.0000 and 16.0000)
    expect(result.averageCTR).toBe(15.5);
  });

  it('should handle empty CSV', () => {
    const csv = `date,views,unique_views,website_clicks,instagram_clicks,ctr`;

    const result = parseVendorCSV(csv);

    expect(result.rows).toHaveLength(0);
    expect(result.totalViews).toBe(0);
    expect(result.totalClicks).toBe(0);
    expect(result.averageCTR).toBeNull();
  });
});
