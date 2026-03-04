import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const defaultTargetDir = path.join(repoRoot, "dashboard-app");
const defaultDownloadsDir = path.join(os.homedir(), "Downloads");
const defaultPattern = "Analytics Dashboard*.zip";
const defaultStateFile = path.join(repoRoot, ".cache", "dashboard-zip-sync-state.json");
const defaultIntervalMs = 3000;

const protectedPaths = [
  ".DS_Store",
  "node_modules",
  ".wrangler",
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.test",
];

function toRegexFromGlob(globPattern) {
  const escaped = globPattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function runOrThrow(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function parseArgs(argv) {
  const args = {
    watch: false,
    dryRun: false,
    zipPath: "",
    downloadsDir: defaultDownloadsDir,
    pattern: defaultPattern,
    targetDir: defaultTargetDir,
    stateFile: defaultStateFile,
    intervalMs: defaultIntervalMs,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--watch") {
      args.watch = true;
      continue;
    }
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--zip" && next) {
      args.zipPath = next;
      i += 1;
      continue;
    }
    if (arg === "--downloads" && next) {
      args.downloadsDir = next;
      i += 1;
      continue;
    }
    if (arg === "--pattern" && next) {
      args.pattern = next;
      i += 1;
      continue;
    }
    if (arg === "--target" && next) {
      args.targetDir = next;
      i += 1;
      continue;
    }
    if (arg === "--state-file" && next) {
      args.stateFile = next;
      i += 1;
      continue;
    }
    if (arg === "--interval-ms" && next) {
      args.intervalMs = Math.max(1000, Number(next) || defaultIntervalMs);
      i += 1;
      continue;
    }
  }

  return args;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listCandidateZips(downloadsDir, pattern) {
  const regex = toRegexFromGlob(pattern);
  const entries = await fs.readdir(downloadsDir, { withFileTypes: true });
  const candidates = [];

  for (const entry of entries) {
    if (!entry.isFile() || !regex.test(entry.name)) continue;
    const fullPath = path.join(downloadsDir, entry.name);
    const stats = await fs.stat(fullPath);
    candidates.push({
      path: fullPath,
      mtimeMs: stats.mtimeMs,
      size: stats.size,
    });
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates;
}

async function loadState(stateFile) {
  if (!(await exists(stateFile))) return {};
  try {
    const text = await fs.readFile(stateFile, "utf8");
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function saveState(stateFile, state) {
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2));
}

async function buildSignature(zipPath) {
  const stats = await fs.stat(zipPath);
  return `${zipPath}:${stats.mtimeMs}:${stats.size}`;
}

async function unzipAndSync(zipPath, targetDir, dryRun) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mocha-dashboard-sync-"));
  try {
    runOrThrow("unzip", ["-oq", zipPath, "-d", tmpDir]);

    const topEntries = await fs.readdir(tmpDir, { withFileTypes: true });
    let sourceRoot = tmpDir;
    if (topEntries.length === 1 && topEntries[0].isDirectory()) {
      sourceRoot = path.join(tmpDir, topEntries[0].name);
    }

    if (!dryRun) {
      await fs.mkdir(targetDir, { recursive: true });
    }

    const rsyncArgs = ["-a", "--itemize-changes", "--human-readable"];
    if (dryRun) rsyncArgs.push("--dry-run");
    for (const protectedPath of protectedPaths) {
      rsyncArgs.push(`--exclude=/${protectedPath}`);
    }
    rsyncArgs.push(`${sourceRoot}/`, `${targetDir}/`);

    runOrThrow("rsync", rsyncArgs);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function importOne({ zipPath, targetDir, dryRun }) {
  const fullZipPath = path.resolve(zipPath);
  const fullTarget = path.resolve(targetDir);
  console.log(`[mocha-dashboard-sync] Importing ${fullZipPath}`);
  console.log(`[mocha-dashboard-sync] Target: ${fullTarget}`);
  if (dryRun) {
    console.log("[mocha-dashboard-sync] Dry run mode");
  }

  await unzipAndSync(fullZipPath, fullTarget, dryRun);
  console.log("[mocha-dashboard-sync] Done");
}

async function runWatch({
  downloadsDir,
  pattern,
  targetDir,
  stateFile,
  intervalMs,
  dryRun,
}) {
  console.log(`[mocha-dashboard-sync] Watching ${downloadsDir}`);
  console.log(`[mocha-dashboard-sync] Pattern: ${pattern}`);
  console.log(`[mocha-dashboard-sync] Target: ${targetDir}`);
  console.log(`[mocha-dashboard-sync] Protected paths: ${protectedPaths.join(", ")}`);

  const state = await loadState(stateFile);
  let stableCandidate = null;
  let stableTicks = 0;

  while (true) {
    try {
      const [latest] = await listCandidateZips(downloadsDir, pattern);
      if (!latest) {
        stableCandidate = null;
        stableTicks = 0;
      } else {
        const signature = `${latest.path}:${latest.mtimeMs}:${latest.size}`;
        const alreadyImported = state.lastImportedSignature === signature;

        if (!alreadyImported) {
          if (stableCandidate === signature) {
            stableTicks += 1;
          } else {
            stableCandidate = signature;
            stableTicks = 1;
          }

          // Wait for two consecutive polls to avoid importing partial downloads.
          if (stableTicks >= 2) {
            await importOne({ zipPath: latest.path, targetDir, dryRun });
            state.lastImportedSignature = signature;
            state.lastImportedPath = latest.path;
            state.lastImportedAt = new Date().toISOString();
            await saveState(stateFile, state);
            stableCandidate = null;
            stableTicks = 0;
          }
        } else {
          stableCandidate = null;
          stableTicks = 0;
        }
      }
    } catch (error) {
      console.error("[mocha-dashboard-sync] Watch error:", error);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.zipPath) {
    const zipPath = path.resolve(args.zipPath);
    await importOne({
      zipPath,
      targetDir: args.targetDir,
      dryRun: args.dryRun,
    });
    if (!args.dryRun) {
      const state = await loadState(args.stateFile);
      state.lastImportedSignature = await buildSignature(zipPath);
      state.lastImportedPath = zipPath;
      state.lastImportedAt = new Date().toISOString();
      await saveState(args.stateFile, state);
    }
    return;
  }

  if (args.watch) {
    await runWatch(args);
    return;
  }

  const [latest] = await listCandidateZips(args.downloadsDir, args.pattern);
  if (!latest) {
    console.log("[mocha-dashboard-sync] No matching zip files found.");
    return;
  }

  const zipPath = path.resolve(latest.path);
  await importOne({
    zipPath,
    targetDir: args.targetDir,
    dryRun: args.dryRun,
  });
  if (!args.dryRun) {
    const state = await loadState(args.stateFile);
    state.lastImportedSignature = await buildSignature(zipPath);
    state.lastImportedPath = zipPath;
    state.lastImportedAt = new Date().toISOString();
    await saveState(args.stateFile, state);
  }
}

main().catch((error) => {
  console.error("[mocha-dashboard-sync] Failed:", error);
  process.exit(1);
});
