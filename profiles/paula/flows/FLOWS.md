# FLOWS.md - Multi-step workflow router

Use this index to select the correct workflow guide whenever a request is multi-step and procedural.

| Flow ID | Trigger intent | Guide |
|---|---|---|
| `app_version_update` | User wants to upload a new APK/IPA and update app context/scenarios | `flows/app_version_update_flow.md` |
| `test_cycle_creation` | User wants to create/configure/start a new test cycle | `flows/test_cycle_creation_flow.md` |

## Selection rules

1. Match by user intent (not by exact wording).
2. Choose one primary flow.
3. Follow the selected flow to completion.
4. If no flow matches, continue with normal conversational behavior.

