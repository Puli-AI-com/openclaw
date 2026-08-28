import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withTempHome } from "./home-env.test-harness.js";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  createConfigIO,
  getRuntimeConfigSourceSnapshot,
  loadConfig,
  projectConfigOntoRuntimeSourceSnapshot,
  setRuntimeConfigSnapshotRefreshHandler,
  setRuntimeConfigSnapshot,
  writeConfigFile,
} from "./io.js";
import type { OpenClawConfig } from "./types.js";

function createSourceConfig(): OpenClawConfig {
  return {
    models: {
      providers: {
        openai: {
          baseUrl: "https://api.openai.com/v1",
          apiKey: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
          models: [],
        },
      },
    },
  };
}

function createRuntimeConfig(): OpenClawConfig {
  return {
    models: {
      providers: {
        openai: {
          baseUrl: "https://api.openai.com/v1",
          apiKey: "sk-runtime-resolved", // pragma: allowlist secret
          models: [],
        },
      },
    },
  };
}

function resetRuntimeConfigState(): void {
  setRuntimeConfigSnapshotRefreshHandler(null);
  clearRuntimeConfigSnapshot();
  clearConfigCache();
}

describe("runtime config snapshot writes", () => {
  it("returns the source snapshot when runtime snapshot is active", async () => {
    await withTempHome("openclaw-config-runtime-source-", async () => {
      const sourceConfig = createSourceConfig();
      const runtimeConfig = createRuntimeConfig();
      try {
        setRuntimeConfigSnapshot(runtimeConfig, sourceConfig);
        expect(getRuntimeConfigSourceSnapshot()).toEqual(sourceConfig);
      } finally {
        resetRuntimeConfigState();
      }
    });
  });

  it("skips source projection for non-runtime-derived configs", async () => {
    await withTempHome("openclaw-config-runtime-projection-shape-", async () => {
      const sourceConfig: OpenClawConfig = {
        ...createSourceConfig(),
        gateway: {
          auth: {
            mode: "token",
          },
        },
      };
      const runtimeConfig: OpenClawConfig = {
        ...createRuntimeConfig(),
        gateway: {
          auth: {
            mode: "token",
          },
        },
      };
      const independentConfig: OpenClawConfig = {
        models: {
          providers: {
            openai: {
              baseUrl: "https://api.openai.com/v1",
              apiKey: "sk-independent-config", // pragma: allowlist secret
              models: [],
            },
          },
        },
      };

      try {
        setRuntimeConfigSnapshot(runtimeConfig, sourceConfig);
        const projected = projectConfigOntoRuntimeSourceSnapshot(independentConfig);
        expect(projected).toBe(independentConfig);
      } finally {
        resetRuntimeConfigState();
      }
    });
  });

  it("clears runtime source snapshot when runtime snapshot is cleared", async () => {
    const sourceConfig = createSourceConfig();
    const runtimeConfig = createRuntimeConfig();

    setRuntimeConfigSnapshot(runtimeConfig, sourceConfig);
    resetRuntimeConfigState();
    expect(getRuntimeConfigSourceSnapshot()).toBeNull();
  });

  it("preserves source secret refs when writeConfigFile receives runtime-resolved config", async () => {
    await withTempHome("openclaw-config-runtime-write-", async (home) => {
      const configPath = path.join(home, ".openclaw", "openclaw.json");
      const sourceConfig = createSourceConfig();
      const runtimeConfig = createRuntimeConfig();

      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, `${JSON.stringify(sourceConfig, null, 2)}\n`, "utf8");

      try {
        setRuntimeConfigSnapshot(runtimeConfig, sourceConfig);
        expect(loadConfig().models?.providers?.openai?.apiKey).toBe("sk-runtime-resolved");

        await writeConfigFile(loadConfig());

        const persisted = JSON.parse(await fs.readFile(configPath, "utf8")) as {
          models?: { providers?: { openai?: { apiKey?: unknown } } };
        };
        expect(persisted.models?.providers?.openai?.apiKey).toEqual({
          source: "env",
          provider: "default",
          id: "OPENAI_API_KEY",
        });
      } finally {
        resetRuntimeConfigState();
      }
    });
  });

  it("refreshes the runtime snapshot after writes so follow-up reads see persisted changes", async () => {
    await withTempHome("openclaw-config-runtime-write-refresh-", async (home) => {
      const configPath = path.join(home, ".openclaw", "openclaw.json");
      const sourceConfig: OpenClawConfig = {
        models: {
          providers: {
            openai: {
              baseUrl: "https://api.openai.com/v1",
              apiKey: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
              models: [],
            },
          },
        },
      };
      const runtimeConfig: OpenClawConfig = {
        models: {
          providers: {
            openai: {
              baseUrl: "https://api.openai.com/v1",
              apiKey: "sk-runtime-resolved", // pragma: allowlist secret
              models: [],
            },
          },
        },
      };
      const nextRuntimeConfig: OpenClawConfig = {
        ...runtimeConfig,
        gateway: { auth: { mode: "token" as const } },
      };

      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, `${JSON.stringify(sourceConfig, null, 2)}\n`, "utf8");

      try {
        setRuntimeConfigSnapshot(runtimeConfig, sourceConfig);
        expect(loadConfig().gateway?.auth).toBeUndefined();

        await writeConfigFile(nextRuntimeConfig);

        expect(loadConfig().gateway?.auth).toEqual({ mode: "token" });
        expect(loadConfig().models?.providers?.openai?.apiKey).toBeDefined();

        let persisted = JSON.parse(await fs.readFile(configPath, "utf8")) as {
          gateway?: { auth?: unknown };
          models?: { providers?: { openai?: { apiKey?: unknown } } };
        };
        expect(persisted.gateway?.auth).toEqual({ mode: "token" });
        // Post-write secret-ref: apiKey must stay as source ref (not plaintext).
        expect(persisted.models?.providers?.openai?.apiKey).toEqual({
          source: "env",
          provider: "default",
          id: "OPENAI_API_KEY",
        });

        // Follow-up write: runtimeConfigSourceSnapshot must be restored so second write
        // still runs secret-preservation merge-patch and keeps apiKey as ref (not plaintext).
        await writeConfigFile(loadConfig());
        persisted = JSON.parse(await fs.readFile(configPath, "utf8")) as {
          gateway?: { auth?: unknown };
          models?: { providers?: { openai?: { apiKey?: unknown } } };
        };
        expect(persisted.models?.providers?.openai?.apiKey).toEqual({
          source: "env",
          provider: "default",
          id: "OPENAI_API_KEY",
        });
      } finally {
        clearRuntimeConfigSnapshot();
        clearConfigCache();
      }
    });
  });

  it("keeps the last-known-good runtime snapshot active while a specialized refresh is pending", async () => {
    await withTempHome("openclaw-config-runtime-refresh-pending-", async (home) => {
      const configPath = path.join(home, ".openclaw", "openclaw.json");
      const sourceConfig = createSourceConfig();
      const runtimeConfig = createRuntimeConfig();
      const nextRuntimeConfig: OpenClawConfig = {
        ...runtimeConfig,
        gateway: { auth: { mode: "token" as const } },
      };

      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, `${JSON.stringify(sourceConfig, null, 2)}\n`, "utf8");

      let releaseRefresh!: () => void;
      const refreshPending = new Promise<boolean>((resolve) => {
        releaseRefresh = () => resolve(true);
      });

      try {
        setRuntimeConfigSnapshot(runtimeConfig, sourceConfig);
        setRuntimeConfigSnapshotRefreshHandler({
          refresh: async ({ sourceConfig: refreshedSource }) => {
            expect(refreshedSource.gateway?.auth).toEqual({ mode: "token" });
            expect(loadConfig().gateway?.auth).toBeUndefined();
            return await refreshPending;
          },
        });

        const writePromise = writeConfigFile(nextRuntimeConfig);
        await Promise.resolve();

        expect(loadConfig().gateway?.auth).toBeUndefined();
        releaseRefresh();
        await writePromise;
      } finally {
        resetRuntimeConfigState();
      }
    });
  });

  it("writes generated runtime changes to the persistent override path", async () => {
    await withTempHome("openclaw-config-split-write-", async (home) => {
      const stateDir = path.join(home, "state");
      const runtimePath = path.join(home, "runtime", "openclaw.json");
      const persistPath = path.join(stateDir, "tenant-overrides.json");
      const previousEnv = {
        config: process.env.OPENCLAW_CONFIG_PATH,
        compatibility: process.env.OPENCLAW_COMPAT_CONFIG_PATH,
        persist: process.env.OPENCLAW_PERSIST_CONFIG_PATH,
        state: process.env.OPENCLAW_STATE_DIR,
        unset: process.env.OPENCLAW_PERSIST_CONFIG_UNSET_PATHS,
      };
      const sourceConfig: OpenClawConfig = {
        ...createSourceConfig(),
        agents: {
          defaults: { heartbeat: { every: "30m" } },
        },
      };
      const compatibilityPath = path.join(stateDir, "openclaw.json");
      const runtimeConfig: OpenClawConfig = {
        ...createRuntimeConfig(),
        hooks: {
          enabled: true,
          allowedAgentIds: ["paula"],
        },
        agents: {
          defaults: { heartbeat: { every: "0m" } },
          list: [{ id: "paula", default: true }],
        },
      };
      const nextRuntimeConfig: OpenClawConfig = {
        ...runtimeConfig,
        gateway: { auth: { mode: "token" } },
      };
      const runtimeFileConfig: OpenClawConfig = {
        ...sourceConfig,
        hooks: runtimeConfig.hooks,
        agents: runtimeConfig.agents,
      };

      await fs.mkdir(path.dirname(runtimePath), { recursive: true });
      await fs.mkdir(path.dirname(persistPath), { recursive: true });
      await fs.writeFile(runtimePath, `${JSON.stringify(runtimeFileConfig, null, 2)}\n`);
      await fs.writeFile(persistPath, `${JSON.stringify(sourceConfig, null, 2)}\n`);
      await fs.writeFile(compatibilityPath, "{}\n");
      process.env.OPENCLAW_CONFIG_PATH = runtimePath;
      process.env.OPENCLAW_COMPAT_CONFIG_PATH = compatibilityPath;
      process.env.OPENCLAW_PERSIST_CONFIG_PATH = persistPath;
      process.env.OPENCLAW_STATE_DIR = stateDir;
      process.env.OPENCLAW_PERSIST_CONFIG_UNSET_PATHS =
        "hooks,agents.list,agents.defaults.heartbeat";

      try {
        setRuntimeConfigSnapshot(runtimeConfig, sourceConfig);
        await writeConfigFile(nextRuntimeConfig);

        const persisted = JSON.parse(await fs.readFile(persistPath, "utf8")) as OpenClawConfig;
        expect(persisted.gateway?.auth).toEqual({ mode: "token" });
        expect(persisted.hooks).toBeUndefined();
        expect(persisted.agents?.list).toBeUndefined();
        expect(persisted.agents?.defaults?.heartbeat).toBeUndefined();
        expect(JSON.parse(await fs.readFile(runtimePath, "utf8"))).toEqual(runtimeFileConfig);
        expect(loadConfig().gateway?.auth).toEqual({ mode: "token" });
        const compatibility = JSON.parse(
          await fs.readFile(compatibilityPath, "utf8"),
        ) as OpenClawConfig;
        expect(compatibility.gateway?.auth).toEqual({ mode: "token" });
        expect(compatibility.hooks?.enabled).toBe(true);
        expect(compatibility.models?.providers?.openai?.apiKey).toEqual({
          source: "env",
          provider: "default",
          id: "OPENAI_API_KEY",
        });

        const directIo = createConfigIO();
        await directIo.writeConfigFile({
          ...loadConfig(),
          agents: {
            ...loadConfig().agents,
            defaults: {
              ...loadConfig().agents?.defaults,
              maxConcurrent: 2,
            },
          },
        });
        const persistedAfterDirectWrite = JSON.parse(
          await fs.readFile(persistPath, "utf8"),
        ) as OpenClawConfig;
        expect(persistedAfterDirectWrite.agents?.defaults?.maxConcurrent).toBe(2);
        expect(persistedAfterDirectWrite.agents?.list).toBeUndefined();
        expect(persistedAfterDirectWrite.agents?.defaults?.heartbeat).toBeUndefined();

        await expect(
          writeConfigFile({
            ...nextRuntimeConfig,
            hooks: { ...runtimeConfig.hooks, enabled: false },
          }),
        ).rejects.toThrow("Config path is image-managed and cannot be changed: hooks");
        await expect(
          writeConfigFile({
            ...nextRuntimeConfig,
            agents: {
              ...runtimeConfig.agents,
              defaults: { heartbeat: { every: "30m" } },
            },
          }),
        ).rejects.toThrow(
          "Config path is image-managed and cannot be changed: agents.defaults.heartbeat",
        );
      } finally {
        resetRuntimeConfigState();
        if (previousEnv.config === undefined) {
          delete process.env.OPENCLAW_CONFIG_PATH;
        } else {
          process.env.OPENCLAW_CONFIG_PATH = previousEnv.config;
        }
        if (previousEnv.compatibility === undefined) {
          delete process.env.OPENCLAW_COMPAT_CONFIG_PATH;
        } else {
          process.env.OPENCLAW_COMPAT_CONFIG_PATH = previousEnv.compatibility;
        }
        if (previousEnv.persist === undefined) {
          delete process.env.OPENCLAW_PERSIST_CONFIG_PATH;
        } else {
          process.env.OPENCLAW_PERSIST_CONFIG_PATH = previousEnv.persist;
        }
        if (previousEnv.state === undefined) {
          delete process.env.OPENCLAW_STATE_DIR;
        } else {
          process.env.OPENCLAW_STATE_DIR = previousEnv.state;
        }
        if (previousEnv.unset === undefined) {
          delete process.env.OPENCLAW_PERSIST_CONFIG_UNSET_PATHS;
        } else {
          process.env.OPENCLAW_PERSIST_CONFIG_UNSET_PATHS = previousEnv.unset;
        }
      }
    });
  });
});
