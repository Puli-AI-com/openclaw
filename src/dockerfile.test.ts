import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const dockerfilePath = join(repoRoot, "Dockerfile");

describe("Dockerfile", () => {
  it("uses shared multi-arch base image refs for all root Node stages", async () => {
    const dockerfile = await readFile(dockerfilePath, "utf8");
    expect(dockerfile).toContain(
      'ARG OPENCLAW_NODE_BOOKWORM_IMAGE="node:24-bookworm@sha256:3a09aa6354567619221ef6c45a5051b671f953f0a1924d1f819ffb236e520e6b"',
    );
    expect(dockerfile).toContain("FROM ${OPENCLAW_NODE_BOOKWORM_IMAGE} AS ext-deps");
    expect(dockerfile).toContain("FROM ${OPENCLAW_NODE_BOOKWORM_IMAGE} AS build");
    expect(dockerfile).toContain("FROM ${OPENCLAW_NODE_BOOKWORM_IMAGE} AS base-default");
    expect(dockerfile).toContain("current multi-arch manifest list entry");
    expect(dockerfile).not.toContain("current amd64 entry");
  });

  it("has no slim variant", async () => {
    const dockerfile = await readFile(dockerfilePath, "utf8");
    expect(dockerfile).not.toContain("bookworm-slim");
    expect(dockerfile).not.toContain("OPENCLAW_VARIANT");
    expect(dockerfile).toContain("FROM base-default");
  });

  it("creates the runner environment as the node user without a chown copy", async () => {
    const dockerfile = await readFile(dockerfilePath, "utf8");
    for (const source of ["shared_skills", "runner", "packages"]) {
      expect(dockerfile).toContain(`COPY --chown=node:node --from=${source}`);
    }
    // A chown -R over the runner environment rewrites it into a second layer.
    expect(dockerfile).not.toContain("chown -R node:node /app/envoy-tools");

    const nodeIndex = dockerfile.indexOf("USER node\nRUN cd /app/envoy-tools/runner && uv sync");
    const syncIndex = dockerfile.indexOf("uv sync --no-dev");
    const rootIndex = dockerfile.indexOf("USER root", syncIndex);
    const knowledgeIndex = dockerfile.indexOf("RUN --mount=type=secret,id=github_token");
    expect(nodeIndex).toBeGreaterThan(-1);
    expect(nodeIndex).toBeLessThan(syncIndex);
    // The knowledge-base step writes /opt/puli/knowledge and needs root.
    expect(rootIndex).toBeGreaterThan(syncIndex);
    expect(knowledgeIndex).toBeGreaterThan(rootIndex);
  });

  it("ends as the node user", async () => {
    const dockerfile = await readFile(dockerfilePath, "utf8");
    const users = dockerfile.match(/^USER .+$/gm) ?? [];
    expect(users.at(-1)).toBe("USER node");
  });

  it("removes the node-llama-cpp GPU backends in the runtime-assets stage and keeps the CPU one", async () => {
    const dockerfile = await readFile(dockerfilePath, "utf8");
    const stageStart = dockerfile.indexOf("FROM build AS runtime-assets");
    const stageEnd = dockerfile.indexOf("# ── Runtime base images");
    const stage = dockerfile.slice(stageStart, stageEnd);
    expect(stageStart).toBeGreaterThan(-1);
    expect(stageEnd).toBeGreaterThan(stageStart);
    for (const backend of ["linux-x64-cuda-ext", "linux-x64-cuda", "linux-x64-vulkan"]) {
      expect(stage).toContain(`@node-llama-cpp+${backend}@*`);
      expect(stage).toContain(`-name ${backend}`);
    }
    // The CPU backend (@node-llama-cpp/linux-x64) must not be deleted.
    expect(stage).not.toMatch(/@node-llama-cpp\+linux-x64@/);
    expect(stage).not.toMatch(/-name linux-x64 /);
  });

  it("installs optional browser dependencies after pnpm install", async () => {
    const dockerfile = await readFile(dockerfilePath, "utf8");
    const installIndex = dockerfile.indexOf("pnpm install --frozen-lockfile");
    const browserArgIndex = dockerfile.indexOf("ARG OPENCLAW_INSTALL_BROWSER");

    expect(installIndex).toBeGreaterThan(-1);
    expect(browserArgIndex).toBeGreaterThan(-1);
    expect(browserArgIndex).toBeGreaterThan(installIndex);
    expect(dockerfile).toContain(
      "node /app/node_modules/playwright-core/cli.js install --with-deps chromium",
    );
    expect(dockerfile).toContain("apt-get install -y --no-install-recommends xvfb");
  });

  it("prunes runtime dependencies after the build stage", async () => {
    const dockerfile = await readFile(dockerfilePath, "utf8");
    expect(dockerfile).toContain("FROM build AS runtime-assets");
    expect(dockerfile).toContain("CI=true pnpm prune --prod");
    expect(dockerfile).toContain(
      "COPY --from=runtime-assets --chown=node:node /app/node_modules ./node_modules",
    );
  });

  it("normalizes plugin and agent paths permissions in image layers", async () => {
    const dockerfile = await readFile(dockerfilePath, "utf8");
    expect(dockerfile).toContain("for dir in /app/extensions /app/.agent /app/.agents");
    expect(dockerfile).toContain('find "$dir" -type d -exec chmod 755 {} +');
    expect(dockerfile).toContain('find "$dir" -type f -exec chmod 644 {} +');
  });

  it("Docker GPG fingerprint awk uses correct quoting for OPENCLAW_SANDBOX=1 build", async () => {
    const dockerfile = await readFile(dockerfilePath, "utf8");
    expect(dockerfile).toContain('== "fpr" {');
    expect(dockerfile).not.toContain('\\"fpr\\"');
  });

  it("keeps runtime pnpm available", async () => {
    const dockerfile = await readFile(dockerfilePath, "utf8");
    expect(dockerfile).toContain("ENV COREPACK_HOME=/usr/local/share/corepack");
    expect(dockerfile).toContain(
      'corepack prepare "$(node -p "require(\'./package.json\').packageManager")" --activate',
    );
  });
});
