import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  AnyAgentTool,
  OpenClawPluginApi,
  OpenClawPluginToolFactory,
} from "openclaw/plugin-sdk/puli-discovery";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import plugin, { DISCOVERY_TOOL_NAMES, EXECUTOR_AGENT_ID } from "./index.js";
import { NOT_CONFIGURED, TOOLS_LINE } from "./src/executor-prompt.js";
import { resetRunBindingsForTests } from "./src/run-binding.js";

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;

function registerPlugin() {
  const factories: Array<{ factory: OpenClawPluginToolFactory; names?: string[] }> = [];
  const hooks = new Map<string, Handler>();
  const errors: string[] = [];
  const api = {
    logger: { info() {}, warn() {}, debug() {}, error: (message: string) => errors.push(message) },
    registerTool: (tool: OpenClawPluginToolFactory, opts?: { names?: string[] }) => {
      factories.push({ factory: tool, names: opts?.names });
    },
    on: (name: string, handler: Handler) => {
      hooks.set(name, handler);
    },
  } as unknown as OpenClawPluginApi;
  plugin.register(api);
  return { factories, hooks, errors };
}

const executorKey = `agent:${EXECUTOR_AGENT_ID}:subagent:abc`;

const INSTRUCTIONS = "You are a discovery executor. Replay, act, observe, report.";
let rampupHome = "";

describe("puli-discovery plugin", () => {
  beforeAll(async () => {
    rampupHome = await fs.mkdtemp(path.join(os.tmpdir(), "puli-discovery-home-"));
    const folder = path.join(rampupHome, "application-discovery", "discovery-executor");
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, "INSTRUCTIONS.md"), `${INSTRUCTIONS}\n`);
  });

  afterAll(async () => {
    await fs.rm(rampupHome, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.stubEnv("RAMPUP_HOME", rampupHome);
  });

  afterEach(() => {
    resetRunBindingsForTests();
    vi.unstubAllEnvs();
  });

  it("replaces the executor's whole system prompt with its instructions and the tools line", async () => {
    const { hooks } = registerPlugin();
    const result = (await hooks.get("before_prompt_build")?.(
      { prompt: "[Subagent Task]: DISCOVERY_RUN=/r/run.yaml", messages: [] },
      { agentId: EXECUTOR_AGENT_ID, sessionKey: executorKey },
    )) as { systemPrompt?: string };
    expect(result.systemPrompt).toBe(`${INSTRUCTIONS}\n\n${TOOLS_LINE}`);
  });

  it("leaves every other agent's prompt alone", async () => {
    const { hooks } = registerPlugin();
    for (const agentId of ["paula", "main", undefined]) {
      const result = await hooks.get("before_prompt_build")?.(
        { prompt: "hello", messages: [] },
        { agentId, sessionKey: "hook:rampup:discover:1" },
      );
      expect(result).toBeUndefined();
    }
  });

  it("ends the executor's run with the reason when its instructions are missing", async () => {
    vi.stubEnv("RAMPUP_HOME", path.join(rampupHome, "nowhere"));
    const { hooks, factories, errors } = registerPlugin();
    const result = (await hooks.get("before_prompt_build")?.(
      { prompt: "x", messages: [] },
      { agentId: EXECUTOR_AGENT_ID, sessionKey: executorKey },
    )) as { systemPrompt?: string };
    const missing = path.join(
      rampupHome,
      "nowhere",
      "application-discovery",
      "discovery-executor",
      "INSTRUCTIONS.md",
    );
    expect(result.systemPrompt).toContain(`${NOT_CONFIGURED}: `);
    expect(result.systemPrompt).toContain(`${missing} is missing`);
    expect(result.systemPrompt).toContain("Do not call any tool.");
    expect(errors.join("\n")).toContain(missing);

    const tools = factories[0].factory({
      agentId: EXECUTOR_AGENT_ID,
      sessionKey: executorKey,
    }) as AnyAgentTool[];
    for (const tool of tools) {
      await expect(
        tool.execute("c", {
          instruction_id: "i-1",
          device_id: "dev-1",
          page_id: "p",
          action: "back",
          markdown: "x",
        }),
      ).rejects.toThrow(`no device action: the discovery executor's instructions ${missing}`);
    }
  });

  it("registers the four tools, required, under their names", () => {
    const { factories } = registerPlugin();
    expect(factories).toHaveLength(1);
    expect(factories[0].names).toEqual([...DISCOVERY_TOOL_NAMES]);
  });

  it("gives the tools to the executor agent only", () => {
    const { factories } = registerPlugin();
    const factory = factories[0].factory;
    const executorTools = factory({ agentId: EXECUTOR_AGENT_ID, sessionKey: executorKey });
    expect((executorTools as AnyAgentTool[]).map((tool) => tool.name)).toEqual([
      ...DISCOVERY_TOOL_NAMES,
    ]);
    expect(factory({ agentId: "paula", sessionKey: "hook:rampup:discover:1" })).toBeNull();
    expect(factory({ agentId: EXECUTOR_AGENT_ID, sessionKey: executorKey, sandboxed: true })).toBe(
      null,
    );
  });

  it("binds the run named by the spawn's task and forgets it when the executor ends", async () => {
    const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "puli-discovery-index-"));
    try {
      const runPath = path.join(runDir, "run.yaml");
      await fs.writeFile(runPath, "kind: website\n");
      const { factories, hooks } = registerPlugin();
      const tools = factories[0].factory({
        agentId: EXECUTOR_AGENT_ID,
        sessionKey: executorKey,
      }) as AnyAgentTool[];
      const report = tools.find((tool) => tool.name === "discovery_report") as AnyAgentTool;
      const args = { instruction_id: "i-1", device_id: "dev-1", markdown: "done" };

      await expect(report.execute("c", args)).rejects.toThrow("DISCOVERY_RUN is not set");

      await hooks.get("before_model_resolve")?.(
        { prompt: `[Subagent Task]: DISCOVERY_RUN=${runPath}\nInstruction i-1` },
        { sessionKey: executorKey, agentId: EXECUTOR_AGENT_ID },
      );
      // Bound: the lease check now reads this run's state, which leases nothing yet.
      await expect(report.execute("c", args)).rejects.toThrow("is not leased");

      await fs.writeFile(
        path.join(runDir, "discovery-state.json"),
        JSON.stringify({ leases: { "i-1": "dev-1" } }),
      );
      await report.execute("c", args);
      expect(await fs.readFile(path.join(runDir, "results", "i-1.md"), "utf8")).toBe("done");

      await hooks.get("subagent_ended")?.({ targetSessionKey: executorKey }, {});
      await expect(report.execute("c", args)).rejects.toThrow("DISCOVERY_RUN is not set");
    } finally {
      await fs.rm(runDir, { recursive: true, force: true });
    }
  });
});
