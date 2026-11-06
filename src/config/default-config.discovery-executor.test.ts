import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveAgentSkillsFilter } from "../agents/agent-scope.js";
import { resolveSubagentSpawnModelSelection } from "../agents/model-selection.js";
import { createOpenClawCodingTools } from "../agents/pi-tools.js";
import { buildWorkspaceSkillSnapshot } from "../agents/skills.js";
import type { OpenClawConfig } from "./config.js";
import { validateConfigObjectRaw } from "./validation.js";

const defaultConfigPath = fileURLToPath(
  new URL("../../default-config/openclaw.json", import.meta.url),
);

const DISCOVERY_TOOLS = [
  "discovery_act",
  "discovery_observe",
  "discovery_replay",
  "discovery_report",
];

function loadDefaultConfig(): OpenClawConfig {
  return JSON.parse(fs.readFileSync(defaultConfigPath, "utf8")) as OpenClawConfig;
}

describe("Puli image default config: discovery executor", () => {
  let workspaceDir = "";

  beforeAll(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-discovery-executor-"));
  });

  afterAll(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  function toolNames(sessionKey: string): string[] {
    const tools = createOpenClawCodingTools({
      config: loadDefaultConfig(),
      sessionKey,
      workspaceDir,
      agentDir: workspaceDir,
      modelProvider: "litellm",
      modelId: "gemini-3.1-flash-lite",
      senderIsOwner: true,
    });
    return tools.map((tool) => tool.name).toSorted();
  }

  it("is schema-valid with the executor agent and the plugin", () => {
    expect(validateConfigObjectRaw(loadDefaultConfig())).toMatchObject({ ok: true });
  });

  it("gives a spawned discovery executor exactly the four discovery tools", () => {
    const names = toolNames(
      "agent:discovery-executor:subagent:00000000-0000-0000-0000-000000000001",
    );

    expect(names).toEqual(DISCOVERY_TOOLS);
    for (const forbidden of ["exec", "process", "write", "edit", "read", "browser", "nodes"]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it("keeps the discovery tools away from Paula", () => {
    const names = toolNames("agent:paula:hook:rampup:discover:1");

    expect(names).toContain("sessions_spawn");
    for (const tool of DISCOVERY_TOOLS) {
      expect(names).not.toContain(tool);
    }
  });

  it("lets Paula spawn the executor, on flash-lite unless the spawn names another model", () => {
    const config = loadDefaultConfig();
    const paula = config.agents?.list?.find((agent) => agent.id === "paula");

    expect(paula?.subagents?.allowAgents).toEqual(["discovery-executor"]);
    expect(resolveSubagentSpawnModelSelection({ cfg: config, agentId: "discovery-executor" })).toBe(
      "litellm/gemini-3.1-flash-lite",
    );
    // The third attempt's per-spawn model: no agents.defaults.models allowlist refuses it.
    expect(config.agents?.defaults?.models).toBeUndefined();
    expect(
      resolveSubagentSpawnModelSelection({
        cfg: config,
        agentId: "discovery-executor",
        modelOverride: "litellm/claude-sonnet-4-6",
      }),
    ).toBe("litellm/claude-sonnet-4-6");
  });

  it("lists no skills in the executor's prompt, while Paula keeps hers", () => {
    // A spawned executor runs in Paula's workspace; without `skills: []` its prompt would list
    // her skills and tell it to read their SKILL.md, a tool it does not have.
    const skillDir = path.join(workspaceDir, "skills", "demo-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: demo-skill\ndescription: A skill only Paula should see.\n---\n\nBody.\n",
    );
    const config = loadDefaultConfig();
    const snapshotFor = (agentId: string) =>
      buildWorkspaceSkillSnapshot(workspaceDir, {
        config,
        skillFilter: resolveAgentSkillsFilter(config, agentId),
      });

    expect(resolveAgentSkillsFilter(config, "discovery-executor")).toEqual([]);
    expect(snapshotFor("discovery-executor").prompt.trim()).toBe("");
    expect(snapshotFor("paula").prompt).toContain("demo-skill");
  });

  it("lists flash-lite on the litellm provider with image input", () => {
    const models = loadDefaultConfig().models?.providers?.litellm?.models ?? [];

    expect(models.map((model) => model.id)).toEqual(["claude-sonnet-4-6", "gemini-3.1-flash-lite"]);
    expect(models.find((model) => model.id === "gemini-3.1-flash-lite")?.input).toEqual([
      "text",
      "image",
    ]);
  });
});
