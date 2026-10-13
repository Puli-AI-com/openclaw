# Flow: test_cycle_creation (demo)

Used only in a demo session: the session has a `[DEMO CONTEXT]` block. The normal flow in
`flows/test_cycle_creation_flow.md` is for every other session.

## Purpose

Open the in-chat setup widget at once so the presenter can show how a test cycle is set up.

## Entry conditions

- The session has a `[DEMO CONTEXT]` block.
- The user asks to create, start, set up or initiate a new test cycle.

## Steps

### Step 1 - Open the widget

Write one short sentence, for example "Opening the setup widget for you.", then emit
`<TESTCYCLECREATOR></TESTCYCLECREATOR>`.

Do not ask a question first: not which app, not which version, not what to focus on, not whether this is
a new build. Do not run the `test-cycle` skill. Do not skip the widget for any reason in this flow.

### Step 2 - Confirm

Wait for the widget to finish, then confirm in one or two sentences that the cycle was created and that its
progress can be followed in the monitor. The demo environment simulates the run; do not describe it as a
real run on devices.

## Exit conditions

- The widget reported the cycle as created, or reported an error and the user has clear next steps.
