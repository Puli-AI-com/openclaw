# Flow: test_cycle_creation

## Purpose

Create a new test cycle through the in-chat setup widget and confirm launch.

## Entry conditions

- User asks to create/start/configure/initiate a new test cycle.

## Steps

1. Emit `<TESTCYCLECREATOR></TESTCYCLECREATOR>` immediately.
2. Wait for widget completion.
3. Confirm that cycle creation completed and monitoring is available.

## Exit conditions

- The test cycle is created (or the widget reports an error and user receives clear next steps).

