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
