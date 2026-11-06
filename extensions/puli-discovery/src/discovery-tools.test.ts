import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AnyAgentTool, OpenClawPluginToolContext } from "openclaw/plugin-sdk/puli-discovery";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDiscoveryTools,
  type HelperRun,
  type HelperRunner,
  MAX_VIEWPORTS,
} from "./discovery-tools.js";

// A 1x1 PNG, the screenshot the fake helper reports.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

type Call = Parameters<HelperRunner>[0];

let runDir = "";
let runPath = "";
let calls: Call[] = [];

function ctx(): OpenClawPluginToolContext {
  return { agentId: "discovery-executor", sessionKey: "agent:discovery-executor:subagent:t" };
}

async function writeLeases(leases: Record<string, string>) {
  await fs.writeFile(
    path.join(runDir, "discovery-state.json"),
    JSON.stringify({ status: "running", leases }),
  );
}

function tools(reply: HelperRun | ((call: Call) => HelperRun), run: string | null = runPath) {
  const runHelper: HelperRunner = async (call) => {
    calls.push(call);
    return typeof reply === "function" ? reply(call) : reply;
  };
  const list = createDiscoveryTools(ctx(), {
    runFor: (key) => (key === ctx().sessionKey ? (run ?? undefined) : undefined),
    runHelper,
    env: { RAMPUP_HOME: "/skills", PATH: "/usr/bin" },
  });
  const byName = (name: string) => list.find((tool) => tool.name === name) as AnyAgentTool;
  return {
    names: list.map((tool) => tool.name),
    observe: byName("discovery_observe"),
    replay: byName("discovery_replay"),
    act: byName("discovery_act"),
    report: byName("discovery_report"),
  };
}

function ok(result: Record<string, unknown>): HelperRun {
  return { code: 0, stdout: JSON.stringify(result, null, 2), stderr: "" };
}

function helperArgs(call: Call): string[] {
  // uv run --project <project> python <script> <command> ...
  return call.argv.slice(6);
}

beforeEach(async () => {
  runDir = await fs.mkdtemp(path.join(os.tmpdir(), "puli-discovery-"));
  runPath = path.join(runDir, "run.yaml");
  await fs.writeFile(runPath, "kind: mobile_app\n");
  await fs.writeFile(path.join(runDir, "shot.png"), PNG);
  await writeLeases({ "i-1": "dev-1" });
  calls = [];
});

afterEach(async () => {
  await fs.rm(runDir, { recursive: true, force: true });
});

describe("discovery tools", () => {
  it("registers exactly the four discovery tools", () => {
    expect(tools(ok({})).names).toEqual([
      "discovery_observe",
      "discovery_replay",
      "discovery_act",
      "discovery_report",
    ]);
  });

  it("runs the device helpers' CLI through uv with the run from the spawn", async () => {
    const { observe } = tools(ok({ page: "home" }));
    await observe.execute("c1", { instruction_id: "i-1", device_id: "dev-1" });

    const [call] = calls;
    expect(call.argv.slice(0, 6)).toEqual([
      "uv",
      "run",
      "--project",
      "/skills/application-discovery",
      "python",
      "/skills/application-discovery/scripts/device_helpers.py",
    ]);
    expect(helperArgs(call)).toEqual([
      "observe",
      `--run=${runPath}`,
      "--device=dev-1",
      "--instruction=i-1",
      "--max-viewports=1",
    ]);
    expect(call.env.DISCOVERY_RUN).toBe(runPath);
    expect(call.cwd).toBe(runDir);
  });

  it("uses DISCOVERY_PROJECT when it is set", async () => {
    const list = createDiscoveryTools(ctx(), {
      runFor: () => runPath,
      runHelper: async (call) => {
        calls.push(call);
        return ok({});
      },
      env: { RAMPUP_HOME: "/skills", DISCOVERY_PROJECT: "/projects/discovery" },
    });
    await list[0].execute("c1", { instruction_id: "i-1", device_id: "dev-1" });
    expect(calls[0].argv.slice(0, 4)).toEqual(["uv", "run", "--project", "/projects/discovery"]);
  });

  it("clamps observe's viewports to 1 through MAX_VIEWPORTS", async () => {
    const { observe } = tools(ok({}));
    for (const viewports of [0, 3, 99]) {
      await observe.execute("c", { instruction_id: "i-1", device_id: "dev-1", viewports });
    }
    expect(calls.map((call) => helperArgs(call).at(-1))).toEqual([
      "--max-viewports=1",
      "--max-viewports=3",
      `--max-viewports=${MAX_VIEWPORTS}`,
    ]);
  });

  it("maps replay's page id to --page and marks it an executor's replay", async () => {
    const { replay } = tools(ok({ landed: true }));
    await replay.execute("c", { instruction_id: "i-1", device_id: "dev-1", page_id: "login" });
    expect(helperArgs(calls[0])).toEqual([
      "replay",
      `--run=${runPath}`,
      "--device=dev-1",
      "--instruction=i-1",
      "--page=login",
      "--executor",
    ]);
  });

  it("passes act's optional arguments only when given, as --flag=value", async () => {
    const { act } = tools(ok({ result: "done" }));
    await act.execute("c", { instruction_id: "i-1", device_id: "dev-1", action: "back" });
    await act.execute("c", {
      instruction_id: "i-1",
      device_id: "dev-1",
      action: "type",
      control: "amount",
      text: "-5",
      row: "#2",
    });
    expect(helperArgs(calls[0])).toEqual([
      "act",
      `--run=${runPath}`,
      "--device=dev-1",
      "--instruction=i-1",
      "--action=back",
    ]);
    expect(helperArgs(calls[1]).slice(4)).toEqual([
      "--control=amount",
      "--action=type",
      "--text=-5",
      "--row=#2",
    ]);
  });

  it("returns the JSON as text and the screenshot as an image", async () => {
    const result = { page: "home", screenshot: path.join(runDir, "shot.png") };
    const { observe } = tools(ok(result));
    const out = await observe.execute("c", { instruction_id: "i-1", device_id: "dev-1" });

    expect(out.content[0]).toEqual({ type: "text", text: JSON.stringify(result) });
    expect(out.content[1]).toMatchObject({ type: "image", mimeType: "image/png" });
    expect((out.content[1] as { data: string }).data.length).toBeGreaterThan(0);
  });

  it("returns every screenshot of a multi-viewport observe", async () => {
    await fs.writeFile(path.join(runDir, "shot2.png"), PNG);
    const { observe } = tools(
      ok({ screenshots: [path.join(runDir, "shot.png"), path.join(runDir, "shot2.png")] }),
    );
    const out = await observe.execute("c", { instruction_id: "i-1", device_id: "dev-1" });
    expect(out.content.map((block) => block.type)).toEqual(["text", "image", "image"]);
  });

  it("keeps the result when a screenshot cannot be read", async () => {
    const { act } = tools(ok({ result: "done", screenshot: path.join(runDir, "gone.png") }));
    const out = await act.execute("c", {
      instruction_id: "i-1",
      device_id: "dev-1",
      action: "tap",
    });
    expect(out.content[0]).toMatchObject({ type: "text" });
    expect(out.content[1]).toMatchObject({ type: "text" });
    expect((out.content[1] as { text: string }).text).toContain("could not be read");
  });

  it("passes a refusal through as a result, not an error", async () => {
    const refused = { result: "refused", reason: "commit control", control: "buy" };
    const { act } = tools(ok(refused));
    const out = await act.execute("c", {
      instruction_id: "i-1",
      device_id: "dev-1",
      action: "tap",
      control: "buy",
    });
    expect(JSON.parse((out.content[0] as { text: string }).text)).toEqual(refused);
  });

  it("refuses every tool when the spawn named no run", async () => {
    const list = tools(ok({}), null);
    for (const tool of [list.observe, list.replay, list.act, list.report]) {
      await expect(
        tool.execute("c", {
          instruction_id: "i-1",
          device_id: "dev-1",
          page_id: "p",
          action: "back",
          markdown: "x",
        }),
      ).rejects.toThrow("DISCOVERY_RUN is not set");
    }
    expect(calls).toEqual([]);
  });

  it("refuses a device not leased to the instruction, before any device call", async () => {
    const list = tools(ok({}));
    for (const tool of [list.observe, list.replay, list.act, list.report]) {
      await expect(
        tool.execute("c", {
          instruction_id: "i-1",
          device_id: "dev-2",
          page_id: "p",
          action: "back",
          markdown: "x",
        }),
      ).rejects.toThrow("device 'dev-2' is not leased to instruction 'i-1'");
    }
    expect(calls).toEqual([]);
  });

  it("refuses everything when the lead has written no state yet", async () => {
    await fs.rm(path.join(runDir, "discovery-state.json"));
    const { observe } = tools(ok({}));
    await expect(
      observe.execute("c", { instruction_id: "i-1", device_id: "dev-1" }),
    ).rejects.toThrow("is not leased");
  });

  it("reports the helper's own error message", async () => {
    const { replay } = tools({
      code: 1,
      stdout: "",
      stderr: 'device call screenshot failed, sending it once more\n{"error": "unknown page p9"}\n',
    });
    await expect(
      replay.execute("c", { instruction_id: "i-1", device_id: "dev-1", page_id: "p9" }),
    ).rejects.toThrow(/^unknown page p9$/);
  });

  it("reports a device error whole", async () => {
    const { act } = tools({ code: 2, stdout: "", stderr: "CLI error: error: device offline\n" });
    await expect(
      act.execute("c", { instruction_id: "i-1", device_id: "dev-1", action: "back" }),
    ).rejects.toThrow("CLI error: error: device offline");
  });

  it("writes the report into the run folder's results", async () => {
    const { report } = tools(ok({}));
    const out = await report.execute("c", {
      instruction_id: "i-1",
      device_id: "dev-1",
      markdown: "**Outcome:** done",
    });
    expect(out.content).toEqual([{ type: "text", text: "saved results/i-1.md" }]);
    expect(await fs.readFile(path.join(runDir, "results", "i-1.md"), "utf8")).toBe(
      "**Outcome:** done",
    );
    expect(calls).toEqual([]);
  });

  it("refuses a report whose instruction id is not a file name", async () => {
    await writeLeases({ "../escape": "dev-1" });
    const { report } = tools(ok({}));
    await expect(
      report.execute("c", { instruction_id: "../escape", device_id: "dev-1", markdown: "x" }),
    ).rejects.toThrow("must be letters, digits");
  });
});

describe.skipIf(process.platform === "win32")("discovery tools with a real process", () => {
  it("spawns uv from PATH and reads its JSON", async () => {
    const bin = path.join(runDir, "bin");
    await fs.mkdir(bin);
    const uv = path.join(bin, "uv");
    // Prints the arguments it got after the script path, as the helper prints its result.
    await fs.writeFile(
      uv,
      '#!/bin/sh\nshift 5\nprintf \'{\\n  "command": "%s",\\n  "discovery_run": "%s"\\n}\\n\' "$1" "$DISCOVERY_RUN"\n',
    );
    await fs.chmod(uv, 0o755);
    const [observe] = createDiscoveryTools(ctx(), {
      runFor: () => runPath,
      env: { RAMPUP_HOME: "/skills", PATH: `${bin}:/usr/bin:/bin` },
    });
    const out = await observe.execute("c", { instruction_id: "i-1", device_id: "dev-1" });
    expect(JSON.parse((out.content[0] as { text: string }).text)).toEqual({
      command: "observe",
      discovery_run: runPath,
    });
  });

  it("turns a failing exit into the tool's error", async () => {
    const bin = path.join(runDir, "bin");
    await fs.mkdir(bin);
    const uv = path.join(bin, "uv");
    await fs.writeFile(
      uv,
      '#!/bin/sh\necho \'{"error": "run.yaml: kind is required"}\' >&2\nexit 1\n',
    );
    await fs.chmod(uv, 0o755);
    const [observe] = createDiscoveryTools(ctx(), {
      runFor: () => runPath,
      env: { RAMPUP_HOME: "/skills", PATH: `${bin}:/usr/bin:/bin` },
    });
    await expect(
      observe.execute("c", { instruction_id: "i-1", device_id: "dev-1" }),
    ).rejects.toThrow("run.yaml: kind is required");
  });
});
