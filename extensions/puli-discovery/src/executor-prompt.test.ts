import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  executorSystemPrompt,
  NOT_CONFIGURED,
  readExecutorInstructions,
  TOOLS_LINE,
} from "./executor-prompt.js";

let home = "";
const file = () =>
  path.join(home, "application-discovery", "discovery-executor", "INSTRUCTIONS.md");

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "puli-executor-prompt-"));
  await fs.mkdir(path.dirname(file()), { recursive: true });
});

afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true });
});

describe("executor instructions", () => {
  it("reads them from $RAMPUP_HOME and adds the tools line", async () => {
    await fs.writeFile(file(), "# Executor\n\nDo one instruction.\n");
    const instructions = await readExecutorInstructions({ RAMPUP_HOME: home });
    expect(instructions).toMatchObject({ ok: true, path: file() });
    expect(executorSystemPrompt(instructions)).toBe(
      `# Executor\n\nDo one instruction.\n\n${TOOLS_LINE}`,
    );
  });

  it("reads them fresh, so a changed file is used on the next run", async () => {
    await fs.writeFile(file(), "first");
    await readExecutorInstructions({ RAMPUP_HOME: home });
    await fs.writeFile(file(), "second");
    expect(await readExecutorInstructions({ RAMPUP_HOME: home })).toMatchObject({
      text: "second",
    });
  });

  it("refuses a missing file, an empty file and an unset RAMPUP_HOME", async () => {
    expect(await readExecutorInstructions({ RAMPUP_HOME: home })).toMatchObject({
      ok: false,
      error: `the discovery executor's instructions ${file()} is missing`,
    });
    await fs.writeFile(file(), "  \n");
    expect(await readExecutorInstructions({ RAMPUP_HOME: home })).toMatchObject({
      ok: false,
      error: `the discovery executor's instructions ${file()} are empty`,
    });
    expect(await readExecutorInstructions({})).toMatchObject({ ok: false });
  });

  it("turns a missing file into a prompt that ends the run with the reason", async () => {
    const prompt = executorSystemPrompt(await readExecutorInstructions({ RAMPUP_HOME: home }));
    expect(prompt).toContain("Do not call any tool.");
    expect(prompt).toContain(`${NOT_CONFIGURED}: the discovery executor's instructions ${file()}`);
    expect(prompt).not.toContain(TOOLS_LINE);
  });
});
