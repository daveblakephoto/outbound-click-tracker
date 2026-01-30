import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const explicitPath = process.argv[2] || process.env.SMLE_ANALYTICS_CONFIG_PATH;
const homeDir = process.env.HOME || "";
const candidatePaths = [
  explicitPath,
  "/Users/daveblake/Documents/GitHub/startmyloveengine/config/analytics.json",
  path.resolve(process.cwd(), "../startmyloveengine/config/analytics.json"),
  path.resolve(process.cwd(), "../../startmyloveengine/config/analytics.json"),
  homeDir ? path.join(homeDir, "Documents/GitHub/startmyloveengine/config/analytics.json") : "",
  homeDir ? path.join(homeDir, "GitHub/startmyloveengine/config/analytics.json") : "",
  homeDir ? path.join(homeDir, "startmyloveengine/config/analytics.json") : ""
].filter(Boolean);

let sourcePath = "";
for (const candidate of candidatePaths) {
  try {
    await fs.access(candidate);
    sourcePath = candidate;
    break;
  } catch {
    // keep looking
  }
}

if (!sourcePath) {
  console.warn(
    "Analytics config not found; using existing worker config without changes."
  );
  process.exit(0);
}

const destinationUrl = new URL("../config/analytics.json", import.meta.url);
const destinationPath = destinationUrl.pathname;

const raw = await fs.readFile(sourcePath, "utf8");
const data = JSON.parse(raw);

await fs.mkdir(path.dirname(destinationPath), { recursive: true });
await fs.writeFile(
  destinationPath,
  `${JSON.stringify(data, null, 2)}\n`,
  "utf8"
);

console.log(`Synced analytics config to ${destinationPath}`);
