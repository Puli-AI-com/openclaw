import { afterEach, describe, expect, it } from "vitest";
import {
  bindRunFromPrompt,
  boundRun,
  forgetRun,
  readDiscoveryRun,
  resetRunBindingsForTests,
} from "./run-binding.js";

// The message sessions_spawn sends a sub-agent (src/agents/subagent-spawn.ts).
function spawnMessage(task: string): string {
  return [
    "[Subagent Context] You are running as a subagent (depth 1/1). Results auto-announce to your requester; do not busy-poll for status.",
    `[Subagent Task]: ${task}`,
  ].join("\n\n");
}

describe("readDiscoveryRun", () => {
  it("reads the run from the first line of the task", () => {
    const prompt = spawnMessage(
      "DISCOVERY_RUN=/data/apps/bit2c/.runs/42/run.yaml\nInstruction i-7: tap Login.",
    );
    expect(readDiscoveryRun(prompt)).toBe("/data/apps/bit2c/.runs/42/run.yaml");
  });

  it("ignores text the runtime puts before the task", () => {
    const prompt = `[Thu 2026-11-06 10:00 UTC] ${spawnMessage("DISCOVERY_RUN=/r/run.yaml\nx")}`;
    expect(readDiscoveryRun(prompt)).toBe("/r/run.yaml");
  });

  it("reads nothing when the first line of the task is something else", () => {
    expect(readDiscoveryRun(spawnMessage("Tap Login.\nDISCOVERY_RUN=/r/run.yaml"))).toBeUndefined();
  });

  it("reads nothing from a prompt with no sub-agent task", () => {
    expect(readDiscoveryRun("DISCOVERY_RUN=/r/run.yaml")).toBeUndefined();
    expect(readDiscoveryRun(undefined)).toBeUndefined();
  });

  it("refuses a relative path", () => {
    expect(readDiscoveryRun(spawnMessage("DISCOVERY_RUN=runs/run.yaml"))).toBeUndefined();
  });
});

describe("run bindings", () => {
  afterEach(() => resetRunBindingsForTests());

  it("keeps the first run a session was bound to", () => {
    const key = "agent:discovery-executor:subagent:a";
    bindRunFromPrompt(key, spawnMessage("DISCOVERY_RUN=/first/run.yaml"));
    bindRunFromPrompt(key, spawnMessage("DISCOVERY_RUN=/second/run.yaml"));
    expect(boundRun(key)).toBe("/first/run.yaml");
  });

  it("binds sessions separately and forgets an ended one", () => {
    bindRunFromPrompt("s1", spawnMessage("DISCOVERY_RUN=/one/run.yaml"));
    bindRunFromPrompt("s2", spawnMessage("DISCOVERY_RUN=/two/run.yaml"));
    forgetRun("s1");
    expect(boundRun("s1")).toBeUndefined();
    expect(boundRun("s2")).toBe("/two/run.yaml");
  });

  it("binds nothing when the prompt names no run", () => {
    bindRunFromPrompt("s3", "announce the result");
    expect(boundRun("s3")).toBeUndefined();
  });
});
