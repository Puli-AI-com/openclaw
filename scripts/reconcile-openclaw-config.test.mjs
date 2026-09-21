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
  allowedSessionKeyPrefixes: ["hook:rampup:", "hook:appver:"],
};

const defaults = `${JSON.stringify({
  agents: { defaults: { heartbeat: { every: "0m" } } },
  hooks: requiredHooks,
  channels: { telegram: { groupPolicy: "open" } },
})}\n`;

async function fixture(t, { source, defaultContents = defaults, runtime } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-runtime-config-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sourceConfigPath = path.join(directory, "state", "openclaw.json");
  const runtimeConfigPath = path.join(directory, "state", ".puli-runtime-openclaw.json");
  const defaultConfigPath = path.join(directory, "default.json");
  await fs.writeFile(defaultConfigPath, defaultContents);
  if (source !== undefined) {
    await fs.mkdir(path.dirname(sourceConfigPath), { recursive: true });
    await fs.writeFile(sourceConfigPath, source);
  }
  if (runtime !== undefined) {
    await fs.mkdir(path.dirname(runtimeConfigPath), { recursive: true });
    await fs.writeFile(runtimeConfigPath, runtime);
  }
  return { sourceConfigPath, runtimeConfigPath, defaultConfigPath, directory };
}

async function runtimeArtifacts(runtimeConfigPath) {
  try {
    return (await fs.readdir(path.dirname(runtimeConfigPath))).filter((name) =>
      name.startsWith(".puli-runtime-openclaw.json"),
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

void test("creates an overlay without reading or changing persisted JSON5", async (t) => {
  const source = `{
    // Comments, trailing commas, and unsafe integer literals must remain exact.
    tenantId: 900719925474099312345,
    gateway: { custom: true, },
    hooks: { customHookOption: 'preserve-me' },
  }\n`;
  const paths = await fixture(t, { source });

  const result = await createOpenClawRuntimeConfig(paths);
  const overlay = JSON.parse(await fs.readFile(paths.runtimeConfigPath, "utf8"));

  assert.equal(result.status, "overlay-created");
  assert.equal(await fs.readFile(paths.sourceConfigPath, "utf8"), source);
  assert.deepEqual(overlay, {
    $include: paths.sourceConfigPath,
    hooks: requiredHooks,
  });
  assert.deepEqual(await runtimeArtifacts(paths.runtimeConfigPath), [
    ".puli-runtime-openclaw.json",
  ]);
});

void test("never changes malformed persisted data", async (t) => {
  const source = '{"gateway":{"token":"keep-me"},"hooks":';
  const paths = await fixture(t, { source });

  await createOpenClawRuntimeConfig(paths);

  assert.equal(await fs.readFile(paths.sourceConfigPath, "utf8"), source);
  assert.equal(
    JSON.parse(await fs.readFile(paths.runtimeConfigPath, "utf8")).$include,
    paths.sourceConfigPath,
  );
});

void test("uses complete defaults when no persisted config exists", async (t) => {
  const paths = await fixture(t);

  const result = await createOpenClawRuntimeConfig(paths);

  assert.equal(result.status, "defaults-created");
  assert.deepEqual(
    JSON.parse(await fs.readFile(paths.runtimeConfigPath, "utf8")),
    JSON.parse(defaults),
  );
});

void test("allows a symlinked persisted config without replacing it or its target", async (t) => {
  const paths = await fixture(t);
  const targetPath = path.join(paths.directory, "tenant-config.json5");
  const source = "{ tenantOnly: 'keep-me' }\n";
  await fs.writeFile(targetPath, source);
  await fs.mkdir(path.dirname(paths.sourceConfigPath), { recursive: true });
  await fs.symlink(targetPath, paths.sourceConfigPath);

  await createOpenClawRuntimeConfig(paths);

  assert.equal((await fs.lstat(paths.sourceConfigPath)).isSymbolicLink(), true);
  assert.equal(await fs.readFile(targetPath, "utf8"), source);
});

void test("refuses malformed defaults without touching persisted data", async (t) => {
  const source = '{"tenantOnly":"keep-me"}\n';
  const paths = await fixture(t, { source, defaultContents: '{"hooks":' });

  await assert.rejects(
    createOpenClawRuntimeConfig(paths),
    /default OpenClaw config is not valid JSON/,
  );

  assert.equal(await fs.readFile(paths.sourceConfigPath, "utf8"), source);
  assert.deepEqual(await runtimeArtifacts(paths.runtimeConfigPath), []);
});

void test("refuses to use the persisted path as the runtime destination", async (t) => {
  const source = '{"tenantOnly":"keep-me"}\n';
  const paths = await fixture(t, { source });

  await assert.rejects(
    createOpenClawRuntimeConfig({
      ...paths,
      runtimeConfigPath: paths.sourceConfigPath,
    }),
    /must not replace the persisted config/,
  );

  assert.equal(await fs.readFile(paths.sourceConfigPath, "utf8"), source);
});

void test("a concurrent persisted write remains intact and visible through the overlay", async (t) => {
  const source = '{"tenantOnly":"original"}\n';
  const concurrent = `{
    tenantOnly: 'written-concurrently',
    unsafeId: 900719925474099312345,
  }\n`;
  const paths = await fixture(t, { source });

  await createOpenClawRuntimeConfig({
    ...paths,
    beforePublish: () => fs.writeFile(paths.sourceConfigPath, concurrent),
  });

  assert.equal(await fs.readFile(paths.sourceConfigPath, "utf8"), concurrent);
  assert.equal(
    JSON.parse(await fs.readFile(paths.runtimeConfigPath, "utf8")).$include,
    paths.sourceConfigPath,
  );
});

void test("a failed runtime rename leaves persisted and previous runtime data intact", async (t) => {
  const source = '{"tenantOnly":"keep-me"}\n';
  const runtime = '{"runtimeOnly":"previous"}\n';
  const paths = await fixture(t, { source, runtime });
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

  assert.equal(await fs.readFile(paths.sourceConfigPath, "utf8"), source);
  assert.equal(await fs.readFile(paths.runtimeConfigPath, "utf8"), runtime);
  assert.deepEqual(await runtimeArtifacts(paths.runtimeConfigPath), [
    ".puli-runtime-openclaw.json",
  ]);
});

void test("a failed temporary write cannot change persisted data", async (t) => {
  const source = '{"tenantOnly":"keep-me"}\n';
  const paths = await fixture(t, { source });
  const failedFileSystem = {
    ...fs,
    open: async (filePath, ...args) => {
      if (String(filePath).includes(".tmp-")) {
        const error = new Error("simulated disk-full failure");
        error.code = "ENOSPC";
        throw error;
      }
      return fs.open(filePath, ...args);
    },
  };

  await assert.rejects(
    createOpenClawRuntimeConfig({ ...paths, fileSystem: failedFileSystem }),
    /simulated disk-full failure/,
  );

  assert.equal(await fs.readFile(paths.sourceConfigPath, "utf8"), source);
  assert.deepEqual(await runtimeArtifacts(paths.runtimeConfigPath), []);
});

void test("runtime permissions stay private even under a restrictive umask", async (t) => {
  const source = '{"tenantOnly":"keep-me"}\n';
  const paths = await fixture(t, { source });
  await fs.chmod(path.dirname(paths.runtimeConfigPath), 0o750);
  const previousUmask = process.umask(0o777);
  try {
    await createOpenClawRuntimeConfig(paths);
  } finally {
    process.umask(previousUmask);
  }

  assert.equal((await fs.stat(paths.runtimeConfigPath)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(path.dirname(paths.runtimeConfigPath))).mode & 0o777, 0o750);
  assert.equal(await fs.readFile(paths.sourceConfigPath, "utf8"), source);
});
