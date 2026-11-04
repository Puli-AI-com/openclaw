import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// PUL-391: Paula answers customers only from a cycle's reviewed problems, never from raw bugs.
const PROFILE_DIR = new URL("../profiles/paula/", import.meta.url);

function read(name: string): string {
  return readFileSync(new URL(name, PROFILE_DIR), "utf8");
}

const userProfiles = readdirSync(new URL("user_profiles/", PROFILE_DIR))
  .filter((name) => name.endsWith(".md"))
  .map((name) => [`user_profiles/${name}`, read(`user_profiles/${name}`)] as const);

const tools = read("TOOLS.md");

describe("Paula's TOOLS.md", () => {
  it("answers customers' bug questions from test-cycles problems", () => {
    expect(tools).toContain("puli-be-db test-cycles problems --id <cycle-id>");
    expect(tools).toMatch(
      /Customer questions about a cycle's bugs are answered only from the cycle's reviewed problems \(`test-cycles problems`/,
    );
  });

  it("marks the raw bug commands as for her own steps only", () => {
    const line = tools
      .split("\n")
      .find((l) => l.includes("`test-cycles bugs`") && l.includes("`bug-reports ...`"));
    expect(line).toBeDefined();
    expect(line).toContain("the bug examples of `query`");
    expect(line).toMatch(/for my own steps only/);
    expect(line).toMatch(/never shown to customers/);
  });

  it("finds the cycle silently, without its id or a narrated lookup", () => {
    expect(tools).toContain("I find the cycle silently: I never write its id");
    expect(tools).toContain("I write nothing before or between my lookups");
    expect(tools).toMatch(/The same holds in a follow-up, when I look the cycle up again/);
  });

  it("shows a problem in its card in follow-ups too, never in a table", () => {
    expect(tools).toMatch(/This holds for every reply about problems, a follow-up question too/);
    expect(tools).toMatch(/never as a markdown table or a plain-text list of their fields/);
  });

  it("never says where its information came from", () => {
    expect(tools).toContain(
      "I never tell the customer where my information came from or how I got it",
    );
    expect(tools).toMatch(/the reply starts with the answer/);
    // Wording she repeated to customers (PUL-391 verify): the rule must not hand it to her.
    expect(tools).not.toMatch(/already read earlier in the chat/);
  });

  it("asked for raw bugs, says it shares the reviewed problems instead", () => {
    expect(tools).toMatch(
      /I say in one sentence that I share the problems Puli's reviewers approved, not the testers' individual reports/,
    );
    expect(tools).toMatch(/I never call the problems the bugs the testers filed/);
  });

  it("before approval gives run progress only", () => {
    expect(tools).toMatch(/\*\*Before approval\*\* \(`status` is `in_review`/);
    expect(tools).toMatch(/Say the results are being reviewed and give run progress only/);
  });

  it("reads cycle results from the problem summary", () => {
    expect(tools).toContain("puli-be-db test-cycles summary --id <cycle-id>");
    expect(tools).toContain("`total_problems`");
    expect(tools).toMatch(/`none` for problems with no severity/);
    expect(tools).not.toContain("total_bugs");
  });

  it("shows problems with BUGCARD and BUGLIST built per the db_client Rendering Rules", () => {
    expect(tools).toMatch(/One problem → `<BUGCARD>`; several → `<BUGLIST>`/);
    expect(tools).toMatch(/`db_client` skill's "Rendering Rules" say for `test-cycles problems`/);
    expect(tools).toMatch(/whether it is blocking, its category and the page it happened on/);
  });

  it("names the hand-off ticket and its link", () => {
    expect(tools).toMatch(/hand-off ticket id \(`handoff_ref`\) and its link \(`handoff_url`\)/);
    expect(tools).toMatch(
      /- `handoff_ref`, `handoff_url`: the hand-off ticket .* and that ticket's link/,
    );
  });

  it("knows every problem field", () => {
    const fields = [
      "title",
      "severity",
      "review_status",
      "blocking",
      "category",
      "version_since",
      "funnels",
      "area",
      "page",
      "description",
      "expected_result",
      "actual_result",
      "steps_to_reproduce",
      "what_happened_log",
      "screenshot_url",
      "recording_url",
      "state",
      "handoff_ref",
      "handoff_url",
    ];
    const section = tools.slice(tools.indexOf("**What each problem carries.**"));
    for (const field of fields) {
      expect(section, field).toContain(`\`${field}\``);
    }
    expect(section).toMatch(/`funnels`: .*each with its own category and version since/);
  });

  it('answers "is this new?" from the category with its three values', () => {
    const answer = tools.slice(tools.indexOf('**"Is this new?"**'));
    expect(answer).toMatch(/from the problem's `category`/);
    expect(answer).toContain("**new**");
    expect(answer).toContain("**regression**");
    expect(answer).toContain("**long-standing**");
    expect(answer).toMatch(/per funnel/);
  });

  it("has no <BUG> fallback and no bug status updates", () => {
    expect(tools).not.toContain("<BUG>");
    expect(tools).not.toMatch(/validate|dismiss|mark duplicate/i);
  });

  it("opens the monitor to browse the cycle's problems", () => {
    expect(tools).toMatch(/<OPENMONITOR>[\s\S]*browse the cycle's problems/);
    expect(tools).not.toMatch(/browse the full bug list/);
  });
});

describe("Paula's SOUL.md, AGENTS.md and user profiles", () => {
  const files = [
    ["SOUL.md", read("SOUL.md")],
    ["AGENTS.md", read("AGENTS.md")],
    ["USER_PROFILE.md", read("USER_PROFILE.md")],
    ...userProfiles,
  ] as const;

  it("has the user profiles to check", () => {
    expect(userProfiles.length).toBeGreaterThan(0);
  });

  for (const [name, text] of files) {
    it(`${name} offers customers no bug triage`, () => {
      expect(text).not.toMatch(/triag|validat|dismiss|duplicate/i);
      expect(text).not.toMatch(/raw signal|complete bug list|bug results lens/i);
    });
  }

  it("SOUL.md and AGENTS.md describe answers from reviewed problems", () => {
    expect(read("SOUL.md")).toMatch(/from its reviewed problems/);
    expect(read("AGENTS.md")).toMatch(/answering from the cycle's reviewed problems/);
  });

  for (const [name, text] of userProfiles) {
    it(`${name} has a problem results lens`, () => {
      expect(text).toContain("## Problem results lens");
    });
  }
});
