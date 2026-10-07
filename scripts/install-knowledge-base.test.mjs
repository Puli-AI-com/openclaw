import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installKnowledgeBase } from "./install-knowledge-base.mjs";

function git(repo, args) {
  const result = spawnSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    env: process.env,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function makeRepo(t, { manifest = "name: ui-component-kb\n", includeManifest = true } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "envoy-kb-fixture-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const ui = path.join(directory, "ui-components", "components");
  fs.mkdirSync(ui, { recursive: true });
  fs.writeFileSync(path.join(ui, "switch.yaml"), "name: switch\n");
  if (includeManifest) {
    fs.writeFileSync(path.join(directory, "ui-components", "manifest.yaml"), manifest);
  }
  fs.mkdirSync(path.join(directory, "other-kb"));
  fs.writeFileSync(path.join(directory, "other-kb", "note.txt"), "later\n");
  git(directory, ["init"]);
  git(directory, ["config", "user.email", "kb-test@example.com"]);
  git(directory, ["config", "user.name", "KB Test"]);
  git(directory, ["add", "."]);
  git(directory, ["commit", "-m", "fixture"]);
  return directory;
}

function destination(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "envoy-kb-dest-"));
  const dest = path.join(directory, "knowledge");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return dest;
}

test("installs the repo and records one revision for the ui-components folder", (t) => {
  const repo = makeRepo(t);
  const dest = destination(t);
  const expected = git(repo, ["rev-parse", "HEAD"]);

  const code = installKnowledgeBase({ repo: `file://${repo}`, dest, token: "" });

  assert.equal(code, 0);
  assert.equal(fs.readFileSync(path.join(dest, "REVISION"), "utf8"), `${expected}\n`);
  assert.equal(
    fs.readFileSync(path.join(dest, "ui-components", "REVISION"), "utf8"),
    `${expected}\n`,
  );
  assert.equal(fs.existsSync(path.join(dest, ".git")), false);
  assert.equal(fs.readFileSync(path.join(dest, "other-kb", "note.txt"), "utf8"), "later\n");
  assert.equal(fs.statSync(path.join(dest, "ui-components", "manifest.yaml")).mode & 0o777, 0o644);
  assert.equal(fs.statSync(path.join(dest, "ui-components")).mode & 0o777, 0o755);
});

test("a missing manifest fails and leaves the destination absent", (t) => {
  const repo = makeRepo(t, { includeManifest: false });
  const dest = destination(t);

  const code = installKnowledgeBase({ repo: `file://${repo}`, dest, token: "" });

  assert.equal(code, 1);
  assert.equal(fs.existsSync(dest), false);
});

test("an unparseable manifest fails and leaves the destination absent", (t) => {
  const repo = makeRepo(t, { manifest: "name: [\n" });
  const dest = destination(t);

  const code = installKnowledgeBase({ repo: `file://${repo}`, dest, token: "" });

  assert.equal(code, 1);
  assert.equal(fs.existsSync(dest), false);
});

test("a manifest that is not a mapping fails and leaves the destination absent", (t) => {
  const repo = makeRepo(t, { manifest: "- switch\n" });
  const dest = destination(t);

  const code = installKnowledgeBase({ repo: `file://${repo}`, dest, token: "" });

  assert.equal(code, 1);
  assert.equal(fs.existsSync(dest), false);
});

test("a build without a token warns and skips", (t) => {
  const dest = destination(t);

  const code = installKnowledgeBase({
    repo: "https://github.com/Puli-AI-com/envoy-kb.git",
    dest,
    token: "",
    requireAtBuild: false,
  });

  assert.equal(code, 0);
  assert.equal(fs.existsSync(dest), false);
});

test("a required build without a token fails", (t) => {
  const dest = destination(t);

  const code = installKnowledgeBase({
    repo: "https://github.com/Puli-AI-com/envoy-kb.git",
    dest,
    token: "",
    requireAtBuild: true,
  });

  assert.equal(code, 1);
  assert.equal(fs.existsSync(dest), false);
});
