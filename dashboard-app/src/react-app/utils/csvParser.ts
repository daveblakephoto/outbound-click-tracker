import Papa from 'papaparse';

export interface VendorCSVRow {
  date: string;
  views: number;
  uniqueViews: number;
  websiteClicks: number;
  instagramClicks: number;
  totalClicks: number;
  ctr: number;
}

export interface ParsedVendorCSV {
  rows: VendorCSVRow[];
  totalViews: number;
  totalUniqueViews: number;
  totalWebsiteClicks: number;
  totalInstagramClicks: number;
  totalClicks: number;
  averageCTR: number | null;
  sampleRow: VendorCSVRow | null;
  rawFields: string[];
  // AE/KV fallback headers
  responseHeaders?: {
    dataSource?: 'ae' | 'kv';
    dataWarning?: string;
    cache?: 'HIT' | 'MISS';
  };
}

/**
 * Coerce value to number using Number(), defaulting to 0 for invalid values
 */
const toNumber = (value: string | undefined): number => {
  if (value === undefined || value === null || value.trim() === '') {
    return 0;
  }
  const num = Number(value);
  return isNaN(num) ? 0 : num;
};

/**
 * Parse vendor CSV data from the authoritative export endpoint
 * 
 * CSV fields from API:
 * - date
 * - views
 * - unique_views
 * - website_clicks
 * - instagram_clicks
 * - ctr
 */
export function parseVendorCSV(csvText: string): ParsedVendorCSV {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim().toLowerCase(),
  });

  if (parsed.errors.length > 0) {
    console.warn('CSV parsing warnings:', parsed.errors);
  }

  // Log raw fields for debugging
  const rawFields = parsed.meta.fields || [];
  console.log('CSV raw fields:', rawFields);
  
  if (parsed.data.length > 0) {
    console.log('CSV first raw row:', parsed.data[0]);
  }

  // Normalize CSV rows to canonical shape
  const rows: VendorCSVRow[] = parsed.data.map(row => {
    // Map from CSV field names to canonical model
    // CSV uses: date, views, unique_views, website_clicks, instagram_clicks, ctr
    const views = toNumber(row.views);
    const uniqueViews = toNumber(row.unique_views);
    const websiteClicks = toNumber(row.website_clicks);
    const instagramClicks = toNumber(row.instagram_clicks);
    const totalClicks = websiteClicks + instagramClicks;
    const ctr = toNumber(row.ctr);

    return {
      date: row.date?.trim() || '',
      views,
      uniqueViews,
      websiteClicks,
      instagramClicks,
      totalClicks,
      ctr,
    };
  });

  // Calculate totals
  let totalViews = 0;
  let totalUniqueViews = 0;
  let totalWebsiteClicks = 0;
  let totalInstagramClicks = 0;
  let validCTRCount = 0;
  let ctrSum = 0;

  rows.forEach(row => {
    totalViews += row.views;
    totalUniqueViews += row.uniqueViews;
    totalWebsiteClicks += row.websiteClicks;
    totalInstagramClicks += row.instagramClicks;
    
    if (row.ctr > 0) {
      ctrSum += row.ctr;
      validCTRCount++;
    }
  });

  const totalClicks = totalWebsiteClicks + totalInstagramClicks;
  const averageCTR = validCTRCount > 0 ? ctrSum / validCTRCount : null;
  const sampleRow = rows.length > 0 ? rows[0] : null;

  console.log('CSV normalized sample:', sampleRow);
  console.log('CSV totals:', { totalViews, totalUniqueViews, totalWebsiteClicks, totalInstagramClicks, totalClicks });

  return {
    rows,
    totalViews,
    totalUniqueViews,
    totalWebsiteClicks,
    totalInstagramClicks,
    totalClicks,
    averageCTR,
    sampleRow,
    rawFields,
  };
}

/**
 * Fetch and parse vendor CSV from the authoritative export endpoint
 */
export async function fetchVendorCSV(
  vendor: string,
  range: '7d' | '28d' | '90d',
  apiToken: string,
  site: string = 'startmyloveengine'
): Promise<ParsedVendorCSV> {
  const url = `https://go.startmyloveengine.com/api/export/vendor.csv?site=${encodeURIComponent(site)}&vendor=${encodeURIComponent(vendor)}&range=${range}`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${apiToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`CSV fetch failed: ${response.status} ${response.statusText}`);
  }

  // Read AE/KV fallback headers (CORS exposes these)
  const dataSourceHeader = response.headers.get('X-Data-Source');
  const dataWarningHeader = response.headers.get('X-Data-Warning');
  const cacheHeader = response.headers.get('X-Cache');

  const csvText = await response.text();
  const parsed = parseVendorCSV(csvText);
  
  // Attach response headers to parsed result
  parsed.responseHeaders = {
    dataSource: dataSourceHeader === 'ae' || dataSourceHeader === 'kv' ? dataSourceHeader : undefined,
    dataWarning: dataWarningHeader || undefined,
    cache: cacheHeader === 'HIT' || cacheHeader === 'MISS' ? cacheHeader : undefined,
  };
  
  return parsed;
}
