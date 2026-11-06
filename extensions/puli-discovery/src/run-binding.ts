import path from "node:path";

// The marker `sessions_spawn` puts before the task in a sub-agent's first message
// (src/agents/subagent-spawn.ts, `childTaskMessage`).
const TASK_MARKER = "[Subagent Task]: ";
const RUN_LINE = /^DISCOVERY_RUN=(.+)$/;

/**
 * The run.yaml a spawned executor works on, read from the first line of its task:
 * `DISCOVERY_RUN=<absolute path to run.yaml>`. Undefined when the prompt carries no
 * sub-agent task, or the task's first line is not that line.
 *
 * The path comes from the lead's spawn, never from a tool argument, so an executor
 * cannot point the tools at another run.
 */
export function readDiscoveryRun(prompt: string | undefined): string | undefined {
  if (!prompt) {
    return undefined;
  }
  const start = prompt.indexOf(TASK_MARKER);
  if (start < 0) {
    return undefined;
  }
  const task = prompt.slice(start + TASK_MARKER.length);
  const firstLine = task.split(/\r?\n/, 1)[0]?.trim() ?? "";
  const match = RUN_LINE.exec(firstLine);
  const runPath = match?.[1]?.trim();
  if (!runPath || !path.isAbsolute(runPath)) {
    return undefined;
  }
  return path.normalize(runPath);
}

/**
 * Which run each executor session works on, keyed by session key. Module state, not
 * plugin-instance state, so a plugin registry reload does not part a running executor's
 * tools from the binding its first prompt made.
 */
const runsBySession = new Map<string, string>();

/** Bind a session to the run its task names. The first binding stays: a later message to
 * the same session (a steer, the announce step) cannot move it to another run. */
export function bindRunFromPrompt(sessionKey: string | undefined, prompt: string | undefined) {
  if (!sessionKey || runsBySession.has(sessionKey)) {
    return;
  }
  const runPath = readDiscoveryRun(prompt);
  if (runPath) {
    runsBySession.set(sessionKey, runPath);
  }
}

export function boundRun(sessionKey: string | undefined): string | undefined {
  return sessionKey ? runsBySession.get(sessionKey) : undefined;
}

export function forgetRun(sessionKey: string | undefined) {
  if (sessionKey) {
    runsBySession.delete(sessionKey);
  }
}

export function resetRunBindingsForTests() {
  runsBySession.clear();
}
