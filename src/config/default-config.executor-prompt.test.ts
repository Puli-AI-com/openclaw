import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveBootstrapContextForRun } from "../agents/bootstrap-files.js";
import { resolvePromptBuildHookResult } from "../agents/pi-embedded-runner/run/attempt.js";
import { createOpenClawCodingTools } from "../agents/pi-tools.js";
import { buildAgentSystemPrompt } from "../agents/system-prompt.js";
import { createHookRunner } from "../plugins/hooks.js";
import { loadOpenClawPlugins } from "../plugins/loader.js";
import type { OpenClawConfig } from "./config.js";

const defaultConfigPath = fileURLToPath(
  new URL("../../default-config/openclaw.json", import.meta.url),
);

const PAULA_MARKER = "PAULA-WORKSPACE-INSTRUCTIONS";
const EXECUTOR_MARKER = "EXECUTOR-STANDING-INSTRUCTIONS";
const EXECUTOR_KEY = "agent:discovery-executor:subagent:00000000-0000-0000-0000-000000000001";
const PAULA_KEY = "agent:paula:hook:rampup:discover:1";

function loadDefaultConfig(): OpenClawConfig {
  return JSON.parse(fs.readFileSync(defaultConfigPath, "utf8")) as OpenClawConfig;
}

describe("Puli image default config: the discovery executor's system prompt", () => {
  let root = "";
  let workspaceDir = "";
  let rampupHome = "";
  let runDir = "";

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-executor-prompt-"));
    // Paula's workspace: a spawned executor runs in it.
    workspaceDir = path.join(root, "workspace");
    fs.mkdirSync(workspaceDir);
    fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), `# Paula\n\n${PAULA_MARKER} agents\n`);
    fs.writeFileSync(path.join(workspaceDir, "TOOLS.md"), `# Tools\n\n${PAULA_MARKER} tools\n`);
    // The image's skills folder with the executor's instructions.
    rampupHome = path.join(root, "skills");
    const folder = path.join(rampupHome, "application-discovery", "discovery-executor");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "INSTRUCTIONS.md"), `# Executor\n\n${EXECUTOR_MARKER}\n`);
    // A run whose state leases device dev-1 to instruction i-1.
    runDir = path.join(root, "run");
    fs.mkdirSync(runDir);
    fs.writeFileSync(path.join(runDir, "run.yaml"), "kind: website\n");
    fs.writeFileSync(
      path.join(runDir, "discovery-state.json"),
      JSON.stringify({ leases: { "i-1": "dev-1" } }),
    );
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.stubEnv("RAMPUP_HOME", rampupHome);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** The system prompt a run ends up with, as the embedded runner builds it
   * (run/attempt.ts): the default prompt from the workspace files, then the
   * before_prompt_build hooks, whose systemPrompt replaces it whole. */
  async function effectiveSystemPrompt(config: OpenClawConfig, sessionKey: string) {
    const agentId = sessionKey.split(":")[1];
    const { contextFiles } = await resolveBootstrapContextForRun({
      workspaceDir,
      config,
      sessionKey,
    });
    const defaultPrompt = buildAgentSystemPrompt({
      workspaceDir,
      contextFiles,
      promptMode: sessionKey.includes(":subagent:") ? "minimal" : "full",
    });
    const registry = loadOpenClawPlugins({ config, workspaceDir });
    const result = await resolvePromptBuildHookResult({
      prompt: `[Subagent Task]: DISCOVERY_RUN=${path.join(runDir, "run.yaml")}\nInstruction i-1`,
      messages: [],
      hookCtx: { agentId, sessionKey },
      hookRunner: createHookRunner(registry),
    });
    const override = typeof result?.systemPrompt === "string" ? result.systemPrompt.trim() : "";
    return { defaultPrompt, prompt: override || defaultPrompt, overridden: Boolean(override) };
  }

  it("gives the executor its instructions and none of Paula's workspace files", async () => {
    const executor = await effectiveSystemPrompt(loadDefaultConfig(), EXECUTOR_KEY);

    // Without the plugin the executor would carry Paula's files.
    expect(executor.defaultPrompt).toContain(PAULA_MARKER);
    expect(executor.overridden).toBe(true);
    expect(executor.prompt).toContain(EXECUTOR_MARKER);
    expect(executor.prompt).toContain("discovery_observe, discovery_replay, discovery_act");
    expect(executor.prompt).not.toContain(PAULA_MARKER);
  });

  it("leaves Paula's prompt unchanged", async () => {
    const paula = await effectiveSystemPrompt(loadDefaultConfig(), PAULA_KEY);

    expect(paula.overridden).toBe(false);
    expect(paula.prompt).toBe(paula.defaultPrompt);
    expect(paula.prompt).toContain(`${PAULA_MARKER} agents`);
    expect(paula.prompt).toContain(`${PAULA_MARKER} tools`);
    expect(paula.prompt).not.toContain(EXECUTOR_MARKER);
  });

  it("keeps the executor's four tools, and they work", async () => {
    const config = loadDefaultConfig();
    const registry = loadOpenClawPlugins({ config, workspaceDir });
    // The spawn's task binds the run, as the gateway's before_model_resolve does.
    await createHookRunner(registry).runBeforeModelResolve(
      { prompt: `[Subagent Task]: DISCOVERY_RUN=${path.join(runDir, "run.yaml")}\nInstruction` },
      { agentId: "discovery-executor", sessionKey: EXECUTOR_KEY },
    );
    const tools = createOpenClawCodingTools({
      config,
      sessionKey: EXECUTOR_KEY,
      workspaceDir,
      agentDir: workspaceDir,
      modelProvider: "litellm",
      modelId: "gemini-3.1-flash-lite",
      senderIsOwner: true,
    });
    expect(tools.map((tool) => tool.name).toSorted()).toEqual([
      "discovery_act",
      "discovery_observe",
      "discovery_replay",
      "discovery_report",
    ]);

    const report = tools.find((tool) => tool.name === "discovery_report");
    const result = await report?.execute("call-1", {
      instruction_id: "i-1",
      device_id: "dev-1",
      markdown: "**Outcome:** done",
    });
    expect(result?.content).toEqual([{ type: "text", text: "saved results/i-1.md" }]);
    expect(fs.readFileSync(path.join(runDir, "results", "i-1.md"), "utf8")).toBe(
      "**Outcome:** done",
    );
  });

  it("fails the executor's run with the reason when its instructions are missing", async () => {
    vi.stubEnv("RAMPUP_HOME", path.join(root, "no-skills"));
    const executor = await effectiveSystemPrompt(loadDefaultConfig(), EXECUTOR_KEY);
    const missing = path.join(
      root,
      "no-skills",
      "application-discovery",
      "discovery-executor",
      "INSTRUCTIONS.md",
    );

    expect(executor.overridden).toBe(true);
    expect(executor.prompt).toContain(`EXECUTOR NOT CONFIGURED: `);
    expect(executor.prompt).toContain(`${missing} is missing`);
    expect(executor.prompt).not.toContain(PAULA_MARKER);
  });
});
