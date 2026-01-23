export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /* ----------------------------
       CLICK TRACKING (PUBLIC)
       ---------------------------- */
    if (url.pathname === "/click") {
      if (request.method !== "GET") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "GET" }
        });
      }

      const vendor = url.searchParams.get("vendor");
      const type = url.searchParams.get("type"); // website | instagram
      const destination = url.searchParams.get("to");

      // Required params
      if (!vendor || !type || !destination) {
        return new Response("Missing parameters", { status: 400 });
      }

      // Vendor slug validation (safe KV keys)
      if (!/^[a-z0-9-]+$/.test(vendor)) {
        return new Response("Invalid vendor", { status: 400 });
      }

      // Click type allow-list
      if (!["website", "instagram"].includes(type)) {
        return new Response("Invalid type", { status: 400 });
      }

      // Destination URL validation
      let destUrl;
      try {
        destUrl = new URL(destination);
      } catch {
        return new Response("Invalid destination URL", { status: 400 });
      }

      // Normalise hostname (strip www)
      const hostname = destUrl.hostname.replace(/^www\./, "");

      // Destination allow-list
      const ALLOWED_DOMAINS = [
        "dave-blake.com",
        "startmyloveengine.com",
        "makeupartistbyronbay.com.au"
      ];

      const isAllowed =
        ALLOWED_DOMAINS.includes(hostname) ||
        hostname === "instagram.com" ||
        hostname.endsWith(".instagram.com");

      if (!isAllowed) {
        return new Response("Destination not allowed", { status: 403 });
      }

      // Daily KV key
      const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const key = `${vendor}:${type}:${date}`;

      const current = parseInt((await env.CLICKS.get(key)) || "0", 10);
      await env.CLICKS.put(key, String(current + 1));

      // Redirect
      return Response.redirect(destUrl.toString(), 302);
    }

    /* ----------------------------
       STATS API (AUTHENTICATED)
       ---------------------------- */
    if (url.pathname === "/api/stats") {
      if (request.method !== "GET") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "GET" }
        });
      }

      const auth = request.headers.get("Authorization");
      if (auth !== `Bearer ${env.ANALYTICS_API_TOKEN}`) {
        return new Response("Unauthorized", { status: 401 });
      }

      const site = url.searchParams.get("site");
      const range = url.searchParams.get("range") || "28d";

      if (!site) {
        return new Response("Missing site", { status: 400 });
      }

      const rangeDays = { "7d": 7, "28d": 28, "90d": 90 }[range];
      if (!rangeDays) {
        return new Response("Invalid range", { status: 400 });
      }

      // Build inclusive date window
      const today = new Date();
      const dates = [];
      for (let i = rangeDays - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        dates.push(d.toISOString().slice(0, 10));
      }

      const vendorAgg = {};
      const dailyTotals = Object.fromEntries(
        dates.map(d => [d, 0])
      );

      let cursor;
      do {
        const list = await env.CLICKS.list({ cursor });

        for (const key of list.keys) {
          const parts = key.name.split(":");
          if (parts.length !== 3) continue;

          const [vendor, type, date] = parts;
          if (!(date in dailyTotals)) continue;

          const value = parseInt(await env.CLICKS.get(key.name)) || 0;
          if (!value) continue;

          if (!vendorAgg[vendor]) {
            vendorAgg[vendor] = { website: 0, instagram: 0 };
          }

          vendorAgg[vendor][type] += value;
          dailyTotals[date] += value;
        }

        cursor = list.cursor;
      } while (cursor);

      const vendors = Object.entries(vendorAgg).map(
        ([vendor, counts]) => ({
          vendor,
          website: counts.website,
          instagram: counts.instagram
        })
      );

      const daily = dates.map(date => ({
        date,
        total: dailyTotals[date] || 0
      }));

      return new Response(
        JSON.stringify({
          site,
          range,
          generatedAt: new Date().toISOString(),
          vendors,
          daily
        }),
        {
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    return new Response("Not found", { status: 404 });
  },

  /* ----------------------------
     DAILY → MONTHLY ROLLUP (CRON)
     ---------------------------- */
  async scheduled(event, env) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 28);
    const cutoffDate = cutoff.toISOString().slice(0, 10);

    let cursor;
    do {
      const list = await env.CLICKS.list({ cursor });

      for (const key of list.keys) {
        const parts = key.name.split(":");
        if (parts.length !== 3) continue;

        const [vendor, type, date] = parts;
        if (date >= cutoffDate) continue;

        const month = date.slice(0, 7); // YYYY-MM
        const monthlyKey = `rollup:${vendor}:${type}:${month}`;

        const value = parseInt(await env.CLICKS.get(key.name)) || 0;
        if (value > 0) {
          const existing =
            parseInt(await env.CLICKS.get(monthlyKey)) || 0;

          await env.CLICKS.put(
            monthlyKey,
            String(existing + value)
          );
        }

        await env.CLICKS.delete(key.name);
      }

      cursor = list.cursor;
    } while (cursor);
  }
};
