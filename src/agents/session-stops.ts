import type { OpenClawConfig } from "../config/config.js";
import { getSpawnedByFromSessionStore } from "./subagent-depth.js";

// Stop marks for agent sessions, in the gateway process's memory like `chatAbortControllers`.
// `sessions.stop` marks a store session key. A hook dispatch for that key, in flight or sent
// later, is aborted wherever it is, and so is every run of the key or of a session spawned
// under it (`isSessionStopped`): the turns a subagent's completion announce starts, and a
// subagent whose spawn was in flight at the stop. A restart forgets the marks and drops the
// hooks with them.
const STOP_MARK_TTL_MS = 24 * 60 * 60 * 1000;

export const HOOK_STOP_REASON = "stopped by sessions.stop";

const stopped = new Map<string, number>();
const running = new Map<string, Set<AbortController>>();
// The name of the last hook dispatched for a key, for the stop message when none is running.
const hookNames = new Map<string, string>();

// Store keys are lowercase; a mark and its lookups must agree whatever case the caller used.
const normalize = (key: string) => key.trim().toLowerCase();

export function markStopped(key: string): void {
  const now = Date.now();
  for (const [markedKey, markedAt] of stopped) {
    if (now - markedAt > STOP_MARK_TTL_MS) {
      stopped.delete(markedKey);
    }
  }
  stopped.set(normalize(key), now);
  for (const controller of running.get(normalize(key)) ?? []) {
    controller.abort(HOOK_STOP_REASON);
  }
}

export function isStopped(key: string): boolean {
  const markedAt = stopped.get(normalize(key));
  return markedAt !== undefined && Date.now() - markedAt <= STOP_MARK_TTL_MS;
}

/**
 * True when the session, or any session in its `spawnedBy` chain, is stop-marked.
 * `spawnSubagentDirect` writes `spawnedBy` to the child's store entry before the child's
 * `agent` call, so a spawn in flight at the stop is covered.
 */
export function isSessionStopped(
  key: string,
  opts?: { cfg?: OpenClawConfig; store?: Record<string, { spawnedBy?: unknown }> },
): boolean {
  if (stopped.size === 0) {
    return false;
  }
  const seen = new Set<string>();
  for (let current: string | undefined = key; current; ) {
    const normalized = normalize(current);
    if (seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    if (isStopped(normalized)) {
      return true;
    }
    current = getSpawnedByFromSessionStore(current, opts);
  }
  return false;
}

export function register(key: string, controller: AbortController, hookName?: string): void {
  if (hookName) {
    hookNames.set(normalize(key), hookName);
  }
  const controllers = running.get(normalize(key)) ?? new Set<AbortController>();
  controllers.add(controller);
  running.set(normalize(key), controllers);
}

export function unregister(key: string, controller: AbortController): void {
  const controllers = running.get(normalize(key));
  if (!controllers) {
    return;
  }
  controllers.delete(controller);
  if (controllers.size === 0) {
    running.delete(normalize(key));
  }
}

export function lastHookName(key: string): string | undefined {
  return hookNames.get(normalize(key));
}

/** True while a hook dispatch for the key is in flight: it reports its own stop to the main session. */
export function hasRunningHook(key: string): boolean {
  return running.has(normalize(key));
}
