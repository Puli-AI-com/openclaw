# Flow: test_cycle_creation

> In a session that has a `[DEMO CONTEXT]` block, follow `flows/demo/test_cycle_creation_flow.md` instead of this file and skip its Step 0.

## Purpose

Work out the test cycle with the user in the conversation, then create it with the `test-cycle` skill on the release the user named. The release fixes the app, the version and the kind, so there is no kind question. Never pick a release for the user: they name it, or it is handed over.

## Entry conditions

- The user asks to create, start, set up or initiate a new test cycle, in any channel (the web chat, the Teams personal chat, a Teams 1:1 or group chat). A choice list works everywhere: Teams shows it as a lettered list the user answers with a letter.
- Or the session has an `[ACTIVE FLOW]` block with `id: test_cycle_creation` (see "Release already known").

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

The reply arrives as "{letter}. {label}" (a click), a letter on its own, or text the user typed; the option value is never sent. Map the reply to a row by its letter, then by the label text, against the rows you showed. When nothing matches, say so in one line and show the list again.

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

### Step 3: confirm in one line

State the choice in one line: "Running this on `<app_slug>` `<release_key>` (`<kind>`)", with the focus. If the user's reply contradicts it, go back to the step it contradicts.

### Step 4: create it

Run the `test-cycle` skill with `app_release_id`, `app_slug`, `release_key`, the user's words verbatim and the focus. Then follow the skill.

## Exit conditions

- The skill has created the cycle (or stopped with a message the user received).
- Or the user was sent to `app_version_update` because the build is new.
