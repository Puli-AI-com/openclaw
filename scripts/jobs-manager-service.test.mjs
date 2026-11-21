import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "jobs-manager-service.sh");

async function fixture(t, { withProject = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-jobs-manager-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const home = path.join(root, "skills");
  const project = path.join(home, "jobs-manager");
  const scripts = path.join(home, "test-cycle", "scripts");
  const calls = path.join(root, "calls.log");
  await fs.mkdir(scripts, { recursive: true });
  // A fake uv_project.sh that records its arguments, one call per line, and exits at once.
  await fs.writeFile(path.join(scripts, "uv_project.sh"), `echo "$*" >> "${calls}"\nexit 3\n`);
  if (withProject) {
    await fs.mkdir(project);
    await fs.writeFile(path.join(project, "pyproject.toml"), "");
  }
  const env = {
    ...process.env,
    RAMPUP_HOME: home,
    CYCLE_RUNS_TABLE: "tenant-cycle-runs",
    JOBS_MANAGER_RESTART_SECONDS: "1",
  };
  return { project, calls, env };
}

void test("serves the jobs-manager and starts it again when it exits", async (t) => {
  const { project, calls, env } = await fixture(t);

  const child = spawn("sh", [script], { env });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  await new Promise((resolve) => setTimeout(resolve, 1600));
  child.kill();

  const lines = (await fs.readFile(calls, "utf8")).trim().split("\n");
  assert.ok(lines.length >= 2, lines.join("\n"));
  for (const line of lines) {
    assert.equal(line, `${project} python -m jobs_manager serve`);
  }
  assert.match(output, /jobs-manager: exited with code 3, starting again in 1s/);
});

void test("skips a tenant with no cycle run table", async (t) => {
  const { calls, env } = await fixture(t);

  const result = spawnSync("sh", [script], { env: { ...env, CYCLE_RUNS_TABLE: "" }, encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /jobs-manager: skipped, CYCLE_RUNS_TABLE is not set/);
  await assert.rejects(fs.access(calls));
});

void test("skips with a log line when the project is missing", async (t) => {
  const { calls, env } = await fixture(t, { withProject: false });

  const result = spawnSync("sh", [script], { env, encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /jobs-manager: skipped, project not found/);
  await assert.rejects(fs.access(calls));
});

void test("the entrypoint starts the service and the image ships the script", async () => {
  const entrypoint = await fs.readFile(path.join(here, "..", "entrypoint.sh"), "utf8");
  const dockerfile = await fs.readFile(path.join(here, "..", "Dockerfile"), "utf8");

  assert.match(entrypoint, /sh \/app\/scripts\/jobs-manager-service\.sh &/);
  assert.match(
    dockerfile,
    /COPY --chown=node:node scripts\/jobs-manager-service\.sh \/app\/scripts\/jobs-manager-service\.sh/,
  );
});
