import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "account-sweep.sh");

async function fixture(t, { withScript = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-account-sweep-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const home = path.join(root, "skills");
  const scripts = path.join(home, "application-discovery", "scripts");
  await fs.mkdir(scripts, { recursive: true });
  if (withScript) {
    await fs.writeFile(path.join(scripts, "run_account.py"), "");
  }
  // A fake uv that records its arguments, one call per line.
  const bin = path.join(root, "bin");
  const calls = path.join(root, "calls.log");
  await fs.mkdir(bin);
  await fs.writeFile(path.join(bin, "uv"), `#!/bin/sh\necho "$*" >> "${calls}"\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, RAMPUP_HOME: home };
  return { home, calls, env };
}

void test("sweeps with --startup once, then on every interval", async (t) => {
  const { home, calls, env } = await fixture(t);

  const child = spawn("sh", [script], { env: { ...env, ACCOUNT_SWEEP_INTERVAL_SECONDS: "1" } });
  await new Promise((resolve) => setTimeout(resolve, 2600));
  child.kill();

  const lines = (await fs.readFile(calls, "utf8")).trim().split("\n");
  const sweep = `${path.join(home, "application-discovery", "scripts", "run_account.py")} sweep`;
  assert.equal(
    lines[0],
    `run --project ${path.join(home, "application-discovery")} python ${sweep} --startup`,
  );
  assert.ok(lines.length >= 2, lines.join("\n"));
  for (const line of lines.slice(1)) {
    assert.equal(line, `run --project ${path.join(home, "application-discovery")} python ${sweep}`);
  }
});

void test("skips with a log line when the script is missing", async (t) => {
  const { calls, env } = await fixture(t, { withScript: false });

  const result = spawnSync("sh", [script], { env, encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /account-sweep: skipped, script not found/);
  await assert.rejects(fs.access(calls));
});

void test("the entrypoint starts the loop and the image ships the script", async () => {
  const entrypoint = await fs.readFile(path.join(here, "..", "entrypoint.sh"), "utf8");
  const dockerfile = await fs.readFile(path.join(here, "..", "Dockerfile"), "utf8");

  assert.match(entrypoint, /sh \/app\/scripts\/account-sweep\.sh &/);
  assert.match(
    dockerfile,
    /COPY --chown=node:node scripts\/account-sweep\.sh \/app\/scripts\/account-sweep\.sh/,
  );
});
