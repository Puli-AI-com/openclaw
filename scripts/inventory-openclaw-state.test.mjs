import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inventoryOpenClawState } from "./inventory-openclaw-state.mjs";

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-state-inventory-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const stateRoot = path.join(directory, "state");
  await fs.mkdir(stateRoot);
  return { directory, stateRoot };
}

function readOnlyFileSystem() {
  const allowedOperations = new Set(["lstat", "open", "opendir", "realpath"]);
  return new Proxy(fs, {
    get(target, property) {
      if (!allowedOperations.has(property)) {
        throw new Error(`inventory attempted a non-read operation: ${String(property)}`);
      }
      if (property === "open") {
        return async (filePath, flags, ...arguments_) => {
          assert.equal(flags & (fsConstants.O_WRONLY | fsConstants.O_RDWR), 0);
          return target.open(filePath, flags, ...arguments_);
        };
      }
      return target[property].bind(target);
    },
  });
}

void test("inventories known state without exposing configuration values", async (t) => {
  const { stateRoot } = await fixture(t);
  const config = `{
    // Existing tenant JSON5 remains readable during Phase 0.
    gateway: { auth: { token: 'do-not-print-this' } },
    agents: { list: [{ id: 'paula' }] },
    channels: { telegram: { accounts: { 'customer@example.com': { enabled: true } } } },
  }\n`;
  await fs.writeFile(path.join(stateRoot, "openclaw.json"), config);
  await fs.mkdir(path.join(stateRoot, "agents", "paula", "sessions"), { recursive: true });
  await fs.writeFile(path.join(stateRoot, "agents", "paula", "sessions", "sessions.json"), "{}\n");
  await fs.mkdir(path.join(stateRoot, "workspace"), { recursive: true });
  await fs.writeFile(path.join(stateRoot, "workspace", "AGENTS.md"), "# Paula\n");
  await fs.writeFile(path.join(stateRoot, "unexpected.customer@example"), "unknown");

  const report = await inventoryOpenClawState({
    root: stateRoot,
    fileSystem: readOnlyFileSystem(),
    now: () => new Date("2026-08-26T12:00:00.000Z"),
  });

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.generatedAt, "2026-08-26T12:00:00.000Z");
  assert.equal(report.scan.complete, true);
  assert.equal(report.unknownTopLevelEntryCount, 1);
  assert.equal(report.legacyConfig.parseStatus, "valid");
  assert.equal(report.legacyConfig.topLevelFieldCount, 3);
  assert.equal(report.managedWorkspaceFiles[0].name, "AGENTS.md");

  const serialized = JSON.stringify(report);
  assert(!serialized.includes("do-not-print-this"));
  assert(!serialized.includes("customer@example.com"));
  assert(!serialized.includes("customer@example"));
  assert(!serialized.includes("# Paula"));

  const agents = report.entries.find((entry) => entry.name === "agents");
  assert.equal(agents.category, "agent-and-session-state");
  assert.equal(agents.recommendation, "persist");
  assert.equal(agents.files, 1);
  assert.equal(agents.formats[0], "json");
});

void test("does not follow symlinks inside the state tree", async (t) => {
  const { directory, stateRoot } = await fixture(t);
  const external = path.join(directory, "external-secret.txt");
  await fs.writeFile(external, "this file is outside the state root");
  await fs.mkdir(path.join(stateRoot, "media"));
  await fs.symlink(external, path.join(stateRoot, "media", "external-link"));

  const report = await inventoryOpenClawState({ root: stateRoot });
  const media = report.entries.find((entry) => entry.name === "media");

  assert.equal(media.symlinks, 1);
  assert.equal(media.files, 0);
  assert.equal(media.bytes, 0);
});

void test("reports malformed legacy config without returning its contents", async (t) => {
  const { stateRoot } = await fixture(t);
  await fs.writeFile(path.join(stateRoot, "openclaw.json"), "{ token: 'sensitive-value'");

  const report = await inventoryOpenClawState({ root: stateRoot });

  assert.equal(report.scan.complete, true);
  assert.equal(report.legacyConfig.parseStatus, "invalid-json5");
  assert(!JSON.stringify(report).includes("sensitive-value"));
});

void test("marks a bounded scan as incomplete", async (t) => {
  const { stateRoot } = await fixture(t);
  await fs.mkdir(path.join(stateRoot, "workspace"));
  await fs.writeFile(path.join(stateRoot, "workspace", "one.md"), "one");
  await fs.writeFile(path.join(stateRoot, "workspace", "two.md"), "two");

  const report = await inventoryOpenClawState({ root: stateRoot, maxEntries: 1 });

  assert.equal(report.scan.complete, false);
  assert.equal(report.entries[0].truncated, true);
  assert.equal(report.scan.visitedEntries, 1);
});

void test("marks oversized configuration analysis as incomplete", async (t) => {
  const { stateRoot } = await fixture(t);
  const configPath = path.join(stateRoot, "openclaw.json");
  await fs.writeFile(configPath, "");
  await fs.truncate(configPath, 10 * 1024 * 1024 + 1);

  const report = await inventoryOpenClawState({ root: stateRoot });

  assert.equal(report.scan.complete, false);
  assert.equal(report.legacyConfig.parseStatus, "too-large");
  assert.equal(report.legacyConfig.sha256, undefined);
});

void test("marks symlinked managed profile files as incomplete", async (t) => {
  const { directory, stateRoot } = await fixture(t);
  const external = path.join(directory, "AGENTS.md");
  await fs.writeFile(external, "external profile");
  await fs.mkdir(path.join(stateRoot, "workspace"));
  await fs.symlink(external, path.join(stateRoot, "workspace", "AGENTS.md"));

  const report = await inventoryOpenClawState({ root: stateRoot });

  assert.equal(report.scan.complete, false);
  assert.equal(report.managedWorkspaceFiles[0].status, "symlink-not-read");
  assert(!JSON.stringify(report).includes("external profile"));
});

void test("rejects a symlink as the state root", async (t) => {
  const { directory, stateRoot } = await fixture(t);
  const stateLink = path.join(directory, "state-link");
  await fs.symlink(stateRoot, stateLink);

  await assert.rejects(
    inventoryOpenClawState({ root: stateLink }),
    /state root must be a directory, not a symlink/,
  );
});

void test("validates the entry limit for programmatic callers", async (t) => {
  const { stateRoot } = await fixture(t);

  await assert.rejects(
    inventoryOpenClawState({ root: stateRoot, maxEntries: Number.POSITIVE_INFINITY }),
    /maxEntries must be a positive safe integer/,
  );
});
