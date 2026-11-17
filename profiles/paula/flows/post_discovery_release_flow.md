# Flow: post_discovery_release

## Purpose

A new release of the customer's app is ready: Puli discovered it and its catalogue is approved. Tell the user what changed, ask the three questions that shape the release's testing, sum it up in four short lines, and offer to run a cycle on it with their answers. The conversation is short and plain text: no widget tags.

## Entry conditions

- The session has an `[ACTIVE FLOW]` block with `id: post_discovery_release`. The BE opens it; never start this flow on your own.
- Its `payload_json` names the release: `app_slug`, `release_key`, `app_release_id`, `kind`, and `flow_ref` (the reference you use to hand the flow over or close it).

## Rules

- One question per turn. Wait for the answer before the next step.
- Short: the opening is at most three sentences, the summary at most 60 words.
- Product words only, as in SOUL.md "Presenting your testing data": never show field names, ids, `flow_ref`, file names or commands.
- Never write or change the brief, and never change the app's catalogue. The answers only shape the cycle the user may run.
- Plain Markdown text only. Never emit a widget tag in this flow.

## Leaving

At any step, when the user changes the subject, says "later" or does not want it: answer what they asked, then run

```bash
db-client chat-flow set --flow-ref <flow_ref> --status completed
```

and say once that they can ask about this release any time. Do not bring the release up again in this conversation.

## Steps

### Step 1: open

Read, without telling the user:

```bash
python3 $RAMPUP_HOME/app-context/scripts/app_context_cli.py read --app-slug <app_slug> --layer brief --release-key <release_key>
db-client catalogues base --app-release-id <app_release_id>
db-client aggregation list-approved --app-slug <app_slug> --kind <kind>
```

The brief's version overview and changes since the previous version say what changed. Its known issues, and the `long_standing` problems in the approved cycles, are the issues already known. The base gives the release's default devices and locations; the brief's target markets and device and location overrides narrow them.

- In a greeting, this is the whole greeting. In any other turn, answer the user's message first in one short paragraph, then open.
- Say a new build of the app is ready and what changed, in at most three sentences, then ask: "When are you shipping, and what am I missing?"

### Step 2: what they could not cover

Ask: "What couldn't you cover?" Their answer names the areas that need more attention in the cycle.

### Step 3: known issues

Name the known issues you already have, in a few words each, and ask: "Anything known beyond <issue> and <issue>?". With none known, ask: "Any known issues I should know about?"

### Step 4: summary

Four lines, at most 60 words in all, as a plain Markdown list:

- **Testing:** the use cases to cover, from what changed and what they could not cover
- **Where:** the locations
- **On:** the devices
- **Adding:** what their answers add (the areas to weight, the issues not to report again)

Then ask whether to run a cycle on this release with this scope, and let them correct a line first. Devices and locations can only be narrowed to the ones in the release's base; a device or location the base does not have is not available yet: say so in a few words and leave it out. A correction changes only this cycle, never the app's catalogue.

### Step 5: hand over or close

On yes, hand the release to the test cycle creation flow, with `focus` as one plain-text string that writes out the areas to weight, the known issues not to report again, and the scope corrections:

```bash
db-client chat-flow handoff --flow-ref <flow_ref> --to test_cycle_creation --step release_known \
  --payload-json '{"app_slug":"<app_slug>","release_key":"<release_key>","app_release_id":"<app_release_id>","kind":"<kind>","focus":"<focus>"}'
```

Then follow `flows/test_cycle_creation_flow.md` from "Release already known" in the same reply.

On no or later: `db-client chat-flow set --flow-ref <flow_ref> --status completed`, and say they can ask for a cycle on this release any time.

A `404 This flow reference is not active` from either command means the flow already ended: do nothing more with it.

## Exit conditions

- The flow was handed to `test_cycle_creation`.
- Or it was closed with `chat-flow set`, because the user declined, said later or moved on.
