/**
 * Client-side performance diagnostics for API requests
 * Captures detailed timing, headers, and cache behavior
 */

const RESOURCE_TIMING_TIMEOUT_MS = 1000;
const RESOURCE_TIMING_BUFFER_SIZE = 500;
const RESOURCE_TIMING_MATCH_SLOP_MS = 5;

function selectResourceTimingEntry(
  entries: PerformanceResourceTiming[],
  targetUrl: string,
  fetchStart: number
): PerformanceResourceTiming | null {
  const exactMatches = entries.filter(entry => entry.name === targetUrl);
  if (!exactMatches.length) return null;

  const candidates = exactMatches.filter(
    entry => entry.startTime >= fetchStart - RESOURCE_TIMING_MATCH_SLOP_MS
  );
  const pool = candidates.length ? candidates : exactMatches;

  return pool.reduce((best, entry) => {
    const bestDelta = Math.abs(best.startTime - fetchStart);
    const entryDelta = Math.abs(entry.startTime - fetchStart);
    return entryDelta < bestDelta ? entry : best;
  });
}

async function getResourceTimingEntry(
  targetUrl: string,
  fetchStart: number
): Promise<PerformanceResourceTiming | null> {
  if (typeof performance === 'undefined') return null;

  if (typeof performance.setResourceTimingBufferSize === 'function') {
    performance.setResourceTimingBufferSize(RESOURCE_TIMING_BUFFER_SIZE);
  }

  const existing = selectResourceTimingEntry(
    performance.getEntriesByType('resource') as PerformanceResourceTiming[],
    targetUrl,
    fetchStart
  );
  if (existing) return existing;

  if (typeof PerformanceObserver === 'undefined') return null;

  return await new Promise(resolve => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const finish = (entry: PerformanceResourceTiming | null) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      resolve(entry);
    };

    const observer = new PerformanceObserver(list => {
      const entry = selectResourceTimingEntry(
        list.getEntries() as PerformanceResourceTiming[],
        targetUrl,
        fetchStart
      );
      if (entry) {
        observer.disconnect();
        finish(entry);
      }
    });

    try {
      observer.observe({ type: 'resource', buffered: true });
    } catch {
      observer.disconnect();
      finish(null);
      return;
    }

    timeoutId = setTimeout(() => {
      observer.disconnect();
      const lateEntry = selectResourceTimingEntry(
        performance.getEntriesByType('resource') as PerformanceResourceTiming[],
        targetUrl,
        fetchStart
      );
      finish(lateEntry || null);
    }, RESOURCE_TIMING_TIMEOUT_MS);
  });
}

export interface RequestDiagnostics {
  // Request details
  url: string;
  method: string;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  
  // Timing breakdown (Navigation Timing API)
  timing: {
    dns: number;
    tcp: number;
    tls: number;
    ttfb: number; // Time to first byte
    download: number;
    total: number;
  };
  
  // Response details
  status: number;
  responseHeaders: Record<string, string>;
  responseSize: number;
  compressed: boolean;
  compressionRatio?: number;
  
  // Cache behavior
  cache: {
    cacheControl?: string;
    age?: number;
    etag?: string;
    ifNoneMatch?: string;
    cacheHit: boolean;
    cdnCache?: string;
  };
  
  // Correlation IDs
  correlationIds: {
    requestId?: string;
    traceId?: string;
    traceparent?: string;
    correlationId?: string;
  };
  
  // Client context
  context: {
    browser: string;
    browserVersion: string;
    device: string;
    networkType?: string;
    connectionSpeed?: string;
    timestamp: string;
  };
  
  // Concurrent requests at time of fetch
  concurrentRequests: number;
  
  // App-side timing
  appTiming: {
    fetchStart: number;
    fetchEnd: number;
    duration: number;
    triggerEvent?: string;
  };
}

/**
 * Get browser and device context
 */
function getClientContext(): RequestDiagnostics['context'] {
  const ua = navigator.userAgent;
  let browser = 'Unknown';
  let browserVersion = 'Unknown';
  
  // Simple browser detection
  if (ua.includes('Chrome') && !ua.includes('Edg')) {
    browser = 'Chrome';
    const match = ua.match(/Chrome\/(\d+)/);
    browserVersion = match ? match[1] : 'Unknown';
  } else if (ua.includes('Firefox')) {
    browser = 'Firefox';
    const match = ua.match(/Firefox\/(\d+)/);
    browserVersion = match ? match[1] : 'Unknown';
  } else if (ua.includes('Safari') && !ua.includes('Chrome')) {
    browser = 'Safari';
    const match = ua.match(/Version\/(\d+)/);
    browserVersion = match ? match[1] : 'Unknown';
  } else if (ua.includes('Edg')) {
    browser = 'Edge';
    const match = ua.match(/Edg\/(\d+)/);
    browserVersion = match ? match[1] : 'Unknown';
  }
  
  // Device type
  const isMobile = /iPhone|iPad|iPod|Android/i.test(ua);
  const isTablet = /iPad|Android/i.test(ua) && !/Mobile/i.test(ua);
  const device = isMobile ? 'Mobile' : isTablet ? 'Tablet' : 'Desktop';
  
  // Network info if available
  const nav = navigator as Navigator & {
    connection?: {
      effectiveType?: string;
      downlink?: number;
    };
  };
  
  return {
    browser,
    browserVersion,
    device,
    networkType: nav.connection?.effectiveType,
    connectionSpeed: nav.connection?.downlink ? `${nav.connection.downlink} Mbps` : undefined,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Count concurrent fetch requests
 */
let activeFetches = 0;

/**
 * Instrumented fetch with full diagnostic capture
 */
export async function diagnosticFetch(
  url: string,
  options: RequestInit = {},
  triggerEvent?: string
): Promise<{ response: Response; diagnostics: RequestDiagnostics }> {
  activeFetches++;
  const concurrentRequests = activeFetches;
  
  const appFetchStart = performance.now();
  
  try {
    // Capture request details
    const requestHeaders: Record<string, string> = {};
    if (options.headers) {
      if (options.headers instanceof Headers) {
        options.headers.forEach((value, key) => {
          requestHeaders[key] = value;
        });
      } else if (Array.isArray(options.headers)) {
        options.headers.forEach(([key, value]) => {
          requestHeaders[key] = value;
        });
      } else {
        Object.assign(requestHeaders, options.headers);
      }
    }
    
    // Make the request
    const response = await fetch(url, options);
    
    const appFetchEnd = performance.now();
    
    // Capture response headers
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    
    // Get the final resolved URL
    const targetUrl = response.url || (() => {
      try {
        return new URL(url, window.location.href).toString();
      } catch {
        return url;
      }
    })();
    
    // Get detailed timing from Performance API using PerformanceObserver
    const entry = await getResourceTimingEntry(targetUrl, appFetchStart);
    
    let timing: RequestDiagnostics['timing'];
    
    if (entry) {
      timing = {
        dns: entry.domainLookupEnd - entry.domainLookupStart,
        tcp: entry.connectEnd - entry.connectStart,
        tls: entry.secureConnectionStart > 0 
          ? entry.connectEnd - entry.secureConnectionStart 
          : 0,
        ttfb: entry.responseStart - entry.requestStart,
        download: entry.responseEnd - entry.responseStart,
        total: entry.duration,
      };
    } else {
      // Fallback if Performance API entry not available
      timing = {
        dns: 0,
        tcp: 0,
        tls: 0,
        ttfb: 0,
        download: 0,
        total: appFetchEnd - appFetchStart,
      };
    }
    
    // Estimate response size
    const contentLength = responseHeaders['content-length'];
    const responseSize = contentLength ? parseInt(contentLength, 10) : 0;
    
    // Check compression
    const contentEncoding = responseHeaders['content-encoding'];
    const compressed = !!(contentEncoding && contentEncoding !== 'identity');
    
    // Cache behavior
    const cacheControl = responseHeaders['cache-control'];
    const age = responseHeaders['age'] ? parseInt(responseHeaders['age'], 10) : undefined;
    const etag = responseHeaders['etag'];
    const ifNoneMatch = requestHeaders['if-none-match'];
    const cacheHit = response.status === 304 || (age !== undefined && age > 0);
    const cdnCache = responseHeaders['x-cache'] || responseHeaders['cf-cache-status'];
    
    // Correlation IDs
    const correlationIds = {
      requestId: responseHeaders['x-request-id'],
      traceId: responseHeaders['x-trace-id'],
      traceparent: responseHeaders['traceparent'],
      correlationId: responseHeaders['x-correlation-id'],
    };
    
    const diagnostics: RequestDiagnostics = {
      url,
      method: options.method || 'GET',
      requestHeaders,
      requestBody: typeof options.body === 'string' ? options.body : undefined,
      timing,
      status: response.status,
      responseHeaders,
      responseSize,
      compressed,
      cache: {
        cacheControl,
        age,
        etag,
        ifNoneMatch,
        cacheHit,
        cdnCache,
      },
      correlationIds,
      context: getClientContext(),
      concurrentRequests,
      appTiming: {
        fetchStart: appFetchStart,
        fetchEnd: appFetchEnd,
        duration: appFetchEnd - appFetchStart,
        triggerEvent,
      },
    };
    
    return { response, diagnostics };
  } finally {
    activeFetches--;
  }
}

/**
 * Format diagnostics for logging/export
 */
export function formatDiagnostics(diag: RequestDiagnostics): string {
  const lines = [
    '=== Request Diagnostics ===',
    '',
    'Request:',
    `  URL: ${diag.url}`,
    `  Method: ${diag.method}`,
    `  Timestamp: ${diag.context.timestamp}`,
    `  Trigger: ${diag.appTiming.triggerEvent || 'Unknown'}`,
    '',
    'Timing Breakdown:',
    `  DNS:      ${diag.timing.dns.toFixed(2)}ms`,
    `  TCP:      ${diag.timing.tcp.toFixed(2)}ms`,
    `  TLS:      ${diag.timing.tls.toFixed(2)}ms`,
    `  TTFB:     ${diag.timing.ttfb.toFixed(2)}ms`,
    `  Download: ${diag.timing.download.toFixed(2)}ms`,
    `  Total:    ${diag.timing.total.toFixed(2)}ms`,
    '',
    'Response:',
    `  Status: ${diag.status}`,
    `  Size: ${diag.responseSize} bytes`,
    `  Compressed: ${diag.compressed ? 'Yes' : 'No'}`,
    '',
    'Cache:',
    `  Cache-Control: ${diag.cache.cacheControl || 'Not set'}`,
    `  Age: ${diag.cache.age !== undefined ? diag.cache.age + 's' : 'N/A'}`,
    `  ETag: ${diag.cache.etag || 'None'}`,
    `  Cache Hit: ${diag.cache.cacheHit ? 'Yes' : 'No'}`,
    `  CDN Cache: ${diag.cache.cdnCache || 'N/A'}`,
    '',
    'Correlation IDs:',
    `  Request ID: ${diag.correlationIds.requestId || 'None'}`,
    `  Trace ID: ${diag.correlationIds.traceId || 'None'}`,
    `  Traceparent: ${diag.correlationIds.traceparent || 'None'}`,
    `  Correlation ID: ${diag.correlationIds.correlationId || 'None'}`,
    '',
    'Client Context:',
    `  Browser: ${diag.context.browser} ${diag.context.browserVersion}`,
    `  Device: ${diag.context.device}`,
    `  Network: ${diag.context.networkType || 'Unknown'}`,
    `  Speed: ${diag.context.connectionSpeed || 'Unknown'}`,
    '',
    'Concurrency:',
    `  Parallel Requests: ${diag.concurrentRequests}`,
    '',
    'Request Headers:',
    ...Object.entries(diag.requestHeaders).map(([k, v]) => `  ${k}: ${v}`),
    '',
    'Response Headers:',
    ...Object.entries(diag.responseHeaders).map(([k, v]) => `  ${k}: ${v}`),
  ];
  
  return lines.join('\n');
}

/**
 * Export diagnostics as downloadable text file
 */
export function downloadDiagnostics(diag: RequestDiagnostics, filename?: string) {
  const content = formatDiagnostics(diag);
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `diagnostics-${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Generate HAR-like entry for a request
 */
export function toHAREntry(diag: RequestDiagnostics): Record<string, unknown> {
  return {
    startedDateTime: diag.context.timestamp,
    time: diag.timing.total,
    request: {
      method: diag.method,
      url: diag.url,
      httpVersion: 'HTTP/1.1',
      headers: Object.entries(diag.requestHeaders).map(([name, value]) => ({ name, value })),
      queryString: [],
      cookies: [],
      headersSize: -1,
      bodySize: diag.requestBody ? diag.requestBody.length : 0,
    },
    response: {
      status: diag.status,
      statusText: '',
      httpVersion: 'HTTP/1.1',
      headers: Object.entries(diag.responseHeaders).map(([name, value]) => ({ name, value })),
      cookies: [],
      content: {
        size: diag.responseSize,
        mimeType: diag.responseHeaders['content-type'] || 'application/json',
        compression: diag.compressed ? diag.responseSize : undefined,
      },
      redirectURL: '',
      headersSize: -1,
      bodySize: diag.responseSize,
    },
    cache: {
      beforeRequest: diag.cache.ifNoneMatch ? { eTag: diag.cache.ifNoneMatch } : undefined,
      afterRequest: diag.cache.etag ? { eTag: diag.cache.etag } : undefined,
    },
    timings: {
      blocked: -1,
      dns: diag.timing.dns,
      connect: diag.timing.tcp,
      ssl: diag.timing.tls,
      send: 0,
      wait: diag.timing.ttfb,
      receive: diag.timing.download,
    },
    serverIPAddress: '',
    connection: '',
  };
}
