import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { AnyAgentTool, OpenClawPluginToolContext } from "openclaw/plugin-sdk/puli-discovery";
import {
  resolveImageSanitizationLimits,
  sanitizeToolResultImages,
} from "openclaw/plugin-sdk/puli-discovery";

// The executor tools mirror skills/application-discovery/scripts/discovery_mcp.py in
// puli-crowdtest: the same tools, arguments, lease check and results, but each device call
// runs the device helpers' CLI instead of importing them:
//   uv run --project $DISCOVERY_PROJECT python \
//     $RAMPUP_HOME/application-discovery/scripts/device_helpers.py <cmd> --run <run.yaml> ...

/** page_tools.MAX_VIEWPORTS in the skills; observe never asks for more. */
export const MAX_VIEWPORTS = 10;
/** The state file beside run.yaml that holds the lead's leases (run_files.STATE_NAME). */
export const STATE_NAME = "discovery-state.json";
/** device_helpers._ID: an instruction id names a file, so letters, digits, . _ - only. */
const INSTRUCTION_ID = /^[\p{L}\p{N}_.-]+$/u;
/** One device call; a replay walks a whole path, so this is generous. The executor's own
 * run timeout (sessions_spawn runTimeoutSeconds) still bounds the whole instruction. */
const HELPER_TIMEOUT_MS = 15 * 60_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export type HelperRun = { code: number; stdout: string; stderr: string };
export type HelperRunner = (params: {
  argv: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  signal?: AbortSignal;
}) => Promise<HelperRun>;

export type DiscoveryToolDeps = {
  /** The run.yaml this session's task named (run-binding.ts). */
  runFor: (sessionKey: string | undefined) => string | undefined;
  runHelper?: HelperRunner;
  env?: NodeJS.ProcessEnv;
};

type ToolResult = Awaited<ReturnType<AnyAgentTool["execute"]>>;

export class DiscoveryToolError extends Error {}

function discoveryProject(env: NodeJS.ProcessEnv): { project: string; script: string } {
  const home = env.RAMPUP_HOME?.trim();
  if (!home) {
    throw new DiscoveryToolError("RAMPUP_HOME is not set: the device helpers cannot be found");
  }
  const project =
    env.DISCOVERY_PROJECT?.trim() ||
    env.APPLICATION_DISCOVERY_PROJECT?.trim() ||
    path.join(home, "application-discovery");
  return {
    project,
    script: path.join(home, "application-discovery", "scripts", "device_helpers.py"),
  };
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** discovery_mcp._leased: the run, once the state file confirms the lease; read fresh on
 * every call. */
export async function leasedRun(
  runPath: string | undefined,
  instructionId: string,
  deviceId: string,
): Promise<string> {
  if (!runPath) {
    throw new DiscoveryToolError(
      "DISCOVERY_RUN is not set: the task's first line must be DISCOVERY_RUN=<path to run.yaml>",
    );
  }
  if (!(await exists(runPath))) {
    throw new DiscoveryToolError(`run file not found: ${runPath}`);
  }
  const stateFile = path.join(path.dirname(runPath), STATE_NAME);
  let leases: Record<string, unknown> = {};
  if (await exists(stateFile)) {
    const state = JSON.parse(await fs.readFile(stateFile, "utf8")) as { leases?: unknown };
    if (state.leases && typeof state.leases === "object") {
      leases = state.leases as Record<string, unknown>;
    }
  }
  if (leases[instructionId] !== deviceId) {
    throw new DiscoveryToolError(
      `device '${deviceId}' is not leased to instruction '${instructionId}'`,
    );
  }
  return runPath;
}

export const spawnHelper: HelperRunner = ({ argv, env, cwd, signal }) =>
  new Promise((resolve, reject) => {
    const [command, ...args] = argv;
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], signal });
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let settled = false;
    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn();
      }
    };
    const fail = (message: string) => {
      child.kill("SIGKILL");
      settle(() => reject(new DiscoveryToolError(message)));
    };
    const timer = setTimeout(
      () => fail(`device helper timed out after ${HELPER_TIMEOUT_MS / 1000} s`),
      HELPER_TIMEOUT_MS,
    );
    const take = (chunk: Buffer, into: "stdout" | "stderr") => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) {
        fail("device helper output exceeded its limit");
        return;
      }
      if (into === "stdout") {
        stdout += chunk.toString("utf8");
      } else {
        stderr += chunk.toString("utf8");
      }
    };
    child.stdout?.on("data", (chunk: Buffer) => take(chunk, "stdout"));
    child.stderr?.on("data", (chunk: Buffer) => take(chunk, "stderr"));
    child.once("error", (error) => settle(() => reject(error)));
    child.once("close", (code) => settle(() => resolve({ code: code ?? 1, stdout, stderr })));
  });

/** What the helper said went wrong: its last stderr line when that is `{"error": ...}`
 * (a refused run file or a discovery error), else all of stderr (a device error). */
function helperError(run: HelperRun): string {
  const lines = run.stderr.trim().split(/\r?\n/).filter(Boolean);
  const last = lines.at(-1);
  if (last) {
    try {
      const parsed = JSON.parse(last) as { error?: unknown };
      if (typeof parsed.error === "string") {
        return parsed.error;
      }
    } catch {
      // Not JSON: a device error or a uv failure, reported whole below.
    }
  }
  return run.stderr.trim() || run.stdout.trim() || `device helper exited ${run.code}`;
}

/** The helper's JSON result. It prints one indented object; anything printed before it
 * (a library's stray line) is skipped. */
export function parseHelperJson(stdout: string): Record<string, unknown> {
  const text = stdout.trim();
  const starts = [0];
  for (let at = text.indexOf("\n{"); at >= 0; at = text.indexOf("\n{", at + 1)) {
    starts.push(at + 1);
  }
  for (const start of starts) {
    try {
      const parsed = JSON.parse(text.slice(start)) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next object start.
    }
  }
  throw new DiscoveryToolError(`device helper printed no JSON result: ${text.slice(0, 500)}`);
}

function mimeFor(file: string): string {
  const ext = path.extname(file).toLowerCase();
  return ext === ".jpg" || ext === ".jpeg"
    ? "image/jpeg"
    : ext === ".webp"
      ? "image/webp"
      : "image/png";
}

/** discovery_mcp._content: the result as JSON text plus each screenshot as an image. A
 * screenshot that cannot be read is named in a text block instead, so the result of a
 * press that already happened is never lost. */
async function contentFor(
  result: Record<string, unknown>,
  cwd: string,
  ctx: OpenClawPluginToolContext,
  label: string,
): Promise<ToolResult> {
  const shots = Array.isArray(result.screenshots)
    ? result.screenshots.filter((shot): shot is string => typeof shot === "string")
    : typeof result.screenshot === "string" && result.screenshot
      ? [result.screenshot]
      : [];
  const content: ToolResult["content"] = [{ type: "text", text: JSON.stringify(result) }];
  for (const shot of shots) {
    const file = path.resolve(cwd, shot);
    try {
      const data = (await fs.readFile(file)).toString("base64");
      content.push({ type: "image", data, mimeType: mimeFor(file) });
    } catch (error) {
      content.push({
        type: "text",
        text: `screenshot ${shot} could not be read: ${String(error)}`,
      });
    }
  }
  return await sanitizeToolResultImages(
    { content, details: result },
    label,
    resolveImageSanitizationLimits(ctx.config),
  );
}

function stringParam(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || !value) {
    throw new DiscoveryToolError(`${key} is required`);
  }
  return value;
}

function optionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new DiscoveryToolError(`${key} must be a string`);
  }
  return value;
}

/** The command line for one device-helper call. Values go as `--flag=value`, so a dummy
 * text that starts with a dash is never read as an option; `true` is a bare `--flag`. */
export function helperArgv(
  env: NodeJS.ProcessEnv,
  command: "observe" | "replay" | "act",
  runPath: string,
  deviceId: string,
  instructionId: string,
  extra: Array<[string, string | true | undefined]>,
): string[] {
  const { project, script } = discoveryProject(env);
  const argv = [
    "uv",
    "run",
    "--project",
    project,
    "python",
    script,
    command,
    `--run=${runPath}`,
    `--device=${deviceId}`,
    `--instruction=${instructionId}`,
  ];
  for (const [flag, value] of extra) {
    if (value === true) {
      argv.push(`--${flag}`);
    } else if (value !== undefined) {
      argv.push(`--${flag}=${value}`);
    }
  }
  return argv;
}

const INSTRUCTION_ID_PARAM = Type.String({
  description: "The id of the instruction the lead gave you.",
});
const DEVICE_ID_PARAM = Type.String({ description: "The id of the device leased to you." });

export function createDiscoveryTools(
  ctx: OpenClawPluginToolContext,
  deps: DiscoveryToolDeps,
): AnyAgentTool[] {
  const env = deps.env ?? process.env;
  const runHelper = deps.runHelper ?? spawnHelper;

  async function callHelper(
    command: "observe" | "replay" | "act",
    params: Record<string, unknown>,
    extra: Array<[string, string | true | undefined]>,
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    const instructionId = stringParam(params, "instruction_id");
    const deviceId = stringParam(params, "device_id");
    const runPath = await leasedRun(deps.runFor(ctx.sessionKey), instructionId, deviceId);
    const cwd = path.dirname(runPath);
    const run = await runHelper({
      argv: helperArgv(env, command, runPath, deviceId, instructionId, extra),
      env: { ...env, DISCOVERY_RUN: runPath },
      cwd,
      signal,
    });
    if (run.code !== 0) {
      throw new DiscoveryToolError(helperError(run));
    }
    return await contentFor(parseHelperJson(run.stdout), cwd, ctx, `discovery_${command}`);
  }

  const observe: AnyAgentTool = {
    name: "discovery_observe",
    label: "Discovery observe",
    description:
      "Read the page on screen: its controls (key, label, role, kind, refused reason, and " +
      "`allowed`, the allow line and its why when one let the control through, and `overridden`: " +
      "true on a refused control the lead lifted the refusal of, which `act` then presses), a " +
      "proposed page identity, and a screenshot per viewport. `viewports` > 1 scrolls down " +
      "through the page first.",
    parameters: Type.Object({
      instruction_id: INSTRUCTION_ID_PARAM,
      device_id: DEVICE_ID_PARAM,
      viewports: Type.Optional(
        Type.Integer({ description: `Viewports to read, 1 to ${MAX_VIEWPORTS}; default 1.` }),
      ),
    }),
    execute: async (_id, args, signal) => {
      const params = args as Record<string, unknown>;
      const requested = typeof params.viewports === "number" ? Math.trunc(params.viewports) : 1;
      const viewports = Math.max(1, Math.min(requested, MAX_VIEWPORTS));
      return await callHelper("observe", params, [["max-viewports", String(viewports)]], signal);
    },
  };

  const replay: AnyAgentTool = {
    name: "discovery_replay",
    label: "Discovery replay",
    description:
      "Cold start and walk to `page_id` along its saved path. Returns landed, at, failed_step " +
      "and a screenshot.",
    parameters: Type.Object({
      instruction_id: INSTRUCTION_ID_PARAM,
      device_id: DEVICE_ID_PARAM,
      page_id: Type.String({ description: "The page id the instruction starts from." }),
    }),
    execute: async (_id, args, signal) => {
      const params = args as Record<string, unknown>;
      // --executor: an executor's replay is not recorded on the page; only the lead's own
      // replay is (lead_state.record_replay), as discovery_mcp.py does.
      return await callHelper(
        "replay",
        params,
        [
          ["page", stringParam(params, "page_id")],
          ["executor", true],
        ],
        signal,
      );
    },
  };

  const act: AnyAgentTool = {
    name: "discovery_act",
    label: "Discovery act",
    description:
      "One action: tap, type, long-press, swipe-left, swipe-right, scroll or back. `control` is " +
      "a key from observe (not needed for back, or for a page scroll or swipe); `text` is the " +
      "dummy text for type; `row` is a text the wanted row shows, for a control on several rows " +
      "(observe's `row_texts`), or `#N` for the Nth row on screen. Refused controls come back as " +
      'refused with a reason; a page swipe with nowhere safe to start comes back as skipped, "no ' +
      'safe start point".',
    parameters: Type.Object({
      instruction_id: INSTRUCTION_ID_PARAM,
      device_id: DEVICE_ID_PARAM,
      action: Type.String({
        description: "tap, type, long-press, swipe-left, swipe-right, scroll or back.",
      }),
      control: Type.Optional(Type.String({ description: "A control key from observe." })),
      text: Type.Optional(Type.String({ description: "Dummy text for type." })),
      row: Type.Optional(Type.String({ description: "A text the wanted row shows, or #N." })),
    }),
    execute: async (_id, args, signal) => {
      const params = args as Record<string, unknown>;
      return await callHelper(
        "act",
        params,
        [
          ["control", optionalString(params, "control")],
          ["action", stringParam(params, "action")],
          ["text", optionalString(params, "text")],
          ["row", optionalString(params, "row")],
        ],
        signal,
      );
    },
  };

  const report: AnyAgentTool = {
    name: "discovery_report",
    label: "Discovery report",
    description:
      "Write this instruction's result: outcome, whether a new page was reached, and every " +
      "refusal with its reason.",
    parameters: Type.Object({
      instruction_id: INSTRUCTION_ID_PARAM,
      device_id: DEVICE_ID_PARAM,
      markdown: Type.String({ description: "The short markdown result." }),
    }),
    execute: async (_id, args) => {
      const params = args as Record<string, unknown>;
      const instructionId = stringParam(params, "instruction_id");
      const deviceId = stringParam(params, "device_id");
      const markdown = typeof params.markdown === "string" ? params.markdown : "";
      const runPath = await leasedRun(deps.runFor(ctx.sessionKey), instructionId, deviceId);
      if (!INSTRUCTION_ID.test(instructionId)) {
        throw new DiscoveryToolError(
          `instruction id '${instructionId}' must be letters, digits, . _ -`,
        );
      }
      const folder = path.join(path.dirname(runPath), "results");
      await fs.mkdir(folder, { recursive: true });
      const name = `${instructionId}.md`;
      await fs.writeFile(path.join(folder, name), markdown, "utf8");
      const text = `saved results/${name}`;
      return { content: [{ type: "text", text }], details: { saved: `results/${name}` } };
    },
  };

  return [observe, replay, act, report];
}
