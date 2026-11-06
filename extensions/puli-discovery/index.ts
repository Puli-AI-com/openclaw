import type {
  AnyAgentTool,
  OpenClawPluginApi,
  OpenClawPluginToolFactory,
} from "openclaw/plugin-sdk/puli-discovery";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/puli-discovery";
import { createDiscoveryTools } from "./src/discovery-tools.js";
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

    // Required, not optional: the executor agent's own allowlist (tools.profile "minimal"
    // plus alsoAllow) is the only gate. Only the executor agent gets them, so Paula's
    // context does not carry four tools she must never call.
    api.registerTool(
      ((ctx) => {
        if (ctx.sandboxed || ctx.agentId !== EXECUTOR_AGENT_ID) {
          return null;
        }
        return createDiscoveryTools(ctx, { runFor: boundRun }) as AnyAgentTool[];
      }) as OpenClawPluginToolFactory,
      { names: [...DISCOVERY_TOOL_NAMES] },
    );
  },
};

export default plugin;
