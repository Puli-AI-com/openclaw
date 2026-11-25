import { afterEach, describe, expect, it, vi } from "vitest";
import { isSessionStopped, markStopped } from "./session-stops.js";

// The marks are process-wide, so each test builds its own keys.
let next = 0;
function fixture() {
  const n = next++;
  const hook = `agent:paula:hook:rampup:discover:${n}`;
  const lead = `agent:paula:subagent:lead-${n}`;
  const executor = `agent:discovery-executor:subagent:exec-${n}`;
  const sibling = `agent:paula:subagent:sibling-${n}`;
  const store = {
    [lead]: { spawnedBy: hook },
    [executor]: { spawnedBy: lead },
    [sibling]: { spawnedBy: `agent:paula:hook:rampup:discover:other-${n}` },
  };
  return { hook, lead, executor, sibling, store };
}

describe("isSessionStopped", () => {
  afterEach(() => vi.useRealTimers());

  it("is false when nothing under the key was stopped", () => {
    const { executor, store } = fixture();
    expect(isSessionStopped(executor, { store })).toBe(false);
  });

  it("is true for the stopped key and for every session spawned under it", () => {
    const { hook, lead, executor, store } = fixture();
    markStopped(hook);
    expect(isSessionStopped(hook, { store })).toBe(true);
    expect(isSessionStopped(lead, { store })).toBe(true);
    expect(isSessionStopped(executor, { store })).toBe(true);
  });

  it("matches keys whatever their case", () => {
    const { hook, executor, store } = fixture();
    markStopped(hook.toUpperCase());
    expect(isSessionStopped(executor, { store })).toBe(true);
    expect(isSessionStopped(hook.toUpperCase(), { store })).toBe(true);
  });

  it("leaves a sibling under another hook unaffected", () => {
    const { hook, sibling, store } = fixture();
    markStopped(hook);
    expect(isSessionStopped(sibling, { store })).toBe(false);
  });

  it("ends at a spawnedBy cycle", () => {
    const n = next++;
    const a = `agent:paula:subagent:a-${n}`;
    const b = `agent:paula:subagent:b-${n}`;
    expect(isSessionStopped(a, { store: { [a]: { spawnedBy: b }, [b]: { spawnedBy: a } } })).toBe(
      false,
    );
  });

  it("is false once the stop mark has expired", () => {
    const { hook, lead, store } = fixture();
    markStopped(hook);
    vi.useFakeTimers({ now: Date.now() + 25 * 60 * 60 * 1000 });
    expect(isSessionStopped(lead, { store })).toBe(false);
  });
});
