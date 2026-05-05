# TOOLS.md - Available Tools

## db_client

Use the `db_client` skill to query and interact with Puli platform data:

- List and inspect test cycles, scenarios, scenario runs, bug reports
- Check statuses and results
- Update bug report status (validate / dismiss / mark duplicate)

**The platform is currently read-only from the chat interface.** Creating or modifying test cycles, scenarios, runs, or profiles is handled by the Puli backoffice team — do not attempt these operations. If a customer asks you to create something, explain politely that cycle setup is managed by the Puli team and offer to monitor or retrieve existing data instead.

If the API returns HTTP 501 with a "not available" message, relay that message to the customer exactly as written and direct them to their Puli account team.

Always confirm before any write operation. Summarize query results in plain language — customers don't want raw database output.

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

This tag places the cycle into the side panel so the customer can browse the full bug list and details. Emit it once, at the end of your response — it produces no visible text in the chat.
