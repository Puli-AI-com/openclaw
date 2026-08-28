import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createOpenClawRuntimeConfig } from "./reconcile-openclaw-config.mjs";

const requiredHooks = {
  enabled: true,
  token: "${OPENCLAW_HOOKS_TOKEN}",
  allowedAgentIds: ["paula"],
  defaultSessionKey: "hook:rampup:default",
  allowRequestSessionKey: true,
  allowedSessionKeyPrefixes: ["hook:rampup:", "hook:jobs:", "hook:appctx:", "hook:appver:"],
};

const defaultsObject = {
  gateway: {
    controlUi: { dangerouslyAllowHostHeaderOriginFallback: true },
    http: { endpoints: { chatCompletions: { enabled: true } } },
  },
  hooks: requiredHooks,
  channels: { telegram: { groupPolicy: "open" } },
  agents: {
    defaults: {
      model: { primary: "litellm/claude-sonnet-4-6" },
      heartbeat: { every: "0m" },
    },
    list: [{ id: "paula", default: true }],
  },
  skills: { load: { extraDirs: ["/app/envoy-tools/skills"] } },
};
const defaults = `${JSON.stringify(defaultsObject)}\n`;

async function fixture(t, { overrides = "{}\n", defaultContents = defaults, runtime } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-runtime-config-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const stateDir = path.join(directory, "state");
  const tenantOverridesPath = path.join(stateDir, "tenant-overrides.json");
  const runtimeConfigPath = path.join(directory, "runtime", "openclaw.json");
  const defaultConfigPath = path.join(directory, "default.json");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(tenantOverridesPath, overrides);
  await fs.writeFile(defaultConfigPath, defaultContents);
  if (runtime !== undefined) {
    await fs.mkdir(path.dirname(runtimeConfigPath), { recursive: true });
    await fs.writeFile(runtimeConfigPath, runtime);
  }
  return {
    tenantOverridesPath,
    runtimeConfigPath,
    defaultConfigPath,
    directory,
    env: {
      OPENCLAW_STATE_DIR: stateDir,
      OPENCLAW_PERSIST_CONFIG_PATH: tenantOverridesPath,
      OPENCLAW_RUNTIME_CONFIG_PATH: runtimeConfigPath,
      OPENCLAW_DEFAULT_CONFIG_PATH: defaultConfigPath,
    },
  };
}

async function runtimeArtifacts(runtimeConfigPath) {
  try {
    return (await fs.readdir(path.dirname(runtimeConfigPath))).filter((name) =>
      name.startsWith("openclaw.json"),
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

void test("compiles defaults and explicit tenant overrides into a complete config", async (t) => {
  const overrides = `{
    // JSON5 tenant choices remain supported.
    channels: { telegram: { groupPolicy: 'allowlist', }, },
    agents: { defaults: { model: { primary: 'tenant/model' } } },
  }\n`;
  const paths = await fixture(t, { overrides });

  const result = await createOpenClawRuntimeConfig(paths);
  const runtime = JSON.parse(await fs.readFile(paths.runtimeConfigPath, "utf8"));

  assert.equal(result.status, "effective-config-created");
  assert.equal(runtime.channels.telegram.groupPolicy, "allowlist");
  assert.equal(runtime.agents.defaults.model.primary, "tenant/model");
  assert.deepEqual(runtime.agents.list, [{ id: "paula", default: true }]);
  assert.deepEqual(runtime.hooks, requiredHooks);
  assert.equal(await fs.readFile(paths.tenantOverridesPath, "utf8"), overrides);
  assert.deepEqual(await runtimeArtifacts(paths.runtimeConfigPath), ["openclaw.json"]);
});

void test("protected tenant paths cannot override image-owned structure", async (t) => {
  const paths = await fixture(t, {
    overrides: JSON.stringify({
      hooks: { enabled: false, allowedAgentIds: [] },
      agents: {
        defaults: { heartbeat: { every: "30m" } },
        list: [{ id: "other", default: true }],
      },
      skills: { load: { extraDirs: ["/tenant/path"] } },
      gateway: {
        heartbeat: { enabled: true },
        controlUi: { dangerouslyAllowHostHeaderOriginFallback: false },
      },
    }),
  });
  const compatibilityConfigPath = path.join(paths.directory, "state", "openclaw.json");

  await createOpenClawRuntimeConfig({
    ...paths,
    compatibilityConfigPath,
  });
  const runtime = JSON.parse(await fs.readFile(paths.runtimeConfigPath, "utf8"));
  const compatibility = JSON.parse(await fs.readFile(compatibilityConfigPath, "utf8"));

  assert.equal(runtime.hooks.enabled, true);
  assert.deepEqual(runtime.hooks.allowedAgentIds, ["paula"]);
  assert.deepEqual(runtime.agents.list, [{ id: "paula", default: true }]);
  assert.deepEqual(runtime.skills.load.extraDirs, ["/app/envoy-tools/skills"]);
  assert.equal(runtime.agents.defaults.heartbeat.every, "0m");
  assert.equal(runtime.gateway.heartbeat, undefined);
  assert.equal(runtime.gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback, true);
  assert.deepEqual(compatibility, runtime);
});

void test("materializes a rollback-compatible legacy config when configured", async (t) => {
  const paths = await fixture(t, {
    overrides: '{"channels":{"telegram":{"groupPolicy":"allowlist"}}}\n',
  });
  const compatibilityConfigPath = path.join(paths.directory, "state", "openclaw.json");

  await createOpenClawRuntimeConfig({
    ...paths,
    compatibilityConfigPath,
  });

  const runtime = JSON.parse(await fs.readFile(paths.runtimeConfigPath, "utf8"));
  const compatibility = JSON.parse(await fs.readFile(compatibilityConfigPath, "utf8"));
  assert.deepEqual(compatibility, runtime);
  assert.equal(compatibility.channels.telegram.groupPolicy, "allowlist");
  assert.deepEqual(compatibility.agents.list, [{ id: "paula", default: true }]);
});

void test("malformed overrides fail without replacing the previous runtime config", async (t) => {
  const previousRuntime = '{"runtimeOnly":"previous"}\n';
  const paths = await fixture(t, {
    overrides: '{"channels":',
    runtime: previousRuntime,
  });

  await assert.rejects(createOpenClawRuntimeConfig(paths), /tenant overrides is not valid JSON5/);
  assert.equal(await fs.readFile(paths.runtimeConfigPath, "utf8"), previousRuntime);
});

void test("missing or malformed defaults fail before publishing runtime config", async (t) => {
  const paths = await fixture(t, { defaultContents: '{"hooks":' });

  await assert.rejects(
    createOpenClawRuntimeConfig(paths),
    /default OpenClaw config is not valid JSON5/,
  );
  assert.deepEqual(await runtimeArtifacts(paths.runtimeConfigPath), []);
});

void test("refuses to use the persisted path as the runtime destination", async (t) => {
  const paths = await fixture(t);

  await assert.rejects(
    createOpenClawRuntimeConfig({
      ...paths,
      runtimeConfigPath: paths.tenantOverridesPath,
    }),
    /must not replace tenant overrides/,
  );
  assert.equal(await fs.readFile(paths.tenantOverridesPath, "utf8"), "{}\n");
});

void test("a concurrent override write is preserved", async (t) => {
  const paths = await fixture(t, {
    overrides: '{"channels":{"telegram":{"groupPolicy":"open"}}}\n',
  });
  const concurrent = '{"channels":{"telegram":{"groupPolicy":"disabled"}}}\n';

  await createOpenClawRuntimeConfig({
    ...paths,
    beforePublish: () => fs.writeFile(paths.tenantOverridesPath, concurrent),
  });

  assert.equal(await fs.readFile(paths.tenantOverridesPath, "utf8"), concurrent);
});

void test("waits for managed override writes before reading configuration", async (t) => {
  const paths = await fixture(t, {
    overrides: '{"channels":{"telegram":{"groupPolicy":"open"}}}\n',
  });
  const lockPath = `${paths.tenantOverridesPath}.lock`;
  await fs.writeFile(lockPath, "other-process\n");
  const reconcile = createOpenClawRuntimeConfig(paths);
  await new Promise((resolve) => setTimeout(resolve, 25));
  await fs.writeFile(
    paths.tenantOverridesPath,
    '{"channels":{"telegram":{"groupPolicy":"disabled"}}}\n',
  );
  await fs.unlink(lockPath);

  await reconcile;
  const runtime = JSON.parse(await fs.readFile(paths.runtimeConfigPath, "utf8"));
  assert.equal(runtime.channels.telegram.groupPolicy, "disabled");
});

void test("a failed runtime rename preserves overrides and previous runtime config", async (t) => {
  const runtime = '{"runtimeOnly":"previous"}\n';
  const paths = await fixture(t, { runtime });
  const failedFileSystem = {
    ...fs,
    rename: async () => {
      throw new Error("simulated rename failure");
    },
  };

  await assert.rejects(
    createOpenClawRuntimeConfig({ ...paths, fileSystem: failedFileSystem }),
    /simulated rename failure/,
  );
  assert.equal(await fs.readFile(paths.tenantOverridesPath, "utf8"), "{}\n");
  assert.equal(await fs.readFile(paths.runtimeConfigPath, "utf8"), runtime);
  assert.deepEqual(await runtimeArtifacts(paths.runtimeConfigPath), ["openclaw.json"]);
});

void test("runtime config permissions remain private", async (t) => {
  const paths = await fixture(t);
  await createOpenClawRuntimeConfig(paths);

  assert.equal((await fs.stat(paths.runtimeConfigPath)).mode & 0o777, 0o600);
  assert.equal(await fs.readFile(paths.tenantOverridesPath, "utf8"), "{}\n");
});
