// Optional hardening features:
// - CLICK_SIGNING_SECRET enables HMAC-signed click URLs
// - RATE_LIMIT_PER_MINUTE enables per-IP rate limiting
// Both are disabled unless explicitly configured
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const rateLimitPerMinute = 0;
    const signingSecret = undefined;
    // To enable:
    // const rateLimitPerMinute = Number(env.RATE_LIMIT_PER_MINUTE || 0);
    // const signingSecret = env.CLICK_SIGNING_SECRET;

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

      if (vendor.length > 64 || destination.length > 2048) {
        return new Response("Invalid parameters", { status: 400 });
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

      if (destUrl.protocol !== "https:" || destUrl.username || destUrl.password) {
        return new Response("Invalid destination URL", { status: 400 });
      }

      if (signingSecret) {
        const signature = url.searchParams.get("sig");
        if (!signature) {
          return new Response("Missing signature", { status: 401 });
        }

        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
          "raw",
          encoder.encode(signingSecret),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign", "verify"]
        );

        const payload = `${vendor}|${type}|${destination}`;
        const expected = await crypto.subtle.sign(
          "HMAC",
          key,
          encoder.encode(payload)
        );

        const expectedHex = Array.from(new Uint8Array(expected))
          .map(b => b.toString(16).padStart(2, "0"))
          .join("");

        if (signature !== expectedHex) {
          return new Response("Invalid signature", { status: 401 });
        }
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

      if (rateLimitPerMinute > 0) {
        const ip =
          request.headers.get("cf-connecting-ip") ||
          request.headers.get("x-forwarded-for");
        if (ip) {
          const minute = new Date().toISOString().slice(0, 16);
          const rateKey = `rl:${ip}:${minute}`;
          const current = parseInt((await env.CLICKS.get(rateKey)) || "0", 10);
          if (current >= rateLimitPerMinute) {
            return new Response("Rate limit exceeded", { status: 429 });
          }
          await env.CLICKS.put(rateKey, String(current + 1), {
            expirationTtl: 60
          });
        }
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
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
          }
        }
      );
    }

    return new Response("Not found", { status: 404 });
  },

  /* ----------------------------
     DAILY → MONTHLY ROLLUP (CRON)
     ---------------------------- */
  async scheduled(event, env) {
    const now = env.CRON_NOW ? new Date(env.CRON_NOW) : new Date();
    const cutoffDate = (() => {
      const year = now.getUTCFullYear();
      const monthIndex = now.getUTCMonth() - 2;
      const cutoff = new Date(Date.UTC(year, monthIndex, 1));
      return cutoff.toISOString().slice(0, 10);
    })();

    const lockKey = "rollup:lock";
    const lock = await env.CLICKS.get(lockKey);
    if (lock) {
      return;
    }

    await env.CLICKS.put(lockKey, now.toISOString(), {
      expirationTtl: 600
    });

    const snapshotRowsByMonth = new Map();

    let cursor;
    try {
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
            if (env.CLICKS_ARCHIVE) {
              await env.CLICKS_ARCHIVE.put(key.name, String(value));
            }
            if (env.CLICKS_SNAPSHOTS) {
              if (!snapshotRowsByMonth.has(month)) {
                snapshotRowsByMonth.set(month, []);
              }
              snapshotRowsByMonth.get(month).push(
                `${vendor},${type},${date},${value}`
              );
            }
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

      if (env.CLICKS_SNAPSHOTS) {
        const timestamp = now.toISOString().replace(/[:.]/g, "-");
        for (const [month, rows] of snapshotRowsByMonth.entries()) {
          const header = "vendor,type,date,count\n";
          const body = rows.join("\n");
          const csv = `${header}${body}\n`;
          await env.CLICKS_SNAPSHOTS.put(
            `snapshots/${month}/${timestamp}.csv`,
            csv
          );
        }
      }
    } finally {
      await env.CLICKS.delete(lockKey);
    }
  }
};
