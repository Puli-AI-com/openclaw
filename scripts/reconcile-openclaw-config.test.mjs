import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { reconcileOpenClawConfig } from "./reconcile-openclaw-config.mjs";

async function fixture(t, { current, defaults }) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-config-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "state", "openclaw.json");
  const defaultConfigPath = path.join(directory, "default.json");
  await fs.writeFile(defaultConfigPath, defaults);
  if (current !== undefined) {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, current);
  }
  return { configPath, defaultConfigPath, directory };
}

async function artifacts(configPath) {
  const names = await fs.readdir(path.dirname(configPath));
  return {
    backups: names.filter((name) => name.startsWith("openclaw.json.backup-")),
    temps: names.filter((name) => name.startsWith("openclaw.json.tmp-")),
  };
}

const requiredHooks = {
  enabled: true,
  token: "${OPENCLAW_HOOKS_TOKEN}",
  allowedAgentIds: ["paula"],
  defaultSessionKey: "hook:rampup:default",
  allowRequestSessionKey: true,
  allowedSessionKeyPrefixes: ["hook:rampup:", "hook:appver:"],
};

const defaults = JSON.stringify({
  gateway: { heartbeat: { enabled: false } },
  hooks: requiredHooks,
  channels: { telegram: { groupPolicy: "open" } },
});

void test("creates a missing config atomically from defaults", async (t) => {
  const paths = await fixture(t, { defaults });

  const result = await reconcileOpenClawConfig(paths);

  assert.equal(result.status, "created");
  assert.equal(result.backupPath, null);
  assert.deepEqual(JSON.parse(await fs.readFile(paths.configPath, "utf8")), JSON.parse(defaults));
  assert.deepEqual(await artifacts(paths.configPath), { backups: [], temps: [] });
});

void test("merges required hooks while preserving all tenant data and an exact backup", async (t) => {
  const current = `${JSON.stringify(
    {
      gateway: { auth: { token: "tenant-secret" }, custom: true },
      hooks: { enabled: false, customHookOption: "preserve-me" },
      plugins: { entries: [{ id: "tenant-plugin", config: { nested: [1, 2, 3] } }] },
      tenantOnly: { untouched: true },
    },
    null,
    4,
  )}\n`;
  const paths = await fixture(t, { current, defaults });
  await fs.chmod(paths.configPath, 0o640);

  const result = await reconcileOpenClawConfig(paths);
  const updated = JSON.parse(await fs.readFile(paths.configPath, "utf8"));

  assert.equal(result.status, "updated");
  assert.deepEqual(updated.gateway, {
    auth: { token: "tenant-secret" },
    custom: true,
  });
  assert.deepEqual(updated.plugins, {
    entries: [{ id: "tenant-plugin", config: { nested: [1, 2, 3] } }],
  });
  assert.deepEqual(updated.tenantOnly, { untouched: true });
  assert.deepEqual(updated.hooks, {
    customHookOption: "preserve-me",
    ...requiredHooks,
  });
  assert.equal(await fs.readFile(result.backupPath, "utf8"), current);
  assert.equal((await fs.stat(paths.configPath)).mode & 0o777, 0o640);
  assert.equal((await fs.stat(result.backupPath)).mode & 0o777, 0o640);
  assert.deepEqual(await artifacts(paths.configPath), {
    backups: [path.basename(result.backupPath)],
    temps: [],
  });
});

void test("is idempotent and does not create another backup", async (t) => {
  const current = JSON.stringify({ tenantOnly: "safe", hooks: requiredHooks });
  const paths = await fixture(t, { current, defaults });

  const result = await reconcileOpenClawConfig(paths);

  assert.deepEqual(result, { status: "unchanged", backupPath: null });
  assert.equal(await fs.readFile(paths.configPath, "utf8"), current);
  assert.deepEqual(await artifacts(paths.configPath), { backups: [], temps: [] });
});

void test("refuses malformed persisted JSON without changing any byte", async (t) => {
  const current = '{"gateway":{"token":"keep-me"},"hooks":';
  const paths = await fixture(t, { current, defaults });

  await assert.rejects(
    reconcileOpenClawConfig(paths),
    /persisted OpenClaw config is not valid JSON/,
  );

  assert.equal(await fs.readFile(paths.configPath, "utf8"), current);
  assert.deepEqual(await artifacts(paths.configPath), { backups: [], temps: [] });
});

void test("refuses malformed or structurally invalid defaults without touching persisted data", async (t) => {
  for (const invalidDefaults of ['{"hooks":', '{"hooks":[]}', "[]"]) {
    await t.test(invalidDefaults, async (subtest) => {
      const current = '{"tenantOnly":"keep-me"}\n';
      const paths = await fixture(subtest, { current, defaults: invalidDefaults });

      await assert.rejects(reconcileOpenClawConfig(paths));

      assert.equal(await fs.readFile(paths.configPath, "utf8"), current);
      assert.deepEqual(await artifacts(paths.configPath), { backups: [], temps: [] });
    });
  }
});

void test("refuses a non-object persisted hooks value instead of discarding it", async (t) => {
  const current = '{"tenantOnly":"keep-me","hooks":["unexpected","data"]}\n';
  const paths = await fixture(t, { current, defaults });

  await assert.rejects(reconcileOpenClawConfig(paths), /hooks setting must be an object/);

  assert.equal(await fs.readFile(paths.configPath, "utf8"), current);
  assert.deepEqual(await artifacts(paths.configPath), { backups: [], temps: [] });
});

void test("refuses to replace a symlinked config or mutate its target", async (t) => {
  const paths = await fixture(t, { defaults });
  const targetPath = path.join(paths.directory, "tenant-config.json");
  const current = '{"tenantOnly":"keep-me"}\n';
  await fs.writeFile(targetPath, current);
  await fs.mkdir(path.dirname(paths.configPath), { recursive: true });
  await fs.symlink(targetPath, paths.configPath);

  await assert.rejects(reconcileOpenClawConfig(paths), /must be a regular file/);

  assert.equal((await fs.lstat(paths.configPath)).isSymbolicLink(), true);
  assert.equal(await fs.readFile(targetPath, "utf8"), current);
  assert.deepEqual(await artifacts(paths.configPath), { backups: [], temps: [] });
});

void test("detects a concurrent config change and preserves the newer data", async (t) => {
  const current = '{"tenantOnly":"original"}\n';
  const concurrent = '{"tenantOnly":"written-concurrently"}\n';
  const paths = await fixture(t, { current, defaults });

  await assert.rejects(
    reconcileOpenClawConfig({
      ...paths,
      beforeReplace: () => fs.writeFile(paths.configPath, concurrent),
    }),
    /changed during reconciliation/,
  );

  assert.equal(await fs.readFile(paths.configPath, "utf8"), concurrent);
  assert.deepEqual(await artifacts(paths.configPath), { backups: [], temps: [] });
});

void test("preserves the original and its backup if atomic replacement fails", async (t) => {
  const current = '{"tenantOnly":"keep-me"}\n';
  const paths = await fixture(t, { current, defaults });
  const failedFileSystem = {
    ...fs,
    rename: async () => {
      throw new Error("simulated rename failure");
    },
  };

  await assert.rejects(
    reconcileOpenClawConfig({ ...paths, fileSystem: failedFileSystem }),
    /simulated rename failure/,
  );

  assert.equal(await fs.readFile(paths.configPath, "utf8"), current);
  const found = await artifacts(paths.configPath);
  assert.equal(found.backups.length, 1);
  assert.equal(
    await fs.readFile(path.join(path.dirname(paths.configPath), found.backups[0]), "utf8"),
    current,
  );
  assert.deepEqual(found.temps, []);
});

void test("does not replace the original if durable backup creation fails", async (t) => {
  const current = '{"tenantOnly":"keep-me"}\n';
  const paths = await fixture(t, { current, defaults });
  const failedFileSystem = {
    ...fs,
    open: async (filePath, ...args) => {
      if (String(filePath).includes(".backup-")) {
        const error = new Error("simulated backup failure");
        error.code = "ENOSPC";
        throw error;
      }
      return fs.open(filePath, ...args);
    },
  };

  await assert.rejects(
    reconcileOpenClawConfig({ ...paths, fileSystem: failedFileSystem }),
    /simulated backup failure/,
  );

  assert.equal(await fs.readFile(paths.configPath, "utf8"), current);
  assert.deepEqual(await artifacts(paths.configPath), { backups: [], temps: [] });
});
