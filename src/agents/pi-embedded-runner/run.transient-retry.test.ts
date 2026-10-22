import "./run.overflow-compaction.mocks.shared.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sleepWithAbort } from "../../infra/backoff.js";
import {
  classifyFailoverReason,
  extractRetryAfterMs,
  isFailoverAssistantError,
  isFailoverErrorMessage,
  isSameModelRetryableError,
} from "../pi-embedded-helpers.js";

vi.mock(import("../../utils.js"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveUserPath: vi.fn((p: string) => p),
  };
});

vi.mock(import("../../infra/backoff.js"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    sleepWithAbort: vi.fn(async () => {}),
  };
});

import { log } from "./logger.js";
import { runEmbeddedPiAgent } from "./run.js";
import { makeAttemptResult } from "./run.overflow-compaction.fixture.js";
import {
  mockedRunEmbeddedAttempt,
  overflowBaseRunParams as baseParams,
} from "./run.overflow-compaction.shared-test.js";

const TRANSIENT =
  "The system encountered an unexpected error during processing. Try your request again. " +
  "Deserialization error: inspect the hidden field {error}.$response";

const mockedSleep = vi.mocked(sleepWithAbort);

function transientAssistantAttempt(overrides: Parameters<typeof makeAttemptResult>[0] = {}) {
  return makeAttemptResult({
    assistantTexts: [],
    lastAssistant: { stopReason: "error", errorMessage: TRANSIENT } as AssistantMessage,
    ...overrides,
  });
}

describe("same-model transient retry in run loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRunEmbeddedAttempt.mockReset();
    mockedSleep.mockImplementation(async () => {});
    vi.mocked(extractRetryAfterMs).mockReturnValue(undefined);
    const isTransient = (msg?: string) => msg === TRANSIENT;
    vi.mocked(isSameModelRetryableError).mockImplementation((msg) => isTransient(msg));
    vi.mocked(isFailoverErrorMessage).mockImplementation((msg) => isTransient(msg));
    vi.mocked(classifyFailoverReason).mockImplementation((msg) =>
      isTransient(msg) ? "timeout" : null,
    );
    vi.mocked(isFailoverAssistantError).mockImplementation((msg) => isTransient(msg?.errorMessage));
  });

  it("retries a transient assistant error and succeeds on the same model", async () => {
    mockedRunEmbeddedAttempt
      .mockResolvedValueOnce(transientAssistantAttempt())
      .mockResolvedValueOnce(makeAttemptResult());

    const result = await runEmbeddedPiAgent(baseParams);

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(2);
    expect(mockedRunEmbeddedAttempt.mock.calls[1]?.[0]).toMatchObject({ modelId: "test-model" });
    expect(mockedSleep).toHaveBeenCalledTimes(1);
    const delayMs = mockedSleep.mock.calls[0]?.[0] ?? 0;
    expect(delayMs).toBeGreaterThanOrEqual(500);
    expect(delayMs).toBeLessThanOrEqual(1500);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "retrying same model anthropic/test-model: attempt=2/3 reason=timeout",
      ),
    );
    expect(result.meta.error).toBeUndefined();
  });

  it("retries a transient prompt error and succeeds", async () => {
    mockedRunEmbeddedAttempt
      .mockResolvedValueOnce(
        makeAttemptResult({ assistantTexts: [], promptError: new Error(TRANSIENT) }),
      )
      .mockResolvedValueOnce(makeAttemptResult());

    const result = await runEmbeddedPiAgent(baseParams);

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(2);
    expect(result.meta.error).toBeUndefined();
  });

  it("stops after three attempts and surfaces the prompt error", async () => {
    mockedRunEmbeddedAttempt.mockResolvedValue(
      makeAttemptResult({ assistantTexts: [], promptError: new Error(TRANSIENT) }),
    );

    await expect(runEmbeddedPiAgent(baseParams)).rejects.toThrow(TRANSIENT);

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(3);
    expect(mockedSleep).toHaveBeenCalledTimes(2);
    const secondDelay = mockedSleep.mock.calls[1]?.[0] ?? 0;
    expect(secondDelay).toBeGreaterThanOrEqual(1000);
    expect(secondDelay).toBeLessThanOrEqual(3000);
  });

  it("stops after three attempts on a transient assistant error", async () => {
    mockedRunEmbeddedAttempt.mockResolvedValue(transientAssistantAttempt());

    await runEmbeddedPiAgent(baseParams);

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(3);
    expect(mockedSleep).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the failed attempt already produced output", async () => {
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(
      transientAssistantAttempt({ toolMetas: [{ toolName: "tap" }] }),
    );

    await runEmbeddedPiAgent(baseParams);

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(1);
    expect(mockedSleep).not.toHaveBeenCalled();
  });

  it("does not retry a non-retryable error", async () => {
    vi.mocked(isSameModelRetryableError).mockReturnValue(false);
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(
      makeAttemptResult({ assistantTexts: [], promptError: new Error(TRANSIENT) }),
    );

    await expect(runEmbeddedPiAgent(baseParams)).rejects.toThrow(TRANSIENT);

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(1);
  });

  it("waits for a retry-after hint within the cap", async () => {
    vi.mocked(extractRetryAfterMs).mockReturnValue(7_000);
    mockedRunEmbeddedAttempt
      .mockResolvedValueOnce(transientAssistantAttempt())
      .mockResolvedValueOnce(makeAttemptResult());

    await runEmbeddedPiAgent(baseParams);

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(2);
    expect(mockedSleep.mock.calls[0]?.[0]).toBe(7_000);
  });

  it("does not retry when retry-after exceeds the cap", async () => {
    vi.mocked(extractRetryAfterMs).mockReturnValue(60_000);
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(transientAssistantAttempt());

    await runEmbeddedPiAgent(baseParams);

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(1);
    expect(mockedSleep).not.toHaveBeenCalled();
  });

  it("keeps one copy of the prompt in the transcript after two failed attempts", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-transient-retry-"));
    const sessionFile = path.join(dir, "session.jsonl");
    const assistant = (overrides: Partial<AssistantMessage>) =>
      ({
        role: "assistant",
        content: [],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "test-model",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
        ...overrides,
      }) as AssistantMessage;
    const userMessage = (text: string) => ({
      role: "user" as const,
      content: [{ type: "text" as const, text }],
      timestamp: Date.now(),
    });
    const earlier = SessionManager.open(sessionFile);
    earlier.appendMessage(userMessage("earlier turn"));
    earlier.appendMessage(assistant({ content: [{ type: "text", text: "done" }] }));
    // Each attempt writes what a real one does: the prompt, then the model's reply.
    const writeAttempt = (reply: AssistantMessage) => {
      const sm = SessionManager.open(sessionFile);
      sm.appendMessage(userMessage(baseParams.prompt));
      sm.appendMessage(reply);
      sm.appendCustomEntry("openclaw.cache-ttl", { timestamp: Date.now() });
    };
    const failed = assistant({ stopReason: "error", errorMessage: TRANSIENT });
    mockedRunEmbeddedAttempt
      .mockImplementationOnce(async () => {
        writeAttempt(failed);
        return transientAssistantAttempt();
      })
      .mockImplementationOnce(async () => {
        writeAttempt(failed);
        return transientAssistantAttempt();
      })
      .mockImplementationOnce(async () => {
        writeAttempt(assistant({ content: [{ type: "text", text: "ok" }] }));
        return makeAttemptResult();
      });

    try {
      const result = await runEmbeddedPiAgent({ ...baseParams, sessionFile });

      expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(3);
      expect(result.meta.error).toBeUndefined();
      const messages = SessionManager.open(sessionFile)
        .getEntries()
        .flatMap((entry) => (entry.type === "message" ? [entry.message] : []));
      expect(messages.map((message) => message.role)).toEqual([
        "user",
        "assistant",
        "user",
        "assistant",
      ]);
      expect(JSON.stringify(messages[2])).toContain(baseParams.prompt);
      expect(messages.some((m) => m.role === "assistant" && m.stopReason === "error")).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("stops when aborted during backoff", async () => {
    const controller = new AbortController();
    mockedSleep.mockImplementationOnce(async () => {
      controller.abort();
      throw new Error("aborted");
    });
    mockedRunEmbeddedAttempt.mockResolvedValue(transientAssistantAttempt());

    await expect(
      runEmbeddedPiAgent({ ...baseParams, abortSignal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(1);
  });
});
