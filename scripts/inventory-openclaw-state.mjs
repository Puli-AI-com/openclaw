#!/usr/bin/env node

import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSON5 from "json5";

const DEFAULT_STATE_DIR = "/home/node/.openclaw";
const DEFAULT_MAX_ENTRIES = 1_000_000;
const MAX_CONFIG_BYTES = 10 * 1024 * 1024;
const MAX_PROFILE_FILE_BYTES = 1024 * 1024;
const MANAGED_PROFILE_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "TOOLS.md",
  "HEARTBEAT.md",
];

const KNOWN_ENTRIES = new Map([
  ["openclaw.json", ["legacy-configuration", "do-not-persist"]],
  [".puli-runtime-openclaw.json", ["generated-configuration", "do-not-persist"]],
  [".env", ["runtime-input", "review"]],
  ["node.json", ["identity-state", "persist"]],
  ["update-check.json", ["reconstructable-state", "do-not-persist"]],
  ["agents", ["agent-and-session-state", "persist"]],
  ["workspace", ["customer-workspace", "persist"]],
  ["credentials", ["sensitive-operational-state", "persist"]],
  ["cron", ["scheduled-job-state", "persist"]],
  ["extensions", ["installed-code", "review"]],
  ["hooks", ["installed-code", "do-not-persist"]],
  ["media", ["customer-media", "persist"]],
  ["sandboxes", ["reconstructable-runtime-state", "do-not-persist"]],
  ["telegram", ["channel-state", "persist"]],
  ["logs", ["runtime-logs", "do-not-persist"]],
  ["canvas", ["customer-artifacts", "review"]],
  ["browser", ["reconstructable-runtime-state", "do-not-persist"]],
  ["identity", ["identity-state", "persist"]],
  ["settings", ["tenant-settings", "persist"]],
  ["delivery-queue", ["delivery-recovery-state", "persist"]],
  ["includes", ["legacy-configuration", "review"]],
  ["backups", ["migration-backups", "review"]],
  ["tools", ["reconstructable-tooling", "do-not-persist"]],
  ["discord", ["channel-state", "persist"]],
  ["packs", ["installed-code", "review"]],
  ["plugins", ["installed-code", "review"]],
  ["bundled", ["image-content", "do-not-persist"]],
]);

function describeEntry(name) {
  const exact = KNOWN_ENTRIES.get(name);
  if (exact) {
    return { category: exact[0], recommendation: exact[1], known: true };
  }
  if (name.startsWith("workspace-")) {
    return { category: "customer-workspace", recommendation: "persist", known: true };
  }
  if (["clawdbot.json", "moldbot.json", "moltbot.json"].includes(name)) {
    return { category: "legacy-configuration", recommendation: "review", known: true };
  }
  return { category: "unknown", recommendation: "review", known: false };
}

function displayEntryName(name) {
  if (KNOWN_ENTRIES.has(name) || ["clawdbot.json", "moldbot.json", "moltbot.json"].includes(name)) {
    return name;
  }
  if (name.startsWith("workspace-")) {
    return "workspace-redacted";
  }
  return "unknown-redacted";
}

function formatFor(name) {
  const extension = path.extname(name).toLowerCase();
  if (extension === ".json") {
    return "json";
  }
  if (extension === ".json5") {
    return "json5";
  }
  if (extension === ".jsonl") {
    return "jsonl";
  }
  if (extension === ".md") {
    return "markdown";
  }
  if (extension === ".yaml" || extension === ".yml") {
    return "yaml";
  }
  if (extension === ".txt") {
    return "text";
  }
  if (!extension) {
    return "extensionless";
  }
  return "other";
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function isWithinRoot(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

async function readFileNoFollow(filePath, maximumBytes, fileSystem) {
  let handle;
  try {
    handle = await fileSystem.open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
    const stat = await handle.stat();
    if (!stat.isFile()) {
      return { status: "not-a-file", bytes: stat.size };
    }
    if (stat.size > maximumBytes) {
      return { status: "too-large", bytes: stat.size };
    }
    const buffer = Buffer.alloc(maximumBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) {
        break;
      }
      offset += bytesRead;
    }
    if (offset > maximumBytes) {
      return { status: "too-large", bytes: Math.max(stat.size, offset) };
    }
    return { status: "read", bytes: offset, contents: buffer.subarray(0, offset) };
  } catch (error) {
    return { status: "unreadable", errorCode: error?.code || "UNKNOWN" };
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function inspectTopLevelEntry({ root, realRoot, name, fileSystem, budget, errors }) {
  const descriptor = describeEntry(name);
  const displayName = displayEntryName(name);
  const result = {
    name: displayName,
    ...descriptor,
    kind: "other",
    files: 0,
    directories: 0,
    symlinks: 0,
    bytes: 0,
    formats: [],
    truncated: false,
  };
  const formats = new Set();
  const topLevelPath = path.join(root, name);
  const stack = [topLevelPath];

  while (stack.length > 0) {
    if (budget.visited >= budget.maximum) {
      result.truncated = true;
      break;
    }
    const current = stack.pop();
    budget.visited += 1;
    let stat;
    try {
      stat = await fileSystem.lstat(current);
    } catch (error) {
      errors.push({
        topLevelEntry: displayName,
        operation: "lstat",
        code: error?.code || "UNKNOWN",
      });
      continue;
    }

    if (stat.isSymbolicLink()) {
      result.symlinks += 1;
      if (current === topLevelPath) {
        result.kind = "symlink";
      }
      continue;
    }
    if (stat.isDirectory()) {
      result.directories += 1;
      if (current === topLevelPath) {
        result.kind = "directory";
      }
      try {
        const realCurrent = await fileSystem.realpath(current);
        if (!isWithinRoot(realRoot, realCurrent)) {
          errors.push({
            topLevelEntry: displayName,
            operation: "boundary-check",
            code: "PATH_OUTSIDE_ROOT",
          });
          continue;
        }
        const directory = await fileSystem.opendir(current);
        for await (const child of directory) {
          if (budget.visited + stack.length >= budget.maximum) {
            result.truncated = true;
            break;
          }
          stack.push(path.join(current, child.name));
        }
      } catch (error) {
        errors.push({
          topLevelEntry: displayName,
          operation: "opendir",
          code: error?.code || "UNKNOWN",
        });
      }
      continue;
    }
    if (stat.isFile()) {
      result.files += 1;
      result.bytes += stat.size;
      formats.add(formatFor(current));
      if (current === topLevelPath) {
        result.kind = "file";
      }
      continue;
    }
    if (current === topLevelPath) {
      result.kind = "other";
    }
  }

  result.formats = [...formats].toSorted((left, right) => left.localeCompare(right));
  return result;
}

async function inspectLegacyConfig(root, fileSystem) {
  const configPath = path.join(root, "openclaw.json");
  let stat;
  try {
    stat = await fileSystem.lstat(configPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { exists: false, parseStatus: "missing" };
    }
    return { exists: true, parseStatus: "unreadable", errorCode: error?.code || "UNKNOWN" };
  }
  if (stat.isSymbolicLink()) {
    return { exists: true, parseStatus: "symlink-not-read", bytes: stat.size };
  }
  const readResult = await readFileNoFollow(configPath, MAX_CONFIG_BYTES, fileSystem);
  if (readResult.status !== "read") {
    return {
      exists: true,
      parseStatus: readResult.status,
      bytes: readResult.bytes ?? stat.size,
      ...(readResult.errorCode ? { errorCode: readResult.errorCode } : {}),
    };
  }

  const result = {
    exists: true,
    bytes: readResult.bytes,
    sha256: sha256(readResult.contents),
  };
  try {
    const parsed = JSON5.parse(readResult.contents.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...result, parseStatus: "invalid-root" };
    }
    return {
      ...result,
      parseStatus: "valid",
      topLevelFieldCount: Object.keys(parsed).length,
    };
  } catch {
    return { ...result, parseStatus: "invalid-json5" };
  }
}

async function inspectManagedWorkspaceFiles(root, fileSystem) {
  const results = [];
  for (const name of MANAGED_PROFILE_FILES) {
    const filePath = path.join(root, "workspace", name);
    try {
      const stat = await fileSystem.lstat(filePath);
      if (stat.isSymbolicLink()) {
        results.push({ name, status: "symlink-not-read", bytes: stat.size });
        continue;
      }
      const readResult = await readFileNoFollow(filePath, MAX_PROFILE_FILE_BYTES, fileSystem);
      if (readResult.status === "read") {
        results.push({
          name,
          bytes: readResult.bytes,
          sha256: sha256(readResult.contents),
        });
      } else {
        results.push({
          name,
          status: readResult.status,
          bytes: readResult.bytes ?? stat.size,
          ...(readResult.errorCode ? { errorCode: readResult.errorCode } : {}),
        });
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        results.push({ name, status: "unreadable", errorCode: error?.code || "UNKNOWN" });
      }
    }
  }
  return results;
}

export async function inventoryOpenClawState({
  root = process.env.OPENCLAW_STATE_DIR || DEFAULT_STATE_DIR,
  maxEntries = DEFAULT_MAX_ENTRIES,
  fileSystem = fs,
  now = () => new Date(),
} = {}) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new Error("maxEntries must be a positive safe integer");
  }
  const absoluteRoot = path.resolve(root);
  const rootStat = await fileSystem.lstat(absoluteRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`state root must be a directory, not a symlink: ${absoluteRoot}`);
  }

  const realRoot = await fileSystem.realpath(absoluteRoot);
  const errors = [];
  const budget = { visited: 0, maximum: maxEntries };
  const entries = [];
  let rootTruncated = false;
  const rootDirectory = await fileSystem.opendir(absoluteRoot);
  for await (const child of rootDirectory) {
    if (budget.visited >= budget.maximum) {
      rootTruncated = true;
      break;
    }
    entries.push(
      await inspectTopLevelEntry({
        root: absoluteRoot,
        realRoot,
        name: child.name,
        fileSystem,
        budget,
        errors,
      }),
    );
  }
  const sortedEntries = entries.toSorted((left, right) => left.name.localeCompare(right.name));

  const legacyConfig = await inspectLegacyConfig(absoluteRoot, fileSystem);
  const managedWorkspaceFiles = await inspectManagedWorkspaceFiles(absoluteRoot, fileSystem);
  const legacyConfigAnalysisComplete = [
    "missing",
    "valid",
    "invalid-json5",
    "invalid-root",
  ].includes(legacyConfig.parseStatus);
  const managedWorkspaceAnalysisComplete = managedWorkspaceFiles.every(
    (entry) => entry.status === undefined,
  );

  const totals = sortedEntries.reduce(
    (summary, entry) => ({
      files: summary.files + entry.files,
      directories: summary.directories + entry.directories,
      symlinks: summary.symlinks + entry.symlinks,
      bytes: summary.bytes + entry.bytes,
    }),
    { files: 0, directories: 0, symlinks: 0, bytes: 0 },
  );

  return {
    schemaVersion: 1,
    generatedAt: now().toISOString(),
    stateRoot: absoluteRoot,
    scan: {
      complete:
        !rootTruncated &&
        !sortedEntries.some((entry) => entry.truncated) &&
        errors.length === 0 &&
        legacyConfigAnalysisComplete &&
        managedWorkspaceAnalysisComplete,
      maxEntries,
      visitedEntries: budget.visited,
      errors,
      consistency: "best-effort-live-snapshot",
      requiresQuiescentTrustedStateForStrictBoundaryGuarantees: true,
    },
    totals,
    unknownTopLevelEntryCount: sortedEntries.filter((entry) => !entry.known).length,
    entries: sortedEntries,
    legacyConfig,
    managedWorkspaceFiles,
  };
}

function usage() {
  return [
    "Usage: node scripts/inventory-openclaw-state.mjs [--root PATH] [--max-entries N]",
    "",
    "Prints a read-only JSON inventory of an OpenClaw state directory to stdout.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      return { help: true };
    }
    if (argument === "--root") {
      options.root = argv[++index];
      if (!options.root) {
        throw new Error("--root requires a path");
      }
      continue;
    }
    if (argument === "--max-entries") {
      const raw = argv[++index];
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw new Error("--max-entries requires a positive integer");
      }
      options.maxEntries = parsed;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const report = await inventoryOpenClawState(options);
  console.log(JSON.stringify(report, null, 2));
  if (!report.scan.complete) {
    process.exitCode = 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`state inventory failed: ${error.message}`);
    process.exitCode = 1;
  });
}
