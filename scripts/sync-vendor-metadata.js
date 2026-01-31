#!/usr/bin/env node
import fs from "fs";
import path from "path";

const SOURCE_URL =
  process.env.VENDOR_METADATA_URL ||
  "https://raw.githubusercontent.com/daveblakephoto/startmyloveengine/main/config/vendor-metadata.json";

const DEST_PATH = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "config",
  "vendor-metadata.json"
);

const writeJsonPretty = (filePath, data) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
};

const run = async () => {
  try {
    const res = await fetch(SOURCE_URL, { redirect: "follow" });
    if (!res.ok) {
      console.error(`Fetch failed ${res.status} ${res.statusText}`);
      process.exit(1);
    }
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (err) {
      console.error("Failed to parse JSON:", err.message);
      process.exit(1);
    }

    if (!json || typeof json !== "object") {
      console.error("Unexpected vendor-metadata schema: not an object");
      process.exit(1);
    }

    if (!json.vendors || Array.isArray(json.vendors)) {
      console.error(
        "Unexpected vendor-metadata schema: 'vendors' must be an object map of slug -> entry (not an array). Failing sync."
      );
      process.exit(1);
    }

    writeJsonPretty(DEST_PATH, json);
    console.log(`Synced vendor-metadata from ${SOURCE_URL} -> ${DEST_PATH}`);
  } catch (err) {
    console.error("Sync failed:", err.message);
    process.exit(1);
  }
};

run();
