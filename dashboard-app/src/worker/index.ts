import { Hono } from "hono";
import { cors } from "hono/cors";

const app = new Hono<{ Bindings: Env }>();

app.use("/*", cors());

// Schema endpoint - proxy to analytics contract
app.get("/api/schema", async (c) => {
  const token = c.env.ANALYTICS_API_TOKEN;
  
  if (!token) {
    return c.json({ error: "Analytics service not configured" }, 500);
  }

  try {
    const response = await fetch("https://go.startmyloveengine.com/schema", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      console.error(`Schema fetch failed: ${response.status}`);
      return c.json({ error: "Schema fetch failed" }, 500);
    }

    const data = await response.json() as Record<string, unknown>;
    
    // Add cache headers - schema can be cached for 1 hour
    c.header("Cache-Control", "public, max-age=3600");
    
    return c.json(data);
  } catch (error) {
    console.error("Schema fetch error:", error);
    return c.json({ error: "service_unavailable" }, 500);
  }
});

// Endpoint to provide analytics token to frontend
app.get("/api/analytics-token", async (c) => {
  const token = c.env.ANALYTICS_API_TOKEN;
  
  if (!token) {
    return c.json({ error: "Analytics token not configured" }, 500);
  }
  
  return c.json({ token });
});

// Analytics API proxy endpoint
app.get("/api/analytics", async (c) => {
  const site = c.req.query("site");
  const range = c.req.query("range");
  const vendor = c.req.query("vendor");

  if (!site || !range) {
    return c.json({ error: "Missing required parameters" }, 400);
  }

  const token = c.env.ANALYTICS_API_TOKEN;
  if (!token) {
    return c.json({ error: "Analytics service not configured" }, 500);
  }

  try {
    let url = `https://go.startmyloveengine.com/api/stats?site=${encodeURIComponent(site)}&range=${encodeURIComponent(range)}`;
    if (vendor) {
      url += `&vendor=${encodeURIComponent(vendor)}`;
    }
    
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 401) {
      return c.json({ error: "unauthorized" }, 401);
    }

    if (response.status === 404) {
      return c.json({ error: "not_found" }, 404);
    }

    if (!response.ok) {
      return c.json({ error: "service_unavailable" }, 500);
    }

    const data = await response.json() as Record<string, unknown>;
    
    // Forward cache and correlation headers from upstream API
    const headersToForward = [
      'cache-control',
      'age',
      'etag',
      'x-request-id',
      'x-trace-id',
      'x-correlation-id',
      'traceparent',
      'x-cache',
      'cf-cache-status',
    ];
    
    for (const header of headersToForward) {
      const value = response.headers.get(header);
      if (value) {
        c.header(header, value);
      }
    }
    
    return c.json(data);
  } catch (error) {
    return c.json({ error: "service_unavailable" }, 500);
  }
});

export default app;
