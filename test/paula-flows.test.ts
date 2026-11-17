import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// PUL-85: a test cycle starts in conversation on a release the user names (or one handed over),
// and a new version always ends with its build in the chat.
const PROFILE_DIR = new URL("../profiles/paula/", import.meta.url);

function read(name: string): string {
  return readFileSync(new URL(name, PROFILE_DIR), "utf8");
}

const creation = read("flows/test_cycle_creation_flow.md");
const version = read("flows/app_version_update_flow.md");
const flows = read("flows/FLOWS.md");
const tools = read("TOOLS.md");

describe("the test cycle creation flow", () => {
  it("never opens the setup widget outside a demo", () => {
    const body = creation.split("\n").filter((l) => !l.includes("[DEMO CONTEXT]"));
    expect(body.join("\n")).not.toContain("<TESTCYCLECREATOR>");
  });

  it("enters at release_known with the handed-over release and skips the version questions", () => {
    expect(creation).toContain("`[ACTIVE FLOW]`");
    expect(creation).toContain("`step: release_known`");
    expect(creation).toContain("`app_release_id`");
    expect(creation).toMatch(/skip Step 0 and Step 1/i);
  });

  it("keeps Step 0 and sends a new build to the version flow", () => {
    expect(creation).toContain("### Step 0");
    expect(creation).toContain('"id":"cycle_version_gate"');
    expect(creation).toContain("`app_version_update`");
  });

  it("lets the user name the release from the 5 newest plus a different release", () => {
    expect(creation).toContain("db-client app-releases list");
    expect(creation).toMatch(/first 5 rows/);
    expect(creation).toContain("a different release");
    expect(creation).toContain("`<app_slug> <release_key> (<kind>)`");
    expect(creation).toMatch(/never pick one for them/i);
  });

  it("takes a bare letter as a full answer in every list", () => {
    expect(creation).toMatch(/the first option is A, the second B/);
    expect(creation).toMatch(/A bare letter is a full answer/);
    expect(tools).toMatch(/A bare letter such as "A" is a full answer/);
  });

  it("maps a reply by its letter, then its label, never by the option value", () => {
    expect(creation).toMatch(/by its letter, then by the label text/);
    expect(creation).toMatch(/value is never sent/);
  });

  it("asks one second list when a typed key matches several apps", () => {
    expect(creation).toMatch(/several apps have that key.*second `<SELECT>`/is);
  });

  it("asks the focus once, only when none is known, with a broad sweep", () => {
    expect(creation).toMatch(/only when the request and the hand-off name none/);
    expect(creation).toContain("Broad sweep");
  });

  it("states the choice in one line and hands the release to the skill", () => {
    expect(creation).toContain("Running this on `<app_slug>` `<release_key>` (`<kind>`)");
    expect(creation).toMatch(/never run the skill in the same reply as this line/);
    expect(creation).toMatch(/Only after the user confirmed Step 3/);
    expect(creation).toMatch(/run the `test-cycle` skill with `app_release_id`/i);
    expect(creation).toMatch(/user's words verbatim/);
  });

  it("never asks the kind", () => {
    expect(creation).toMatch(/no kind question/i);
  });
});

describe("the app version flow", () => {
  it("starts when the user says there is a new version", () => {
    expect(version).toMatch(/says there is a new version/);
  });

  it("always gets the build: a file through the widget or a link", () => {
    expect(version).toContain("<APPVERSIONUPLOAD></APPVERSIONUPLOAD>");
    expect(version).toContain("db-client app-versions create");
    expect(version).toMatch(/A declaration without a build creates nothing/);
    expect(version).toMatch(/Teams 1:1 and group chats.*link/s);
  });

  it("says the version is being analyzed and she will follow up when it is ready", () => {
    expect(version).toMatch(/being analyzed/);
    expect(version).toMatch(/ready to run a cycle/);
  });
});

describe("routing", () => {
  it("lets an active flow block win over intent matching", () => {
    expect(flows).toMatch(/`\[ACTIVE FLOW\]` block, that block names the flow to follow/);
    expect(flows).toMatch(/says there is a new version/);
  });

  it("drops the alpha notice rule and the widget as the way to start a cycle", () => {
    expect(tools).not.toContain("[PLATFORM CONTEXT]");
    expect(tools).not.toContain("via the in-app setup widget");
    expect(read("SOUL.md")).not.toMatch(
      /opening the setup widget|start from the in-app setup widget/,
    );
    expect(read("AGENTS.md")).not.toContain("via the in-app widget");
  });

  it("names the release list in the db_client tools", () => {
    expect(tools).toContain("app-releases list");
  });
});
