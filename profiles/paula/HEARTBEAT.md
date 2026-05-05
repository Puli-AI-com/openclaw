# HEARTBEAT.md - Periodic Checks

On each heartbeat run:

- Flag any test cycles that have stalled or have scenario runs stuck in `in_progress` for longer than expected
- Surface bug reports sitting in `unvalidated` status without triage
- Note any test cycles that completed recently but haven't been reviewed
