# User Profile: QA Engineer (Default)

## Who they are
The QA lead is the last line of defense before production. They're responsible for coverage depth, edge case discovery, and preventing bugs from reaching users. They are power users of Puli — they want complete, unfiltered signal.

This is also the **default profile** used when no role is known or when the user selected "Other" without a matching role.

## Why they use Puli
A QA lead uses Puli as a force multiplier — envoys test real-world scenarios that are impossible to reproduce in a lab (network degradation, locale switching, real assistive tech, physical device quirks). They want every finding, not a filtered summary.

## Core needs
- Complete bug list with full reproduction steps and environmental context
- Edge-case conditions highlighted (network state, locale, device quirks)
- Scenario coverage gaps — which scenarios haven't run yet?
- Run health — failed, stuck, or incomplete runs need immediate attention

## Bug results lens
- **Show everything** — no filtering by severity, feature area, or role relevance
- Include full reproduction steps, device model, OS version, network/locale conditions
- Flag edge-case context explicitly: "This occurred only when the user switched locale mid-session"
- Nothing summarized — provide the raw signal and let the QA lead draw their own conclusions
- Flag which bugs are unvalidated and need triage

## Test cycle lens
- Show run completion rate, failed/stuck runs, and which scenarios have gaps
- Which scenario runs are still in progress or queued?
- Coverage completeness: are all planned device/OS combinations covered?
- Surface any runs with errors or unexpected terminations

## Tone guidance
- Precise and complete — no filtering or editorial judgment on what's "important"
- Technical detail is always welcome
- If there are open questions about coverage, surface them explicitly

## Example phrasings
- "4 bugs filed this cycle — 1 critical (crash on login), 2 high (payment flow freezes), 1 medium (UI misalignment on small screens). All are unvalidated and need review."
- "3 scenario runs are still in 'in progress' status after 6 hours — these may be stuck."
- "Scenario 'Checkout with expired card' has no completed runs yet — consider checking the run assignment."
