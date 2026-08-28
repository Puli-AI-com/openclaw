import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import JSON5 from "json5";

export const CONFIG_STATE_MIGRATION_VERSION = 1;
export const DEFAULT_STATE_DIR = "/home/node/.openclaw";
export const DEFAULT_CONFIG_PATH = "/app/default-config/openclaw.json";
export const DEFAULT_RUNTIME_CONFIG_PATH = "/tmp/puli-openclaw/openclaw.json";

const PROTECTED_PATHS = [
  ["meta"],
  ["hooks"],
  ["agents", "list"],
  ["agents", "defaults", "heartbeat"],
  ["skills", "load", "extraDirs"],
  // Strip the invalid legacy path written by the v1 compatibility config.
  ["gateway", "heartbeat"],
  ["gateway", "controlUi", "dangerouslyAllowHostHeaderOriginFallback"],
  ["gateway", "http", "endpoints", "chatCompletions"],
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function pathsEqual(left, right) {
  return path.resolve(left) === path.resolve(right);
}

function isProtectedPath(candidate) {
  return PROTECTED_PATHS.some(
    (protectedPath) =>
      candidate.length >= protectedPath.length &&
      protectedPath.every((segment, index) => candidate[index] === segment),
  );
}

function valuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function resolveConfigStatePaths(env = process.env) {
  const stateDir = path.resolve(env.OPENCLAW_STATE_DIR?.trim() || DEFAULT_STATE_DIR);
  const tenantOverridesPath = path.resolve(
    env.OPENCLAW_PERSIST_CONFIG_PATH?.trim() || path.join(stateDir, "tenant-overrides.json"),
  );
  const runtimeConfigPath = path.resolve(
    env.OPENCLAW_RUNTIME_CONFIG_PATH?.trim() ||
      env.OPENCLAW_CONFIG_PATH?.trim() ||
      DEFAULT_RUNTIME_CONFIG_PATH,
  );
  const defaultConfigPath = path.resolve(
    env.OPENCLAW_DEFAULT_CONFIG_PATH?.trim() || DEFAULT_CONFIG_PATH,
  );
  const legacyConfigPath = path.resolve(
    env.OPENCLAW_LEGACY_CONFIG_PATH?.trim() || path.join(stateDir, "openclaw.json"),
  );
  const migrationDir = path.join(
    stateDir,
    ".puli",
    "migrations",
    `config-state-separation-v${CONFIG_STATE_MIGRATION_VERSION}`,
  );
  const migrationMarkerPath = path.join(migrationDir, "migration.json");
  const legacyBackupPath = path.join(migrationDir, "openclaw.json");
  const migrationLockPath = path.join(stateDir, ".puli", "config-state-separation.lock");

  if (
    pathsEqual(runtimeConfigPath, tenantOverridesPath) ||
    pathsEqual(runtimeConfigPath, legacyConfigPath) ||
    pathsEqual(runtimeConfigPath, defaultConfigPath)
  ) {
    throw new Error("runtime OpenClaw config must use a separate ephemeral path");
  }

  return {
    stateDir,
    tenantOverridesPath,
    runtimeConfigPath,
    defaultConfigPath,
    legacyConfigPath,
    migrationDir,
    migrationMarkerPath,
    legacyBackupPath,
    migrationLockPath,
  };
}

export function parseConfigObject(contents, label) {
  let parsed;
  try {
    parsed = JSON5.parse(contents);
  } catch (error) {
    throw new Error(`${label} is not valid JSON5: ${error.message}`, { cause: error });
  }
  if (!isRecord(parsed)) {
    throw new Error(`${label} must contain an object`);
  }
  if ("$include" in parsed) {
    throw new Error(`${label} uses $include, which requires manual migration review`);
  }
  return parsed;
}

export function sanitizeTenantOverrides(value, pathSegments = []) {
  if (isProtectedPath(pathSegments)) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return structuredClone(value);
  }
  if (!isRecord(value)) {
    return value;
  }
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    const sanitized = sanitizeTenantOverrides(child, [...pathSegments, key]);
    if (sanitized !== undefined) {
      result[key] = sanitized;
    }
  }
  return result;
}

export function extractTenantOverrides(legacy, defaults, pathSegments = []) {
  if (isProtectedPath(pathSegments) || valuesEqual(legacy, defaults)) {
    return undefined;
  }
  if (Array.isArray(legacy) || !isRecord(legacy)) {
    return structuredClone(legacy);
  }

  const defaultRecord = isRecord(defaults) ? defaults : {};
  const result = {};
  for (const [key, value] of Object.entries(legacy)) {
    const extracted = extractTenantOverrides(value, defaultRecord[key], [...pathSegments, key]);
    if (extracted !== undefined) {
      result[key] = extracted;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function mergeConfigLayers(base, overlay) {
  if (Array.isArray(overlay)) {
    return structuredClone(overlay);
  }
  if (!isRecord(base) || !isRecord(overlay)) {
    return structuredClone(overlay);
  }
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(overlay)) {
    result[key] = key in result ? mergeConfigLayers(result[key], value) : structuredClone(value);
  }
  return result;
}

function getPath(source, pathSegments) {
  let current = source;
  for (const segment of pathSegments) {
    if (!isRecord(current) || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function setPath(target, pathSegments, value) {
  let current = target;
  for (const segment of pathSegments.slice(0, -1)) {
    if (!isRecord(current[segment])) {
      current[segment] = {};
    }
    current = current[segment];
  }
  current[pathSegments.at(-1)] = structuredClone(value);
}

export function buildEffectiveConfig(defaults, tenantOverrides) {
  const sanitizedOverrides = sanitizeTenantOverrides(tenantOverrides);
  const effective = mergeConfigLayers(defaults, sanitizedOverrides);
  for (const protectedPath of PROTECTED_PATHS) {
    const defaultValue = getPath(defaults, protectedPath);
    if (defaultValue !== undefined) {
      setPath(effective, protectedPath, defaultValue);
    }
  }

  if (!isRecord(effective.hooks) || effective.hooks.enabled !== true) {
    throw new Error("effective config must enable hooks");
  }
  const agents = effective.agents?.list;
  if (!Array.isArray(agents) || !agents.some((agent) => agent?.id === "paula")) {
    throw new Error("effective config must register the paula agent");
  }
  return effective;
}

async function pathExists(filePath, fileSystem) {
  try {
    await fileSystem.lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function syncDirectory(directory, fileSystem) {
  const handle = await fileSystem.open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writeFileAtomic(filePath, contents, fileSystem = fs) {
  const directory = path.dirname(filePath);
  await fileSystem.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  let handle;
  try {
    handle = await fileSystem.open(temporaryPath, "wx", 0o600);
    await handle.chmod(0o600);
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fileSystem.rename(temporaryPath, filePath);
    await syncDirectory(directory, fileSystem);
  } catch (error) {
    await handle?.close().catch(() => {});
    await fileSystem.unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

export async function acquireTenantOverridesLock(
  tenantOverridesPath,
  fileSystem = fs,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
) {
  const lockPath = `${tenantOverridesPath}.lock`;
  await fileSystem.mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      const handle = await fileSystem.open(lockPath, "wx", 0o600);
      await handle.writeFile(`${process.pid}\n`);
      await handle.close();
      return async () => {
        await fileSystem.unlink(lockPath).catch(() => {});
      };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      await sleep(100);
    }
  }
  throw new Error(`timed out waiting for tenant override lock: ${lockPath}`);
}

async function acquireMigrationLock(lockPath, fileSystem, now, sleep) {
  await fileSystem.mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const handle = await fileSystem.open(lockPath, "wx", 0o600);
      await handle.writeFile(
        `${JSON.stringify({ pid: process.pid, createdAt: now().toISOString() })}\n`,
      );
      await handle.close();
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      await sleep(500);
    }
  }
  throw new Error(`timed out waiting for config migration lock: ${lockPath}`);
}

export async function migrateConfigState({
  env = process.env,
  fileSystem = fs,
  now = () => new Date(),
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  const paths = resolveConfigStatePaths(env);
  await acquireMigrationLock(paths.migrationLockPath, fileSystem, now, sleep);
  try {
    if (await pathExists(paths.migrationMarkerPath, fileSystem)) {
      const marker = parseConfigObject(
        await fileSystem.readFile(paths.migrationMarkerPath, "utf8"),
        "config migration marker",
      );
      if (marker.version !== CONFIG_STATE_MIGRATION_VERSION || marker.status !== "completed") {
        throw new Error("config migration marker is incompatible or incomplete");
      }
      if (!(await pathExists(paths.tenantOverridesPath, fileSystem))) {
        throw new Error("config migration marker exists but tenant overrides are missing");
      }
      parseConfigObject(
        await fileSystem.readFile(paths.tenantOverridesPath, "utf8"),
        "tenant overrides",
      );
      return { status: "already-migrated", paths, marker };
    }

    const defaultsBytes = await fileSystem.readFile(paths.defaultConfigPath);
    const defaults = parseConfigObject(defaultsBytes.toString("utf8"), "default OpenClaw config");
    const legacyExists = await pathExists(paths.legacyConfigPath, fileSystem);
    const overridesExist = await pathExists(paths.tenantOverridesPath, fileSystem);
    let legacyBytes;
    let actualLegacyBackupPath = null;
    let overrides;
    let status;

    if (legacyExists) {
      legacyBytes = await fileSystem.readFile(paths.legacyConfigPath);
      actualLegacyBackupPath = paths.legacyBackupPath;
      if (await pathExists(actualLegacyBackupPath, fileSystem)) {
        const existingBackup = await fileSystem.readFile(actualLegacyBackupPath);
        if (!existingBackup.equals(legacyBytes)) {
          actualLegacyBackupPath = path.join(
            paths.migrationDir,
            `openclaw-${sha256(legacyBytes).slice(0, 12)}.json`,
          );
        }
      }
      if (!(await pathExists(actualLegacyBackupPath, fileSystem))) {
        await writeFileAtomic(actualLegacyBackupPath, legacyBytes, fileSystem);
      }
    }

    if (overridesExist) {
      overrides = parseConfigObject(
        await fileSystem.readFile(paths.tenantOverridesPath, "utf8"),
        "tenant overrides",
      );
      status = "adopted-existing-overrides";
    } else if (legacyBytes) {
      const legacy = parseConfigObject(legacyBytes.toString("utf8"), "legacy OpenClaw config");
      overrides = extractTenantOverrides(legacy, defaults) ?? {};
      await writeFileAtomic(
        paths.tenantOverridesPath,
        `${JSON.stringify(overrides, null, 2)}\n`,
        fileSystem,
      );
      status = "migrated-legacy-config";
    } else {
      overrides = {};
      await writeFileAtomic(paths.tenantOverridesPath, "{}\n", fileSystem);
      status = "initialized-empty-overrides";
    }

    buildEffectiveConfig(defaults, overrides);
    const marker = {
      version: CONFIG_STATE_MIGRATION_VERSION,
      status: "completed",
      result: status,
      migratedAt: now().toISOString(),
      imageDefaultsSha256: sha256(defaultsBytes),
      legacySourceSha256: legacyBytes ? sha256(legacyBytes) : null,
      legacyBackupFile: actualLegacyBackupPath ? path.basename(actualLegacyBackupPath) : null,
      tenantOverridesSha256: sha256(await fileSystem.readFile(paths.tenantOverridesPath)),
    };
    await writeFileAtomic(
      paths.migrationMarkerPath,
      `${JSON.stringify(marker, null, 2)}\n`,
      fileSystem,
    );
    return { status, paths, marker };
  } finally {
    await fileSystem.unlink(paths.migrationLockPath).catch(() => {});
  }
}
