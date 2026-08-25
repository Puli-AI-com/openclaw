#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_CONFIG_PATH = "/app/default-config/openclaw.json";
const SOURCE_CONFIG_PATH = "/home/node/.openclaw/openclaw.json";
const RUNTIME_CONFIG_PATH = "/home/node/.openclaw/.puli-runtime-openclaw.json";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseDefaults(contents) {
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(`default OpenClaw config is not valid JSON: ${error.message}`, {
      cause: error,
    });
  }
  if (!isRecord(parsed) || !isRecord(parsed.hooks)) {
    throw new Error("default OpenClaw config must contain a hooks object");
  }
  return parsed;
}

async function sourceExists(sourceConfigPath, fileSystem) {
  try {
    const sourceStat = await fileSystem.lstat(sourceConfigPath);
    if (!sourceStat.isFile() && !sourceStat.isSymbolicLink()) {
      throw new Error("persisted OpenClaw config must be a file or symlink");
    }
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

async function writeRuntimeConfig(runtimeConfigPath, contents, fileSystem) {
  const directory = path.dirname(runtimeConfigPath);
  await fileSystem.mkdir(directory, { recursive: true, mode: 0o700 });

  const tempPath = `${runtimeConfigPath}.tmp-${process.pid}-${randomUUID()}`;
  let handle;
  try {
    handle = await fileSystem.open(tempPath, "wx", 0o600);
    await handle.chmod(0o600);
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fileSystem.rename(tempPath, runtimeConfigPath);
    await syncDirectory(directory, fileSystem);
  } catch (error) {
    await handle?.close().catch(() => {});
    await fileSystem.unlink(tempPath).catch(() => {});
    throw error;
  }
}

export async function createOpenClawRuntimeConfig({
  sourceConfigPath = SOURCE_CONFIG_PATH,
  runtimeConfigPath = RUNTIME_CONFIG_PATH,
  defaultConfigPath = DEFAULT_CONFIG_PATH,
  fileSystem = fs,
  beforePublish,
} = {}) {
  if (path.resolve(sourceConfigPath) === path.resolve(runtimeConfigPath)) {
    throw new Error("runtime OpenClaw config must not replace the persisted config");
  }

  const defaultBytes = await fileSystem.readFile(defaultConfigPath);
  const defaults = parseDefaults(defaultBytes.toString("utf8"));
  const hasSource = await sourceExists(sourceConfigPath, fileSystem);
  const runtimeConfig = hasSource
    ? {
        $include: sourceConfigPath,
        hooks: defaults.hooks,
      }
    : defaults;
  const runtimeBytes = Buffer.from(`${JSON.stringify(runtimeConfig, null, 2)}\n`);

  await beforePublish?.();
  await writeRuntimeConfig(runtimeConfigPath, runtimeBytes, fileSystem);
  return {
    status: hasSource ? "overlay-created" : "defaults-created",
    runtimeConfigPath,
  };
}

async function main() {
  const result = await createOpenClawRuntimeConfig({
    sourceConfigPath: process.env.OPENCLAW_SOURCE_CONFIG_PATH || SOURCE_CONFIG_PATH,
    runtimeConfigPath: process.env.OPENCLAW_CONFIG_PATH || RUNTIME_CONFIG_PATH,
    defaultConfigPath: process.env.OPENCLAW_DEFAULT_CONFIG_PATH || DEFAULT_CONFIG_PATH,
  });
  console.log(
    `entrypoint: OpenClaw runtime config ${result.status} at ${result.runtimeConfigPath}`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`entrypoint: OpenClaw runtime config creation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
