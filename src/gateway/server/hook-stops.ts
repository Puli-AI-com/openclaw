// Stop marks for agent hooks, in the gateway process's memory like `chatAbortControllers`.
// `sessions.stop` marks a store session key; a hook dispatch for that key, in flight or sent
// later, is aborted wherever it is. A restart forgets the marks and drops the hooks with them.
const STOP_MARK_TTL_MS = 24 * 60 * 60 * 1000;

export const HOOK_STOP_REASON = "stopped by sessions.stop";

const stopped = new Map<string, number>();
const running = new Map<string, Set<AbortController>>();

export function markStopped(key: string): void {
  const now = Date.now();
  for (const [markedKey, markedAt] of stopped) {
    if (now - markedAt > STOP_MARK_TTL_MS) {
      stopped.delete(markedKey);
    }
  }
  stopped.set(key, now);
  for (const controller of running.get(key) ?? []) {
    controller.abort(HOOK_STOP_REASON);
  }
}

export function isStopped(key: string): boolean {
  const markedAt = stopped.get(key);
  return markedAt !== undefined && Date.now() - markedAt <= STOP_MARK_TTL_MS;
}

export function register(key: string, controller: AbortController): void {
  const controllers = running.get(key) ?? new Set<AbortController>();
  controllers.add(controller);
  running.set(key, controllers);
}

export function unregister(key: string, controller: AbortController): void {
  const controllers = running.get(key);
  if (!controllers) {
    return;
  }
  controllers.delete(controller);
  if (controllers.size === 0) {
    running.delete(key);
  }
}
