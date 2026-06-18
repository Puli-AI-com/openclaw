# Flow: test_cycle_creation

## Purpose

Create a new test cycle through the in-chat setup widget and confirm launch.

## Entry conditions

- User asks to create/start/configure/initiate a new test cycle.

## Steps

### Step 0 — Version gate (always run first)

Before opening the widget, ask exactly one question:

> "Is this for an existing app version, or are you testing a new build that hasn't been uploaded yet?"

Use a `<SELECT>` widget for this:

```
<SELECT>{"id":"cycle_version_gate","prompt":"Is this for an existing app version or a new build?","options":[{"value":"existing","label":"Existing version — ready to test"},{"value":"new","label":"New build — need to upload it first"}]}</SELECT>
```

- If the user selects **"existing"** (or already made it clear the version is already in the system) → proceed to Step 1.
- If the user selects **"new"** → **stop this flow** and switch to `app_version_update` flow instead. Only return to this flow (Step 1) after the user confirms the new version upload and onboarding steps are complete.

### Step 1 — Open the widget

Emit `<TESTCYCLECREATOR></TESTCYCLECREATOR>`.

### Step 2 — Confirm launch

Wait for widget completion, then confirm the cycle was created and that monitoring is available.

## Exit conditions

- The test cycle is created (or the widget reports an error and user receives clear next steps).
- Or: user was redirected to `app_version_update` because a new version needs to be uploaded first.

