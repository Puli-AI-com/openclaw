#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  acquireTenantOverridesLock,
  buildEffectiveConfig,
  parseConfigObject,
  resolveConfigStatePaths,
  writeFileAtomic,
} from "./config-state-separation.mjs";

export async function createOpenClawRuntimeConfig({
  tenantOverridesPath,
  runtimeConfigPath,
  defaultConfigPath,
  compatibilityConfigPath,
  env = process.env,
  fileSystem = fs,
  beforePublish,
} = {}) {
  const resolvedPaths = resolveConfigStatePaths(env);
  const overridesPath = tenantOverridesPath ?? resolvedPaths.tenantOverridesPath;
  const runtimePath = runtimeConfigPath ?? resolvedPaths.runtimeConfigPath;
  const defaultsPath = defaultConfigPath ?? resolvedPaths.defaultConfigPath;
  const compatibilityPath = compatibilityConfigPath ?? env.OPENCLAW_COMPAT_CONFIG_PATH?.trim();
  if (path.resolve(overridesPath) === path.resolve(runtimePath)) {
    throw new Error("runtime OpenClaw config must not replace tenant overrides");
  }
  if (
    compatibilityPath &&
    (path.resolve(compatibilityPath) === path.resolve(runtimePath) ||
      path.resolve(compatibilityPath) === path.resolve(overridesPath) ||
      path.resolve(compatibilityPath) === path.resolve(defaultsPath))
  ) {
    throw new Error("compatibility OpenClaw config must use the legacy state path");
  }
  const releaseOverridesLock = await acquireTenantOverridesLock(overridesPath, fileSystem);
  try {
    const defaultBytes = await fileSystem.readFile(defaultsPath);
    const overrideBytes = await fileSystem.readFile(overridesPath);
    const defaults = parseConfigObject(defaultBytes.toString("utf8"), "default OpenClaw config");
    const overrides = parseConfigObject(overrideBytes.toString("utf8"), "tenant overrides");
    const runtimeConfig = buildEffectiveConfig(defaults, overrides);
    const runtimeBytes = Buffer.from(`${JSON.stringify(runtimeConfig, null, 2)}\n`);

    await beforePublish?.();
    await writeFileAtomic(runtimePath, runtimeBytes, fileSystem);
    if (compatibilityPath) {
      await writeFileAtomic(compatibilityPath, runtimeBytes, fileSystem);
    }
    return {
      status: "effective-config-created",
      runtimeConfigPath: runtimePath,
    };
  } finally {
    await releaseOverridesLock();
  }
}

async function main() {
  const result = await createOpenClawRuntimeConfig();
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
