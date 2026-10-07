import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

const DEFAULT_REPO = "https://github.com/Puli-AI-com/envoy-kb.git";
const DEFAULT_DEST = "/opt/puli/knowledge";
const UI_DIR = "ui-components";
const SECRET_PATH = "/run/secrets/github_token";

export function readToken() {
  if (fs.existsSync(SECRET_PATH)) {
    const token = fs.readFileSync(SECRET_PATH, "utf8").trim();
    if (token) {
      return token;
    }
  }
  return (process.env.COMPONENT_KB_GITHUB_TOKEN || "").trim();
}

function git(args, cwd) {
  return spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
}

function redact(text, token) {
  if (!token) {
    return text;
  }
  return text.split(token).join("[redacted]");
}

function validateManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    return "ui-components/manifest.yaml is missing";
  }
  let parsed;
  try {
    const { parse } = require("yaml");
    parsed = parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `ui-components/manifest.yaml did not parse: ${message}`;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "ui-components/manifest.yaml must be a mapping";
  }
  return null;
}

function chmodTree(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      chmodTree(entryPath);
      fs.chmodSync(entryPath, 0o755);
    } else {
      fs.chmodSync(entryPath, 0o644);
    }
  }
  fs.chmodSync(root, 0o755);
}

function publish(staging, dest) {
  const temporary = `${dest}.tmp`;
  fs.rmSync(temporary, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(staging, temporary, { recursive: true });
  chmodTree(temporary);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(temporary, dest);
}

export function installKnowledgeBase({
  repo = process.env.COMPONENT_KB_REPO || DEFAULT_REPO,
  dest = process.env.COMPONENT_KB_DEST || DEFAULT_DEST,
  token = readToken(),
  requireAtBuild = process.env.COMPONENT_KB_REQUIRE_AT_BUILD === "1",
} = {}) {
  const localRepo = repo.startsWith("file:");
  if (!token && !localRepo) {
    const message = "ui-component KB not installed: no GitHub token";
    if (requireAtBuild) {
      console.error(`install-knowledge-base: ${message}`);
      return 1;
    }
    console.warn(`install-knowledge-base: warning — ${message}`);
    return 0;
  }

  const stagingParent = fs.mkdtempSync(path.join(os.tmpdir(), "envoy-kb-"));
  const staging = path.join(stagingParent, "tree");
  try {
    const cloneArgs = ["clone", "--depth", "1", repo, staging];
    if (token) {
      // GitHub's OAuth tokens are rejected as a bearer header on git clone.
      // Basic auth with the x-access-token username is the form they accept.
      const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
      cloneArgs.unshift("-c", `http.extraheader=AUTHORIZATION: basic ${basic}`);
    }
    const clone = git(cloneArgs);
    if (clone.status !== 0) {
      const reason = redact((clone.stderr || clone.stdout || "git clone failed").trim(), token);
      console.error(`install-knowledge-base: clone failed: ${reason}`);
      return 1;
    }

    const sha = git(["rev-parse", "HEAD"], staging);
    if (sha.status !== 0) {
      console.error("install-knowledge-base: could not read cloned revision");
      return 1;
    }
    const revision = sha.stdout.trim();
    fs.rmSync(path.join(staging, ".git"), { recursive: true, force: true });

    const manifestError = validateManifest(path.join(staging, UI_DIR, "manifest.yaml"));
    if (manifestError) {
      console.error(`install-knowledge-base: ${manifestError}`);
      return 1;
    }

    fs.writeFileSync(path.join(staging, "REVISION"), `${revision}\n`);
    fs.writeFileSync(path.join(staging, UI_DIR, "REVISION"), `${revision}\n`);
    publish(staging, dest);
    console.log(`install-knowledge-base: ui-component KB revision ${revision}`);
    return 0;
  } finally {
    fs.rmSync(stagingParent, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(installKnowledgeBase());
}
