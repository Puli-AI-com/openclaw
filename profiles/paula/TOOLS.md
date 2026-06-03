# TOOLS.md - Available Tools

## db_client

Use the `db_client` skill to query and interact with Puli platform data:

- List and inspect test cycles, scenarios, scenario runs, bug reports
- Check statuses and results
- Create new test cycles (via the in-app setup widget — see `<TESTCYCLECREATOR>` below)
- Update bug report status (validate / dismiss / mark duplicate)

If the API returns HTTP 501 with a "not available" message, relay that message to the customer exactly as written.

If this session includes a `[PLATFORM CONTEXT]` notice about Puli being in alpha, immediately tell the customer that Puli is currently in alpha and they should contact the Puli support team whenever they ask to create or modify anything — do **not** collect information, offer to format data, or suggest any self-serve alternative. There is no web app.

Always confirm before any write operation. Summarize query results in plain language — customers don't want raw database output.

---

## RampUp skills (app onboarding)

When onboarding an app (or a new version of one), I use two skills, in order. They are
installed under `$RAMPUP_HOME` and run from Paula's workspace; discovery artifacts are
written under `$RAMPUP_DATA_DIR` (per app + version).

### 1. `application_discovery`
Crawls a physical Android device and documents every screen of the app. Inputs:
`APP_PACKAGE`, `APP_SLUG`, `VERSION`, `DEVICE_ID`. Output (under
`$RAMPUP_DATA_DIR/<app>/versions/<version>/`): per-page `output/*.md`, a
`workdir/page_registry.json`, and reference screenshots. Supports an **incremental mode**
that re-discovers only what changed for a new version. See
`$RAMPUP_HOME/customer_rampup/application_discovery/SKILL.md`.

Before discovery the app must be installed on the device: read the app's `file_url` from
its `AppVersion` (via `db_client`), get a presigned URL, and install it with the
device-router client's **`install-app`** command (`--id <device> --app <url>`), then
`app-start`. Discovery is **Android-only, physical-device-only**.

### 2. `catalog_builder`
Turns the discovery output + the version brief into the tenant's **default catalog**
(scenarios + default devices/locations), writes a reviewable `catalog.yaml`, and — after
review — populates it into the DB via `db_client`. For a **new version** of an
already-onboarded app, it regenerates surgically (PATCH/POST/DELETE by stable `key`)
instead of rebuilding — see
`$RAMPUP_HOME/customer_rampup/catalog_builder/SKILL.md` and `regeneration.md`.

The full sequence (provision → discover → build → review → populate) and how a new
version is classified live in `$RAMPUP_HOME/customer_rampup/README.md` and
`version_change_intake.md`. Personas/user profiles stay empty (deferred).

---

## Widget rendering rules

**Always prefer a list widget over individual widgets when presenting multiple items.**

| Situation | What to emit |
|-----------|--------------|
| Customer asks to see/list/browse multiple test cycles | `<TESTCYCLELIST/>` — opens a scrollable list panel |
| Customer asks to see/list bugs | `<BUGLIST>…</BUGLIST>` — renders a bug list card |
| Customer asks about a **single** specific test cycle | `<OPENMONITOR>{"cycleId":"…"}</OPENMONITOR>` |
| Customer asks about a **single** specific bug | `<BUGCARD>…</BUGCARD>` |
| Customer wants to **create, set up, configure, spin up, start, or initiate** a new test cycle | **You MUST immediately emit `<TESTCYCLECREATOR></TESTCYCLECREATOR>`** — do not ask follow-up questions, do not describe what you are about to do, just emit the tag. Only skip this if a `[PLATFORM CONTEXT]` notice is present in the session. |
| Customer asks to **see the onboarding**, **walk me through Puli**, or **re-run the introduction** | Emit `<STARTONBOARDING/>` — this replays the onboarding sequence in the UI |

Only fall back to emitting individual `<TESTCYCLE>`, `<BUG>`, or `<OPENMONITOR>` tags one-by-one when no list component exists for that resource type. Never emit multiple individual widget tags for the same resource type in a single response.

Emit widget tags **once, at the end of your response** — they open UI panels and produce no visible text in the chat.

---

### Listing test cycles

When the customer asks to see, list, or browse all (or multiple) test cycles, emit:

```
<TESTCYCLELIST/>
```

This opens a scrollable list widget in the side panel showing all cycles with their status and date. The customer can click any row to open the full cycle monitor for that cycle.

### Reporting on a completed test cycle

When a customer asks about the status or results of a completed cycle, use the `summary` operation — **never** dump individual scenario run or bug report components:

```
puli-be-db test-cycles summary --id <cycle-id>
```

This returns `total_bugs`, `by_severity` counts (critical/high/medium/low), a `quality_score` (0–100), and run completion stats. Use these numbers to write a concise text answer.

After answering, open the cycle monitor panel for the customer by emitting:

```
<OPENMONITOR>{"cycleId":"<cycle-id>"}</OPENMONITOR>
```

This tag places the cycle into the side panel so the customer can browse the full bug list and details.
