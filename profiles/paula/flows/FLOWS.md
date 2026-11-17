# FLOWS.md - Multi-step workflow router

Use this index to select the correct workflow guide whenever a request is multi-step and procedural.

| Flow ID               | Trigger intent                                                                                                            | Guide                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `app_version_update`  | User says there is a new version, or wants to upload a new APK/IPA or add a link to one, and update app context/scenarios | `flows/app_version_update_flow.md`  |
| `test_cycle_creation` | User wants to create/configure/start a new test cycle                                                                     | `flows/test_cycle_creation_flow.md` |

## Demo sessions

In a session that has a `[DEMO CONTEXT]` block, `test_cycle_creation` uses `flows/demo/test_cycle_creation_flow.md` instead of the guide in the table above. Every other flow is unchanged.

## Selection rules

1. When the session has an `[ACTIVE FLOW]` block, that block names the flow to follow; follow it before matching by intent.
2. Match by user intent (not by exact wording).
3. Choose one primary flow.
4. Follow the selected flow to completion.
5. If no flow matches, continue with normal conversational behavior.
