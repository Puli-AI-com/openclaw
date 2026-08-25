#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_CONFIG_PATH = "/app/default-config/openclaw.json";
const CONFIG_PATH = "/home/node/.openclaw/openclaw.json";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseObject(contents, label) {
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`, { cause: error });
  }
  if (!isRecord(parsed)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  return parsed;
}

async function readOptional(filePath, fileSystem) {
  try {
    return await fileSystem.readFile(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeDurableExclusive(filePath, contents, mode, fileSystem) {
  let handle;
  try {
    handle = await fileSystem.open(filePath, "wx", mode);
    await handle.writeFile(contents);
    await handle.sync();
  } catch (error) {
    await fileSystem.unlink(filePath).catch(() => {});
    throw error;
  } finally {
    await handle?.close();
  }
}

function backupPathFor(configPath) {
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  return `${configPath}.backup-${timestamp}-${process.pid}-${randomUUID()}`;
}

export async function reconcileOpenClawConfig({
  configPath = CONFIG_PATH,
  defaultConfigPath = DEFAULT_CONFIG_PATH,
  fileSystem = fs,
  beforeReplace,
} = {}) {
  const defaultBytes = await fileSystem.readFile(defaultConfigPath);
  const defaults = parseObject(defaultBytes.toString("utf8"), "default OpenClaw config");
  if (!isRecord(defaults.hooks)) {
    throw new Error("default OpenClaw config must contain a hooks object");
  }

  const originalBytes = await readOptional(configPath, fileSystem);
  let nextConfig;
  let mode = 0o600;

  if (originalBytes === null) {
    nextConfig = defaults;
  } else {
    const configStat = await fileSystem.lstat(configPath);
    if (!configStat.isFile()) {
      throw new Error("persisted OpenClaw config must be a regular file");
    }
    const current = parseObject(originalBytes.toString("utf8"), "persisted OpenClaw config");
    if (current.hooks !== undefined && !isRecord(current.hooks)) {
      throw new Error("persisted OpenClaw hooks setting must be an object");
    }
    nextConfig = {
      ...current,
      hooks: {
        ...current.hooks,
        ...defaults.hooks,
      },
    };
    mode = configStat.mode & 0o777;

    if (JSON.stringify(current) === JSON.stringify(nextConfig)) {
      return { status: "unchanged", backupPath: null };
    }
  }

  const directory = path.dirname(configPath);
  await fileSystem.mkdir(directory, { recursive: true });
  const tempPath = `${configPath}.tmp-${process.pid}-${randomUUID()}`;
  const nextBytes = Buffer.from(`${JSON.stringify(nextConfig, null, 2)}\n`);

  try {
    await writeDurableExclusive(tempPath, nextBytes, mode, fileSystem);
    await beforeReplace?.();

    let backupPath = null;
    if (originalBytes !== null) {
      const latestBytes = await fileSystem.readFile(configPath);
      if (!latestBytes.equals(originalBytes)) {
        throw new Error("persisted OpenClaw config changed during reconciliation");
      }

      backupPath = backupPathFor(configPath);
      await writeDurableExclusive(backupPath, originalBytes, mode, fileSystem);
    }

    await fileSystem.rename(tempPath, configPath);
    return {
      status: originalBytes === null ? "created" : "updated",
      backupPath,
    };
  } catch (error) {
    await fileSystem.unlink(tempPath).catch(() => {});
    throw error;
  }
}

async function main() {
  const result = await reconcileOpenClawConfig({
    configPath: process.env.OPENCLAW_CONFIG_PATH || CONFIG_PATH,
    defaultConfigPath: process.env.OPENCLAW_DEFAULT_CONFIG_PATH || DEFAULT_CONFIG_PATH,
  });
  const backup = result.backupPath ? `; backup=${result.backupPath}` : "";
  console.log(`entrypoint: OpenClaw config ${result.status}${backup}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`entrypoint: OpenClaw config reconciliation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
