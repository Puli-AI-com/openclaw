import fs from "node:fs/promises";
import path from "node:path";

/** Where the CM image ships the executor's standing instructions, under $RAMPUP_HOME
 * (puli-crowdtest: skills/application-discovery/discovery-executor/INSTRUCTIONS.md). */
export const INSTRUCTIONS_RELATIVE_PATH = path.join(
  "application-discovery",
  "discovery-executor",
  "INSTRUCTIONS.md",
);

export const TOOLS_LINE =
  "Your only tools are discovery_observe, discovery_replay, discovery_act and discovery_report.";

/** What every executor answers when its instructions cannot be read; the lead sees it as the
 * executor's result. */
export const NOT_CONFIGURED = "EXECUTOR NOT CONFIGURED";

export type ExecutorInstructions =
  | { ok: true; path: string; text: string }
  | { ok: false; path: string; error: string };

export function instructionsPath(env: NodeJS.ProcessEnv): string | undefined {
  const home = env.RAMPUP_HOME?.trim();
  return home ? path.join(home, INSTRUCTIONS_RELATIVE_PATH) : undefined;
}

/** The executor's instructions, read fresh on every run so an image's file is never cached
 * past a change. A missing, unreadable or empty file is an error, never a fallback. */
export async function readExecutorInstructions(
  env: NodeJS.ProcessEnv,
): Promise<ExecutorInstructions> {
  const file = instructionsPath(env);
  if (!file) {
    const where = path.join("$RAMPUP_HOME", INSTRUCTIONS_RELATIVE_PATH);
    return { ok: false, path: where, error: `RAMPUP_HOME is not set, so ${where} cannot be read` };
  }
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    const reason =
      (error as NodeJS.ErrnoException).code === "ENOENT" ? "is missing" : String(error);
    return {
      ok: false,
      path: file,
      error: `the discovery executor's instructions ${file} ${reason}`,
    };
  }
  if (!text.trim()) {
    return {
      ok: false,
      path: file,
      error: `the discovery executor's instructions ${file} are empty`,
    };
  }
  return { ok: true, path: file, text };
}

/** The executor's whole system prompt: its instructions and the tools line. Without
 * instructions, a prompt that makes the run end at once with the reason, and no tool call. */
export function executorSystemPrompt(instructions: ExecutorInstructions): string {
  if (instructions.ok) {
    return `${instructions.text.trim()}\n\n${TOOLS_LINE}`;
  }
  return [
    `You cannot carry out this instruction: ${instructions.error}.`,
    "Do not call any tool.",
    `Reply with exactly this line and nothing else: ${NOT_CONFIGURED}: ${instructions.error}`,
  ].join("\n");
}
