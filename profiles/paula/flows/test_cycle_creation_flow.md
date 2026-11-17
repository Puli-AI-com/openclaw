# Flow: test_cycle_creation

> In a session that has a `[DEMO CONTEXT]` block, follow `flows/demo/test_cycle_creation_flow.md` instead of this file and skip its Step 0.

## Purpose

Work out the test cycle with the user in the conversation, then create it with the `test-cycle` skill on the release the user named. The release fixes the app, the version and the kind, so there is no kind question. Never pick a release for the user: they name it, or it is handed over.

## Entry conditions

- The user asks to create, start, set up or initiate a new test cycle, in any channel (the web chat, the Teams personal chat, a Teams 1:1 or group chat). A choice list works everywhere: Teams shows it as a lettered list the user answers with a letter.
- Or the session has an `[ACTIVE FLOW]` block with `id: test_cycle_creation` (see "Release already known").

## Choice lists

Every `<SELECT>` in this flow is answered by letter: the first option is A, the second B, and so on. The reply arrives as "{letter}. {label}" (a click, or a letter the user typed, which Puli expands to its option), or text the user typed. Take the option by its label text first, then by its letter, from the options you showed last. A bare letter is a full answer: act on it, never ask the user to confirm it or to tap instead.

## Release already known

When the session has an `[ACTIVE FLOW]` block with `id: test_cycle_creation`, `step: release_known` and an `app_release_id` in its `payload_json`, the release was handed over (for example after Puli finished preparing a new version). Do not ask for the version again: skip Step 0 and Step 1. Take `app_release_id`, `app_slug`, `release_key` and `kind` from the payload. When its `focus` is not empty, use it and skip Step 2. Go to Step 3.

## Steps

### Step 0: existing version or new build

Unless the request already makes it clear (it names a release, or says the build is new), ask exactly one question with a `<SELECT>`:

```
<SELECT>{"id":"cycle_version_gate","prompt":"Is this for a version that's already in Puli, or a new build?","options":[{"value":"existing","label":"An existing version"},{"value":"new","label":"A new build I need to add first"}]}</SELECT>
```

- **Existing version:** go to Step 1.
- **New build:** follow `app_version_update` (`flows/app_version_update_flow.md`) and stop this flow there. A new build has no catalogue until Puli finishes preparing it, so do not come back to this flow at once; the user is told when it is ready to run a cycle, and the release is handed back then.

### Step 1: the user names the release

Run `db-client app-releases list` (the `db_client` skill). It returns the live releases of every app, newest first, each with `id`, `app_slug`, `release_key` and `kind`. Keep these rows for the rest of this flow.

- If the request already names a release key that matches exactly one row, the user has named it: take that row and go to Step 2.
- Otherwise show a `<SELECT>` of the first 5 rows, each labelled `<app_slug> <release_key> (<kind>)`, plus "a different release" as the last option:

```
<SELECT>{"id":"cycle_release","prompt":"Which version should I test?","options":[{"value":"<id>","label":"example 2.4.1 (mobile_app)"},{"value":"<id>","label":"shop 2.4.0 (website)"},{"value":"other","label":"a different release"}]}</SELECT>
```

The reply arrives as "{letter}. {label}" (a click, or a typed letter Puli expanded) or as text the user typed; the option value is never sent. Map the reply to a row by its label text, then by its letter, against the rows you showed. When nothing matches, say so in one line and show the list again.

- **A different release:** ask for the release key, and look it up in the full list from `app-releases list`.
  - One row matches: take it.
  - Several apps have that key: show a second `<SELECT>` of just those rows, labelled the same way.
  - No row matches: say there is no version with that key and ask again.

Never pick one for them, and never fall back to the newest release.

### Step 2: focus

Ask only when the request and the hand-off name none. Ask once:

```
<SELECT>{"id":"cycle_focus","prompt":"What should this cycle focus on?","options":[{"value":"broad","label":"Broad sweep: the whole app"},{"value":"specific","label":"Something specific (tell me)"}]}</SELECT>
```

For "something specific", wait for the user's words and use them as the focus.

### Step 3: confirm in one line, then wait

Always, before any cycle is created, write one line: "Running this on `<app_slug>` `<release_key>` (`<kind>`)", with the focus, and ask the user to confirm. Then end your reply and wait for their answer: never run the skill in the same reply as this line. If their answer contradicts it, go back to the step it contradicts.

### Step 4: create it

Only after the user confirmed Step 3, run the `test-cycle` skill with `app_release_id`, `app_slug`, `release_key`, the user's words verbatim and the focus. This always creates a new cycle: run its `state.py` without `--id`. Never pick up another cycle, even an open one you remember from your notes or an earlier conversation. Then follow the skill.

When the `[ACTIVE FLOW]` payload has a `flow_ref`, close the flow once the skill has created the cycle (or stopped with a message the user received): `db-client chat-flow set --flow-ref <flow_ref> --status completed`. A `404 This flow reference is not active` means it already ended: do nothing more with it.

## Exit conditions

- The skill has created the cycle (or stopped with a message the user received).
- Or the user was sent to `app_version_update` because the build is new.
