import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearFastTestEnv,
  loadRunCronIsolatedAgentTurn,
  makeCronSession,
  makeCronSessionEntry,
  resetRunCronIsolatedAgentTurnHarness,
  resolveCronSessionMock,
  restoreFastTestEnv,
  runWithModelFallbackMock,
  updateSessionStoreMock,
} from "./run.test-harness.js";

const runCronIsolatedAgentTurn = await loadRunCronIsolatedAgentTurn();

function makeParams(sessionKey: string, timeoutSeconds?: number) {
  return {
    cfg: {},
    deps: {} as never,
    job: {
      id: "job-timeout",
      name: "Job timeout",
      schedule: { kind: "at", at: new Date().toISOString() },
      sessionTarget: "isolated",
      payload: { kind: "agentTurn", message: "do the job", timeoutSeconds },
    } as never,
    message: "do the job",
    sessionKey,
  };
}

describe("runCronIsolatedAgentTurn job timeout on the session entry", () => {
  let previousFastTestEnv: string | undefined;
  let cronSession: ReturnType<typeof makeCronSession>;

  beforeEach(() => {
    previousFastTestEnv = clearFastTestEnv();
    resetRunCronIsolatedAgentTurnHarness();
    updateSessionStoreMock.mockResolvedValue(undefined);
    runWithModelFallbackMock.mockRejectedValue(new Error("stop after the pre-run persist"));
    cronSession = makeCronSession({ sessionEntry: makeCronSessionEntry() });
    resolveCronSessionMock.mockReturnValue(cronSession);
  });

  afterEach(() => {
    restoreFastTestEnv(previousFastTestEnv);
  });

  it("saves a hook's timeout on the session entry", async () => {
    await runCronIsolatedAgentTurn(makeParams("hook:rampup:discover:run-1", 5400));
    expect(cronSession.sessionEntry.jobTimeoutSeconds).toBe(5400);
  });

  it("saves a cron job's timeout on the session entry", async () => {
    await runCronIsolatedAgentTurn(makeParams("cron:monitoring", 1800));
    expect(cronSession.sessionEntry.jobTimeoutSeconds).toBe(1800);
  });

  it("clears an earlier job's timeout when the latest job has none", async () => {
    cronSession = makeCronSession({
      sessionEntry: { ...makeCronSessionEntry(), jobTimeoutSeconds: 5400 },
    });
    resolveCronSessionMock.mockReturnValue(cronSession);
    await runCronIsolatedAgentTurn(makeParams("hook:jobs:cycle:c1:queued"));
    expect(cronSession.sessionEntry.jobTimeoutSeconds).toBeUndefined();
  });
});
