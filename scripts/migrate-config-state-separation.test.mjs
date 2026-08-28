import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildEffectiveConfig,
  migrateConfigState,
  resolveConfigStatePaths,
} from "./config-state-separation.mjs";

const defaultsObject = {
  gateway: {
    controlUi: { dangerouslyAllowHostHeaderOriginFallback: true },
    http: { endpoints: { chatCompletions: { enabled: true } } },
  },
  hooks: { enabled: true, allowedAgentIds: ["paula"] },
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

async function fixture(t, { legacy, overrides } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-config-migration-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const stateDir = path.join(directory, "state");
  const defaultConfigPath = path.join(directory, "default.json");
  const runtimeConfigPath = path.join(directory, "runtime", "openclaw.json");
  const tenantOverridesPath = path.join(stateDir, "tenant-overrides.json");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(defaultConfigPath, `${JSON.stringify(defaultsObject)}\n`);
  if (legacy !== undefined) {
    await fs.writeFile(path.join(stateDir, "openclaw.json"), legacy);
  }
  if (overrides !== undefined) {
    await fs.writeFile(tenantOverridesPath, overrides);
  }
  return {
    directory,
    stateDir,
    env: {
      OPENCLAW_STATE_DIR: stateDir,
      OPENCLAW_DEFAULT_CONFIG_PATH: defaultConfigPath,
      OPENCLAW_RUNTIME_CONFIG_PATH: runtimeConfigPath,
      OPENCLAW_PERSIST_CONFIG_PATH: tenantOverridesPath,
    },
  };
}

void test("migrates legacy differences while preserving legacy bytes", async (t) => {
  const legacy = `{
    // Existing JSON5 remains byte-for-byte available for rollback.
    gateway: {
      heartbeat: { enabled: true },
      controlUi: { dangerouslyAllowHostHeaderOriginFallback: false },
    },
    hooks: { enabled: false },
    channels: { telegram: { groupPolicy: 'allowlist' } },
    agents: {
      defaults: {
        model: { primary: 'tenant/model' },
        heartbeat: { every: '30m' },
      },
      list: [{ id: 'other', default: true }],
    },
    skills: { load: { extraDirs: ['/tenant/skills'] } },
  }\n`;
  const setup = await fixture(t, { legacy });
  const paths = resolveConfigStatePaths(setup.env);

  const result = await migrateConfigState({ env: setup.env });
  const overrides = JSON.parse(await fs.readFile(paths.tenantOverridesPath, "utf8"));

  assert.equal(result.status, "migrated-legacy-config");
  assert.equal(await fs.readFile(paths.legacyConfigPath, "utf8"), legacy);
  assert.equal(await fs.readFile(paths.legacyBackupPath, "utf8"), legacy);
  assert.deepEqual(overrides, {
    channels: { telegram: { groupPolicy: "allowlist" } },
    agents: { defaults: { model: { primary: "tenant/model" } } },
  });
  assert.equal(overrides.hooks, undefined);
  assert.equal(overrides.agents.list, undefined);
  assert.equal(overrides.skills, undefined);
  assert.equal(overrides.gateway, undefined);
  assert.equal(result.marker.status, "completed");
});

void test("initializes empty overrides when no legacy config exists", async (t) => {
  const setup = await fixture(t);
  const paths = resolveConfigStatePaths(setup.env);

  const result = await migrateConfigState({ env: setup.env });

  assert.equal(result.status, "initialized-empty-overrides");
  assert.deepEqual(JSON.parse(await fs.readFile(paths.tenantOverridesPath, "utf8")), {});
  assert.equal(await fs.stat(paths.tenantOverridesPath).then((stat) => stat.mode & 0o777), 0o600);
});

void test("adopts an existing override file without rewriting it", async (t) => {
  const overrides = `{
    channels: { telegram: { groupPolicy: 'allowlist' } },
  }\n`;
  const setup = await fixture(t, {
    legacy: `${JSON.stringify(defaultsObject)}\n`,
    overrides,
  });
  const paths = resolveConfigStatePaths(setup.env);

  const result = await migrateConfigState({ env: setup.env });

  assert.equal(result.status, "adopted-existing-overrides");
  assert.equal(await fs.readFile(paths.tenantOverridesPath, "utf8"), overrides);
  assert.equal(
    await fs.readFile(paths.legacyBackupPath, "utf8"),
    JSON.stringify(defaultsObject) + "\n",
  );
});

void test("completed migration is idempotent", async (t) => {
  const setup = await fixture(t, { legacy: `${JSON.stringify(defaultsObject)}\n` });
  const paths = resolveConfigStatePaths(setup.env);
  await migrateConfigState({ env: setup.env });
  const markerBefore = await fs.readFile(paths.migrationMarkerPath, "utf8");
  const overridesBefore = await fs.readFile(paths.tenantOverridesPath, "utf8");

  const result = await migrateConfigState({
    env: setup.env,
    now: () => new Date("2030-01-01T00:00:00.000Z"),
  });

  assert.equal(result.status, "already-migrated");
  assert.equal(await fs.readFile(paths.migrationMarkerPath, "utf8"), markerBefore);
  assert.equal(await fs.readFile(paths.tenantOverridesPath, "utf8"), overridesBefore);
});

void test("malformed legacy config fails after creating only an exact backup", async (t) => {
  const legacy = "{ hooks:";
  const setup = await fixture(t, { legacy });
  const paths = resolveConfigStatePaths(setup.env);

  await assert.rejects(
    migrateConfigState({ env: setup.env }),
    /legacy OpenClaw config is not valid JSON5/,
  );

  assert.equal(await fs.readFile(paths.legacyConfigPath, "utf8"), legacy);
  assert.equal(await fs.readFile(paths.legacyBackupPath, "utf8"), legacy);
  await assert.rejects(fs.access(paths.tenantOverridesPath));
  await assert.rejects(fs.access(paths.migrationMarkerPath));
  await assert.rejects(fs.access(paths.migrationLockPath));
});

void test("a repaired legacy config gets a new immutable rollback backup", async (t) => {
  const setup = await fixture(t, { legacy: "{ hooks:" });
  const paths = resolveConfigStatePaths(setup.env);
  await assert.rejects(migrateConfigState({ env: setup.env }));
  const repaired = `${JSON.stringify(defaultsObject)}\n`;
  await fs.writeFile(paths.legacyConfigPath, repaired);

  const result = await migrateConfigState({ env: setup.env });
  const repairedBackupPath = path.join(paths.migrationDir, result.marker.legacyBackupFile);

  assert.notEqual(repairedBackupPath, paths.legacyBackupPath);
  assert.equal(await fs.readFile(paths.legacyBackupPath, "utf8"), "{ hooks:");
  assert.equal(await fs.readFile(repairedBackupPath, "utf8"), repaired);
});

void test("a completed marker fails loudly when overrides are missing", async (t) => {
  const setup = await fixture(t);
  const paths = resolveConfigStatePaths(setup.env);
  await migrateConfigState({ env: setup.env });
  await fs.unlink(paths.tenantOverridesPath);

  await assert.rejects(
    migrateConfigState({ env: setup.env }),
    /marker exists but tenant overrides are missing/,
  );
});

void test("legacy includes require manual review instead of unsafe extraction", async (t) => {
  const setup = await fixture(t, { legacy: '{ "$include": "./tenant.json" }\n' });

  await assert.rejects(
    migrateConfigState({ env: setup.env }),
    /uses \$include, which requires manual migration review/,
  );
});

void test("effective arrays use override replacement while protected arrays use defaults", () => {
  const effective = buildEffectiveConfig(defaultsObject, {
    channels: { custom: ["tenant-only"] },
    hooks: { allowedAgentIds: ["other"] },
    agents: { list: [{ id: "other" }] },
  });

  assert.deepEqual(effective.channels.custom, ["tenant-only"]);
  assert.deepEqual(effective.hooks.allowedAgentIds, ["paula"]);
  assert.deepEqual(effective.agents.list, [{ id: "paula", default: true }]);
});
