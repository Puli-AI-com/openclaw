import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";

// sessions.stop end to end: real hook dispatch, real cron turn, real embedded runner, real
// exec tool and process supervisor, real subagent registry, and the real discovery tools
// running `uv run python`. Only the model is scripted (pi-ai's streamSimple), which also
// counts the model requests a stopped hook must not send.

type ModelCall = { marker: string; toolResults: number; prompt: string };
type ModelAction =
  | { kind: "hold" }
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; args: Record<string, unknown>; text?: string }
  | { kind: "error"; message: string };

const model = vi.hoisted(() => ({
  calls: [] as Array<{ marker: string; toolResults: number; prompt: string }>,
  script: null as null | ((call: ModelCall) => ModelAction | Promise<ModelAction>),
}));

// Holds a hook's pre-run setup (the cron run awaits the workspace before it queues the turn).
const setupGate = vi.hoisted(() => ({ pending: null as null | Promise<void> }));

const pluginTools = vi.hoisted(() => ({
  resolve: null as null | ((ctx: { sessionKey?: string; agentId?: string }) => unknown[]),
}));

vi.mock("../agents/tools/image-tool.js", () => ({ createImageTool: () => null }));
vi.mock("../agents/tools/web-tools.js", () => ({
  createWebSearchTool: () => null,
  createWebFetchTool: () => null,
}));
vi.mock("../agents/workspace.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agents/workspace.js")>();
  return {
    ...actual,
    ensureAgentWorkspace: async (...args: Parameters<typeof actual.ensureAgentWorkspace>) => {
      await setupGate.pending;
      return await actual.ensureAgentWorkspace(...args);
    },
  };
});
vi.mock("../plugins/tools.js", () => ({
  resolvePluginTools: (params: { context: { sessionKey?: string; agentId?: string } }) =>
    pluginTools.resolve?.(params.context) ?? [],
  getPluginToolMeta: () => undefined,
}));

vi.mock("@mariozechner/pi-coding-agent", async () => {
  return await vi.importActual<typeof import("@mariozechner/pi-coding-agent")>(
    "@mariozechner/pi-coding-agent",
  );
});

vi.mock("@mariozechner/pi-ai", async () => {
  const actual = await vi.importActual<typeof import("@mariozechner/pi-ai")>("@mariozechner/pi-ai");
  const usage = {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  const textOf = (content: unknown): string => {
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .map((part) => (part as { type?: string; text?: string }).text ?? "")
        .join("\n");
    }
    return "";
  };
  return {
    ...actual,
    streamSimple: (
      m: { api: string; provider: string; id: string },
      context: { messages: Array<{ role: string; content: unknown }> },
      options?: { signal?: AbortSignal },
    ) => {
      const stream = actual.createAssistantMessageEventStream();
      const userText = context.messages
        .filter((message) => message.role === "user")
        .map((message) => textOf(message.content))
        .join("\n");
      const call: ModelCall = {
        marker: /MARK-[A-Za-z0-9-]+/.exec(userText)?.[0] ?? "",
        toolResults: context.messages.filter((message) => message.role === "toolResult").length,
        prompt: userText,
      };
      model.calls.push(call);
      const build = (content: unknown[], stopReason: string, errorMessage?: string) => ({
        role: "assistant" as const,
        content,
        stopReason,
        ...(errorMessage ? { errorMessage } : {}),
        api: m.api,
        provider: m.provider,
        model: m.id,
        usage,
        timestamp: Date.now(),
      });
      const finishAborted = () => {
        const message = build([], "aborted", "aborted");
        stream.push({ type: "error", reason: "aborted", error: message } as never);
        stream.end();
      };
      void (async () => {
        const action = (await model.script?.(call)) ?? { kind: "text", text: "ok" };
        if (action.kind === "hold") {
          if (options?.signal?.aborted) {
            finishAborted();
            return;
          }
          await new Promise<void>((resolve) =>
            options?.signal?.addEventListener("abort", () => resolve(), { once: true }),
          );
          finishAborted();
          return;
        }
        if (action.kind === "error") {
          const message = build([], "error", action.message);
          stream.push({ type: "error", reason: "error", error: message } as never);
          stream.end();
          return;
        }
        const message =
          action.kind === "text"
            ? build([{ type: "text", text: action.text }], "stop")
            : build(
                [
                  ...(action.text ? [{ type: "text", text: action.text }] : []),
                  {
                    type: "toolCall",
                    id: `call-${model.calls.length}`,
                    name: action.name,
                    arguments: action.args,
                  },
                ],
                "toolUse",
              );
        stream.push({
          type: "done",
          reason: action.kind === "text" ? "stop" : "toolUse",
          message,
        } as never);
        stream.end();
      })();
      return stream;
    },
  };
});

let root: string;
let discoveryHome: string;
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
  "OPENCLAW_STATE_DIR",
  "OPENCLAW_CONFIG_PATH",
  "OPENCLAW_HOME",
  "OPENCLAW_TEST_FAST",
  "RAMPUP_HOME",
  "DISCOVERY_PROJECT",
];

type Modules = {
  createGatewayHooksRequestHandler: typeof import("./server/hooks.js").createGatewayHooksRequestHandler;
  resolveHooksConfig: typeof import("./hooks.js").resolveHooksConfig;
  sessionsHandlers: typeof import("./server-methods/sessions.js").sessionsHandlers;
  loadConfig: typeof import("../config/config.js").loadConfig;
  clearConfigCache: typeof import("../config/config.js").clearConfigCache;
  drainSystemEvents: typeof import("../infra/system-events.js").drainSystemEvents;
  resolveMainSessionKeyFromConfig: typeof import("../config/sessions.js").resolveMainSessionKeyFromConfig;
  addSubagentRunForTests: typeof import("../agents/subagent-registry.js").addSubagentRunForTests;
  resetSubagentRegistryForTests: typeof import("../agents/subagent-registry.js").resetSubagentRegistryForTests;
  runEmbeddedPiAgent: typeof import("../agents/pi-embedded-runner/run.js").runEmbeddedPiAgent;
  loadSessionStore: typeof import("../config/sessions.js").loadSessionStore;
  updateSessionStore: typeof import("../config/sessions.js").updateSessionStore;
  resolveStorePath: typeof import("../config/sessions.js").resolveStorePath;
  setCommandLaneConcurrency: typeof import("../process/command-queue.js").setCommandLaneConcurrency;
  resolveAgentDir: typeof import("../agents/agent-scope.js").resolveAgentDir;
  createDiscoveryTools: typeof import("../../extensions/puli-discovery/src/discovery-tools.js").createDiscoveryTools;
};
let mod: Modules;

const HOOK_TOKEN = "hook-secret";
const HOOK_AGENT = "paula";

function buildConfig(): OpenClawConfig {
  return {
    agents: {
      defaults: {
        model: { primary: "mock/m" },
        workspace: path.join(root, "workspace"),
        skipBootstrap: true,
        subagents: { maxSpawnDepth: 2 },
      },
      list: [
        { id: HOOK_AGENT, default: true, subagents: { allowAgents: ["discovery-executor"] } },
        {
          id: "discovery-executor",
          skills: [],
          tools: {
            profile: "minimal",
            alsoAllow: [
              "discovery_observe",
              "discovery_replay",
              "discovery_act",
              "discovery_report",
            ],
          },
        },
      ],
    },
    models: {
      providers: {
        mock: {
          api: "openai-responses",
          apiKey: "sk-test",
          baseUrl: "https://example.com",
          models: [
            {
              id: "m",
              name: "Mock",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 16_000,
              maxTokens: 2048,
            },
          ],
        },
      },
    },
    hooks: {
      enabled: true,
      token: HOOK_TOKEN,
      allowedAgentIds: [HOOK_AGENT],
      defaultSessionKey: "hook:rampup:default",
      allowRequestSessionKey: true,
      allowedSessionKeyPrefixes: ["hook:rampup:"],
    },
  } as OpenClawConfig;
}

let server: http.Server;
let hookPort: number;

beforeAll(async () => {
  vi.useRealTimers();
  root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sessions-stop-"));
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
  }
  process.env.OPENCLAW_STATE_DIR = path.join(root, "state");
  process.env.OPENCLAW_CONFIG_PATH = path.join(root, "openclaw.json");
  process.env.OPENCLAW_HOME = path.join(root, "home");
  // The cron run writes its session entry before the run only outside the fast test mode.
  process.env.OPENCLAW_TEST_FAST = "0";
  await fs.mkdir(path.join(root, "workspace"), { recursive: true });
  await fs.mkdir(path.join(root, "state"), { recursive: true });
  await fs.writeFile(process.env.OPENCLAW_CONFIG_PATH, JSON.stringify(buildConfig()));

  // The device helpers the discovery tools run: a script that records its pid and sleeps.
  discoveryHome = path.join(root, "rampup");
  const scripts = path.join(discoveryHome, "application-discovery", "scripts");
  await fs.mkdir(scripts, { recursive: true });
  await fs.writeFile(
    path.join(discoveryHome, "application-discovery", "pyproject.toml"),
    '[project]\nname = "fake-discovery"\nversion = "0"\nrequires-python = ">=3.8"\n',
  );
  await fs.writeFile(path.join(scripts, "device_helpers.py"), "import time\ntime.sleep(600)\n");
  process.env.RAMPUP_HOME = discoveryHome;
  delete process.env.DISCOVERY_PROJECT;

  const [
    hooks,
    hooksConfig,
    sessions,
    config,
    events,
    sessionsConfig,
    registry,
    run,
    tools,
    queue,
    scope,
  ] = await Promise.all([
    import("./server/hooks.js"),
    import("./hooks.js"),
    import("./server-methods/sessions.js"),
    import("../config/config.js"),
    import("../infra/system-events.js"),
    import("../config/sessions.js"),
    import("../agents/subagent-registry.js"),
    import("../agents/pi-embedded-runner/run.js"),
    import("../../extensions/puli-discovery/src/discovery-tools.js"),
    import("../process/command-queue.js"),
    import("../agents/agent-scope.js"),
  ]);
  mod = {
    createGatewayHooksRequestHandler: hooks.createGatewayHooksRequestHandler,
    resolveHooksConfig: hooksConfig.resolveHooksConfig,
    sessionsHandlers: sessions.sessionsHandlers,
    loadConfig: config.loadConfig,
    clearConfigCache: config.clearConfigCache,
    drainSystemEvents: events.drainSystemEvents,
    resolveMainSessionKeyFromConfig: sessionsConfig.resolveMainSessionKeyFromConfig,
    addSubagentRunForTests: registry.addSubagentRunForTests,
    resetSubagentRegistryForTests: registry.resetSubagentRegistryForTests,
    runEmbeddedPiAgent: run.runEmbeddedPiAgent,
    loadSessionStore: sessionsConfig.loadSessionStore,
    updateSessionStore: sessionsConfig.updateSessionStore,
    resolveStorePath: sessionsConfig.resolveStorePath,
    setCommandLaneConcurrency: queue.setCommandLaneConcurrency,
    resolveAgentDir: scope.resolveAgentDir,
    createDiscoveryTools: tools.createDiscoveryTools,
  };

  const handler = mod.createGatewayHooksRequestHandler({
    deps: {} as never,
    getHooksConfig: () => mod.resolveHooksConfig(mod.loadConfig()),
    bindHost: "127.0.0.1",
    port: 0,
    logHooks: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as never,
  });
  server = http.createServer((req, res) => {
    void handler(req, res).then((handled) => {
      if (!handled) {
        res.statusCode = 404;
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  hookPort = (server.address() as AddressInfo).port;
}, 180_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
  await fs.rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  mod.setCommandLaneConcurrency("nested", 4);
  mod.setCommandLaneConcurrency("subagent", 8);
  setupGate.pending = null;
  model.calls.length = 0;
  model.script = null;
  pluginTools.resolve = null;
  mod.resetSubagentRegistryForTests({ persist: false });
  mod.drainSystemEvents(mod.resolveMainSessionKeyFromConfig());
});

/** Every process whose command line carries the marker (a unique sleep length or id). */
function pidsWith(marker: string): number[] {
  const out = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" }).stdout;
  return out
    .split("\n")
    .filter((line) => line.includes(marker) && !line.includes("ps -axo"))
    .map((line) => Number.parseInt(line.trim().split(/\s+/)[0] ?? "", 10))
    .filter((pid) => Number.isFinite(pid) && pid !== process.pid);
}

async function waitFor<T>(
  what: string,
  probe: () => T | undefined | false | Promise<T | undefined | false>,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const hookKey = (id: string) => `hook:rampup:discover:${id}`;
const storeKey = (id: string) => `agent:${HOOK_AGENT}:${hookKey(id)}`;

/** What the BE sends (be/app/routers/rampup.py): bare key, agentId, wake now, no delivery. */
async function postRampupHook(id: string, message: string, name = "RampUp"): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${hookPort}/hooks/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${HOOK_TOKEN}` },
    body: JSON.stringify({
      message,
      name,
      agentId: HOOK_AGENT,
      sessionKey: hookKey(id),
      wakeMode: "now",
      deliver: false,
      timeoutSeconds: 120,
    }),
  });
  expect(res.status).toBe(200);
}

type Reply = { ok: boolean; payload?: Record<string, unknown>; error?: { code?: string } };
async function rpc(method: string, params: Record<string, unknown>): Promise<Reply> {
  let reply: Reply | undefined;
  await (
    mod.sessionsHandlers[method] as (opts: {
      params: Record<string, unknown>;
      respond: (ok: boolean, payload?: unknown, error?: unknown) => void;
    }) => Promise<void> | void
  )({
    params,
    respond: (ok, payload, error) => {
      reply = { ok, payload: payload as Reply["payload"], error: error as Reply["error"] };
    },
  });
  if (!reply) {
    throw new Error(`${method} did not respond`);
  }
  return reply;
}

const mainEvents = () => mod.drainSystemEvents(mod.resolveMainSessionKeyFromConfig());

/** Waits until the main session has read `count` hook results, and returns them. */
async function waitForMainEvents(count: number): Promise<string[]> {
  const seen: string[] = [];
  await waitFor(`${count} main session event(s)`, () => {
    seen.push(...mainEvents());
    return seen.length >= count;
  });
  return seen;
}

const STOPPED = "stopped by sessions.stop";
const callsFor = (marker: string) => model.calls.filter((call) => call.marker === marker).length;

function sessionStore(agentId: string) {
  const storePath = mod.resolveStorePath(mod.loadConfig().session?.store, { agentId });
  return mod.loadSessionStore(storePath);
}

async function userMessageCount(key: string): Promise<number> {
  const got = await rpc("sessions.get", { key });
  const messages = (got.payload?.messages ?? []) as Array<{ role?: string }>;
  return messages.filter((message) => message.role === "user").length;
}

const execTool = (command: string, text?: string): ModelAction => ({
  kind: "tool",
  name: "exec",
  args: { command, yieldMs: 200 },
  ...(text ? { text } : {}),
});

/** The discovery run the executors' tools read: run.yaml beside a state file with the lease. */
async function leaseInstruction(instructionId: string): Promise<string> {
  const runDir = path.join(root, "run");
  await fs.mkdir(runDir, { recursive: true });
  const runPath = path.join(runDir, "run.yaml");
  await fs.writeFile(runPath, "{}\n");
  await fs.writeFile(
    path.join(runDir, "discovery-state.json"),
    JSON.stringify({ leases: { [instructionId]: "d1" } }),
  );
  pluginTools.resolve = (ctx) =>
    ctx.agentId === "discovery-executor"
      ? mod.createDiscoveryTools(ctx as never, { runFor: () => runPath, env: process.env })
      : [];
  return runPath;
}

const act = (instructionId: string): ModelAction => ({
  kind: "tool",
  name: "discovery_act",
  args: { instruction_id: instructionId, device_id: "d1", action: "tap", control: "go" },
});

/**
 * A subagent of `controllerKey`, as `sessions_spawn` leaves it: a store entry, a registry
 * record and a real embedded run on its own session key. (The spawn itself goes through the
 * gateway's `agent` method, which this test does not start.)
 */
async function startSubagent(params: {
  agentId: string;
  controllerKey: string;
  id: string;
  marker: string;
}) {
  const childKey = `agent:${params.agentId}:subagent:${params.id}`;
  const sessionId = `sess-${params.id}`;
  const cfg = mod.loadConfig();
  const storePath = mod.resolveStorePath(cfg.session?.store, { agentId: params.agentId });
  const sessionFile = path.join(path.dirname(storePath), `${sessionId}.jsonl`);
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await mod.updateSessionStore(storePath, (store) => {
    store[childKey] = { sessionId, updatedAt: Date.now(), sessionFile };
  });
  const record = {
    runId: `run-${params.id}`,
    childSessionKey: childKey,
    controllerSessionKey: params.controllerKey,
    requesterSessionKey: params.controllerKey,
    requesterDisplayKey: params.controllerKey,
    task: params.marker,
    cleanup: "keep" as const,
    createdAt: Date.now(),
    startedAt: Date.now(),
  };
  mod.addSubagentRunForTests(record);
  const done = mod.runEmbeddedPiAgent({
    sessionId,
    sessionKey: childKey,
    agentId: params.agentId,
    spawnedBy: params.controllerKey,
    sessionFile,
    workspaceDir: path.join(root, "workspace"),
    agentDir: mod.resolveAgentDir(cfg, params.agentId),
    config: cfg,
    prompt: `${params.marker} work`,
    provider: "mock",
    model: "m",
    timeoutMs: 120_000,
    runId: `embedded-${params.id}`,
    lane: "subagent",
  });
  return {
    childKey,
    done,
    /** The registry's own view once the subagent's turn has ended. */
    markEnded: () => mod.addSubagentRunForTests({ ...record, endedAt: Date.now() }),
  };
}

describe("sessions.stop", () => {
  afterEach(async () => {
    for (const pid of [...pidsWith("sleep 70"), ...pidsWith("--instruction=i-exec")]) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  });

  it("stops a hook turn that has a yielded exec, kills the exec and keeps the transcript", async () => {
    const id = "run-yielded";
    model.script = (call) => (call.toolResults === 0 ? execTool("sleep 7001") : { kind: "hold" });
    await postRampupHook(id, "MARK-yielded go");
    await waitFor("the yielded exec", () => pidsWith("sleep 7001").length > 0);
    await waitFor("the second model request", () => model.calls.length >= 2);

    const stop = await rpc("sessions.stop", { key: storeKey(id) });
    expect(stop).toMatchObject({ ok: true, payload: { ok: true, key: storeKey(id) } });
    expect(pidsWith("sleep 7001")).toEqual([]);

    const events = await waitForMainEvents(1);
    expect(events.join("\n")).toContain(`Hook RampUp (error): ${STOPPED}`);

    const got = await rpc("sessions.get", { key: storeKey(id) });
    expect(JSON.stringify(got.payload?.messages)).toContain("MARK-yielded");
    expect(sessionStore(HOOK_AGENT)[storeKey(id)]).toBeDefined();
  });

  it("leaves another hook session untouched", async () => {
    model.script = (call) =>
      call.toolResults === 0
        ? execTool(`sleep ${call.marker.endsWith("a") ? 7002 : 7003}`)
        : { kind: "hold" };
    await postRampupHook("run-a", "MARK-a go");
    await postRampupHook("run-b", "MARK-b go");
    await waitFor(
      "both execs",
      () => pidsWith("sleep 7002").length > 0 && pidsWith("sleep 7003").length > 0,
    );
    await waitFor("both held requests", () => callsFor("MARK-a") >= 2 && callsFor("MARK-b") >= 2);

    await rpc("sessions.stop", { key: storeKey("run-a") });
    expect(await waitForMainEvents(1)).toHaveLength(1);
    expect(pidsWith("sleep 7002")).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(pidsWith("sleep 7003").length).toBeGreaterThan(0);
    expect(mainEvents()).toEqual([]);

    await rpc("sessions.stop", { key: storeKey("run-b") });
    expect(await waitForMainEvents(1)).toHaveLength(1);
    expect(pidsWith("sleep 7003")).toEqual([]);
  });

  it("answers ok for an unknown key and creates no entry", async () => {
    const before = Object.keys(sessionStore(HOOK_AGENT)).toSorted();
    const stop = await rpc("sessions.stop", { key: storeKey("never-existed") });
    expect(stop).toMatchObject({ ok: true, payload: { ok: true, key: storeKey("never-existed") } });
    expect(Object.keys(sessionStore(HOOK_AGENT)).toSorted()).toEqual(before);
    expect(sessionStore(HOOK_AGENT)[storeKey("never-existed")]).toBeUndefined();
  });

  it("kills an executor's in-flight discovery call and its python child", async () => {
    const id = "run-executor";
    const runPath = await leaseInstruction("i-exec-1");
    expect(runPath).toContain("run.yaml");
    model.script = (call) => {
      if (call.marker === "MARK-exec") {
        return call.toolResults === 0 ? act("i-exec-1") : { kind: "hold" };
      }
      return { kind: "hold" };
    };
    await postRampupHook(id, "MARK-hook go");
    await waitFor("the hook request", () => callsFor("MARK-hook") >= 1);
    const executor = await startSubagent({
      agentId: "discovery-executor",
      controllerKey: storeKey(id),
      id: "exec-1",
      marker: "MARK-exec",
    });
    // `uv run python` is two processes: uv and the python child it starts.
    await waitFor("uv and its python child", () => pidsWith("--instruction=i-exec-1").length >= 2);

    const stop = await rpc("sessions.stop", { key: storeKey(id) });
    expect(stop.ok).toBe(true);
    await waitFor("the helper gone", () => pidsWith("--instruction=i-exec-1").length === 0);
    expect((await executor.done).meta.aborted).toBe(true);
    await waitForMainEvents(1);
  });

  it("kills the backgrounded exec of a subagent whose turn has ended", async () => {
    const id = "run-ended-sub";
    model.script = (call) => {
      if (call.marker === "MARK-ended-sub") {
        return call.toolResults === 0 ? execTool("sleep 7004") : { kind: "text", text: "done" };
      }
      return { kind: "hold" };
    };
    await postRampupHook(id, "MARK-ended-hook go");
    const sub = await startSubagent({
      agentId: HOOK_AGENT,
      controllerKey: storeKey(id),
      id: "ended-1",
      marker: "MARK-ended-sub",
    });
    await sub.done;
    sub.markEnded();
    expect(pidsWith("sleep 7004").length).toBeGreaterThan(0);

    await rpc("sessions.stop", { key: storeKey(id) });
    expect(pidsWith("sleep 7004")).toEqual([]);
    await waitForMainEvents(1);
  });

  it("stops a lead subagent and its executor with one stop on the hook key", async () => {
    const id = "run-two-level";
    await leaseInstruction("i-exec-2");
    model.script = (call) => {
      switch (call.marker) {
        case "MARK-tl-hook":
          return call.toolResults === 0 ? execTool("sleep 7005") : { kind: "hold" };
        case "MARK-tl-lead":
          return call.toolResults === 0 ? execTool("sleep 7006") : { kind: "hold" };
        case "MARK-tl-exec":
          return call.toolResults === 0 ? act("i-exec-2") : { kind: "hold" };
        default:
          return { kind: "hold" };
      }
    };
    await postRampupHook(id, "MARK-tl-hook go");
    const lead = await startSubagent({
      agentId: HOOK_AGENT,
      controllerKey: storeKey(id),
      id: "lead-1",
      marker: "MARK-tl-lead",
    });
    const executor = await startSubagent({
      agentId: "discovery-executor",
      controllerKey: lead.childKey,
      id: "exec-2",
      marker: "MARK-tl-exec",
    });
    await waitFor(
      "every process",
      () =>
        pidsWith("sleep 7005").length > 0 &&
        pidsWith("sleep 7006").length > 0 &&
        pidsWith("--instruction=i-exec-2").length >= 2,
    );

    const stop = await rpc("sessions.stop", { key: storeKey(id) });
    expect(stop.ok).toBe(true);
    expect(pidsWith("sleep 7005")).toEqual([]);
    expect(pidsWith("sleep 7006")).toEqual([]);
    await waitFor("the helper gone", () => pidsWith("--instruction=i-exec-2").length === 0);
    expect((await lead.done).meta.aborted).toBe(true);
    expect((await executor.done).meta.aborted).toBe(true);
    await waitForMainEvents(1);
  });

  describe("stop marks", () => {
    it("stops a hook that waits behind another hook, and the other hook keeps running", async () => {
      mod.setCommandLaneConcurrency("nested", 1);
      model.script = (call) =>
        call.marker === "MARK-front" && call.toolResults === 0
          ? execTool("sleep 7010")
          : { kind: "hold" };
      await postRampupHook("run-front", "MARK-front go", "Front");
      await waitFor("the front hook's second request", () => callsFor("MARK-front") >= 2);
      await postRampupHook("run-waiting", "MARK-waiting go", "Waiting");
      await waitFor("the waiting hook's session entry", () =>
        Boolean(sessionStore(HOOK_AGENT)[storeKey("run-waiting")]),
      );

      const stop = await rpc("sessions.stop", { key: storeKey("run-waiting") });
      expect(stop.ok).toBe(true);
      // The front hook is untouched: it still holds its request and its exec.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(pidsWith("sleep 7010").length).toBeGreaterThan(0);
      expect(mainEvents()).toEqual([]);

      // The waiting hook leaves the queue when the front one ends, and sends nothing.
      await rpc("sessions.stop", { key: storeKey("run-front") });
      const events = await waitForMainEvents(2);
      expect(events.toSorted()).toEqual([
        `Hook Front (error): ${STOPPED}`,
        `Hook Waiting (error): ${STOPPED}`,
      ]);
      expect(callsFor("MARK-waiting")).toBe(0);
      expect(await userMessageCount(storeKey("run-waiting"))).toBe(0);
    });

    it("stops a hook during its pre-run setup", async () => {
      let release!: () => void;
      setupGate.pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      await postRampupHook("run-setup", "MARK-setup go");
      const stop = await rpc("sessions.stop", { key: storeKey("run-setup") });
      expect(stop.ok).toBe(true);
      release();

      expect(await waitForMainEvents(1)).toEqual([`Hook RampUp (error): ${STOPPED}`]);
      expect(callsFor("MARK-setup")).toBe(0);
      expect(await userMessageCount(storeKey("run-setup"))).toBe(0);
    });

    it("stops a hook dispatched after the stop, whatever the case of the key", async () => {
      const stop = await rpc("sessions.stop", {
        key: storeKey("Run-Late").replace("agent:paula", "AGENT:Paula"),
      });
      expect(stop.ok).toBe(true);
      await postRampupHook("Run-Late", "MARK-late go");

      expect(await waitForMainEvents(1)).toEqual([`Hook RampUp (error): ${STOPPED}`]);
      expect(callsFor("MARK-late")).toBe(0);
      expect(await userMessageCount(storeKey("run-late"))).toBe(0);
    });

    it("stops a hook in a retry backoff and sends no request or transcript entry after", async () => {
      const key = storeKey("run-backoff");
      model.script = () => ({ kind: "error", message: "529 overloaded_error: Overloaded" });
      await postRampupHook("run-backoff", "MARK-backoff go");
      await waitFor("the failed request", () => callsFor("MARK-backoff") >= 1);
      // The rewind of the failed turn comes first; the backoff is at least 500 ms.
      await new Promise((resolve) => setTimeout(resolve, 200));
      const before = JSON.stringify((await rpc("sessions.get", { key })).payload);

      const stop = await rpc("sessions.stop", { key });
      expect(stop.ok).toBe(true);
      expect(await waitForMainEvents(1)).toEqual([`Hook RampUp (error): ${STOPPED}`]);
      await new Promise((resolve) => setTimeout(resolve, 1_800));
      expect(callsFor("MARK-backoff")).toBe(1);
      expect(JSON.stringify((await rpc("sessions.get", { key })).payload)).toBe(before);
    });

    it("control: without a stop the same retry sends a second request", async () => {
      model.script = () =>
        callsFor("MARK-control") <= 1
          ? { kind: "error", message: "529 overloaded_error: Overloaded" }
          : { kind: "text", text: "done" };
      await postRampupHook("run-control", "MARK-control go");
      await waitFor("the retried request", () => callsFor("MARK-control") >= 2, 10_000);
      await waitForMainEvents(1);
    });

    it("stops a hook sent twice for one key, both times", async () => {
      model.script = () => ({ kind: "hold" });
      await postRampupHook("run-twice", "MARK-twice go", "First");
      await waitFor("the first request", () => callsFor("MARK-twice") >= 1);
      await postRampupHook("run-twice", "MARK-twice go", "Second");

      const stop = await rpc("sessions.stop", { key: storeKey("run-twice") });
      expect(stop.ok).toBe(true);
      const events = await waitForMainEvents(2);
      expect(events.toSorted()).toEqual([
        `Hook First (error): ${STOPPED}`,
        `Hook Second (error): ${STOPPED}`,
      ]);
      expect(callsFor("MARK-twice")).toBe(1);
    });

    it("starts no follow-up turn after a stopped interim-acknowledgement turn", async () => {
      model.script = (call) =>
        call.toolResults === 0
          ? execTool("sleep 7011", "On it, starting the discovery now.")
          : { kind: "hold" };
      await postRampupHook("run-interim", "MARK-interim go");
      await waitFor("the held request", () => callsFor("MARK-interim") >= 2);

      await rpc("sessions.stop", { key: storeKey("run-interim") });
      expect(await waitForMainEvents(1)).toEqual([`Hook RampUp (error): ${STOPPED}`]);
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(callsFor("MARK-interim")).toBe(2);
      expect(model.calls.some((call) => call.prompt.includes("only an acknowledgement"))).toBe(
        false,
      );
    });
  });
});
