import type {
  AnyAgentTool,
  OpenClawPluginApi,
  OpenClawPluginToolFactory,
} from "openclaw/plugin-sdk/puli-discovery";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/puli-discovery";
import { createDiscoveryTools, DiscoveryToolError } from "./src/discovery-tools.js";
import { executorSystemPrompt, readExecutorInstructions } from "./src/executor-prompt.js";
import { bindRunFromPrompt, boundRun, forgetRun } from "./src/run-binding.js";

/** The agent the discovery lead spawns for each instruction (default-config/openclaw.json). */
export const EXECUTOR_AGENT_ID = "discovery-executor";

export const DISCOVERY_TOOL_NAMES = [
  "discovery_observe",
  "discovery_replay",
  "discovery_act",
  "discovery_report",
] as const;

const plugin = {
  id: "puli-discovery",
  name: "Puli Discovery",
  description:
    "The discovery executor's only tools: observe, replay, act and report on one leased device.",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    // The executor's first prompt carries the lead's task; its first line names the run.
    // before_model_resolve sees every run's prompt with its session key and changes nothing.
    api.on("before_model_resolve", (event, ctx) => {
      bindRunFromPrompt(ctx.sessionKey, event.prompt);
    });
    api.on("subagent_ended", (event) => {
      forgetRun(event.targetSessionKey);
    });

    // The executor's whole system prompt is its standing instructions from the CM image
    // ($RAMPUP_HOME/application-discovery/discovery-executor/INSTRUCTIONS.md) and the tools
    // line: nothing of the workspace it inherits from Paula (AGENTS.md, TOOLS.md, skills).
    // Every other agent's prompt is left alone. A hook error would be swallowed and the default
    // prompt used, so a missing file becomes a prompt that ends the run with the reason.
    api.on("before_prompt_build", async (_event, ctx) => {
      if (ctx.agentId !== EXECUTOR_AGENT_ID) {
        return undefined;
      }
      const instructions = await readExecutorInstructions(process.env);
      if (!instructions.ok) {
        api.logger.error(`puli-discovery: ${instructions.error}`);
      }
      return { systemPrompt: executorSystemPrompt(instructions) };
    });

    // Required, not optional: the executor agent's own allowlist (tools.profile "minimal"
    // plus alsoAllow) is the only gate. Only the executor agent gets them, so Paula's
    // context does not carry four tools she must never call.
    api.registerTool(
      ((ctx) => {
        if (ctx.sandboxed || ctx.agentId !== EXECUTOR_AGENT_ID) {
          return null;
        }
        return createDiscoveryTools(ctx, {
          runFor: boundRun,
          // No device action without the instructions the prompt is built from.
          ready: async () => {
            const instructions = await readExecutorInstructions(process.env);
            if (!instructions.ok) {
              throw new DiscoveryToolError(`no device action: ${instructions.error}`);
            }
          },
        }) as AnyAgentTool[];
      }) as OpenClawPluginToolFactory,
      { names: [...DISCOVERY_TOOL_NAMES] },
    );
  },
};

export default plugin;
