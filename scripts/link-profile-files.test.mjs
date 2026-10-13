import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "link-profile-files.sh");

async function fixture(t, { withUserProfiles = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-link-profile-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const profile = path.join(root, "profile");
  const workspace = path.join(root, "workspace");
  await fs.mkdir(path.join(profile, "flows"), { recursive: true });
  await fs.writeFile(path.join(profile, "flows", "FLOWS.md"), "index v1\n");
  await fs.writeFile(path.join(profile, "USER_PROFILE.md"), "profile index\n");
  if (withUserProfiles) {
    await fs.mkdir(path.join(profile, "user_profiles"), { recursive: true });
    await fs.writeFile(path.join(profile, "user_profiles", "pm.md"), "pm guide\n");
  }
  await fs.mkdir(workspace, { recursive: true });
  return { root, profile, workspace };
}

function run(profile, workspace) {
  return spawnSync("sh", [script, profile, workspace], { encoding: "utf8" });
}

test("links flows, user_profiles and USER_PROFILE.md into the workspace", async (t) => {
  const { profile, workspace } = await fixture(t);

  const result = run(profile, workspace);

  assert.equal(result.status, 0, result.stderr);
  for (const name of ["flows", "user_profiles", "USER_PROFILE.md"]) {
    const stat = await fs.lstat(path.join(workspace, name));
    assert.ok(stat.isSymbolicLink(), `${name} is a link`);
    assert.equal(await fs.readlink(path.join(workspace, name)), path.join(profile, name));
  }
  assert.equal(await fs.readFile(path.join(workspace, "flows", "FLOWS.md"), "utf8"), "index v1\n");
  assert.equal(await fs.readFile(path.join(workspace, "USER_PROFILE.md"), "utf8"), "profile index\n");
});

test("a second run changes nothing", async (t) => {
  const { profile, workspace } = await fixture(t);
  assert.equal(run(profile, workspace).status, 0);
  const before = (await fs.readdir(workspace)).sort();

  const result = run(profile, workspace);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual((await fs.readdir(workspace)).sort(), before);
  assert.ok(!before.some((name) => name.includes(".old-")));
});

test("a real folder or file at a target is moved aside once, then linked", async (t) => {
  const { profile, workspace } = await fixture(t);
  await fs.mkdir(path.join(workspace, "flows"));
  await fs.writeFile(path.join(workspace, "flows", "hand-edited.md"), "demo edit\n");
  await fs.writeFile(path.join(workspace, "USER_PROFILE.md"), "old copy\n");

  assert.equal(run(profile, workspace).status, 0);
  assert.equal(run(profile, workspace).status, 0);

  const names = (await fs.readdir(workspace)).sort();
  const asideFolder = names.filter((name) => name.startsWith("flows.old-"));
  const asideFile = names.filter((name) => name.startsWith("USER_PROFILE.md.old-"));
  assert.equal(asideFolder.length, 1);
  assert.equal(asideFile.length, 1);
  assert.equal(
    await fs.readFile(path.join(workspace, asideFolder[0], "hand-edited.md"), "utf8"),
    "demo edit\n",
  );
  assert.equal(await fs.readFile(path.join(workspace, asideFile[0]), "utf8"), "old copy\n");
  assert.ok((await fs.lstat(path.join(workspace, "flows"))).isSymbolicLink());
});

test("a missing profile entry is skipped", async (t) => {
  const { profile, workspace } = await fixture(t, { withUserProfiles: false });

  const result = run(profile, workspace);

  assert.equal(result.status, 0, result.stderr);
  const names = await fs.readdir(workspace);
  assert.ok(names.includes("flows"));
  assert.ok(!names.includes("user_profiles"));
});

test("a changed profile file reads through the workspace with no second run", async (t) => {
  const { profile, workspace } = await fixture(t);
  assert.equal(run(profile, workspace).status, 0);

  await fs.writeFile(path.join(profile, "flows", "FLOWS.md"), "index v2\n");

  assert.equal(await fs.readFile(path.join(workspace, "flows", "FLOWS.md"), "utf8"), "index v2\n");
});

test("it fails hard with an error line when the workspace cannot take the links", async (t) => {
  const { root, profile } = await fixture(t);

  const result = run(profile, path.join(root, "no-such-workspace"));

  assert.equal(result.status, 1);
  assert.match(result.stderr, /^entrypoint: error, could not link flows: .+/m);
});
