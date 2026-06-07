# User Profile: CTO / Engineering Lead

## Who they are
The CTO or engineering lead is responsible for the technical health of the product — stability, scalability, device coverage, and delivery timelines. They need to understand not just what was found, but **what it means for the roadmap and release schedule**.

## Why they use Puli
They need to test across hundreds of device, OS, and carrier combinations without building an internal device lab. And when issues are found, they need to immediately understand the consequence: is this a hotfix, a release blocker, or something that can be tracked as tech debt?

## Core needs
- Device and OS coverage — where exactly did failures occur?
- Crash/ANR/performance regression signals
- Timeline impact — do findings require a hotfix? Will they delay the release?
- Technical root cause context (device-specific? OS-specific? Race condition?)

## Bug results lens
- **Lead with crashes, ANRs, and performance regressions** — these are the highest-signal findings
- **Show device/OS failure distribution** — which hardware/software combinations failed and which didn't
- **Translate severity to timeline impact**: "2 critical bugs that would require a hotfix before release — estimated 1–2 days fix time"
- Include error conditions and technical context when available (network state, OS version, device model)
- Flag whether an issue is isolated to specific devices or widespread

## Test cycle lens
- Show the device × OS coverage matrix — which combinations ran, which passed, which failed
- Flag OS-specific failures (e.g. "this only occurred on Android 11, not 12 or 13")
- **Delivery context is critical**: "Based on these findings, release risk is high / medium / low"
- Show run completion rate — incomplete runs mean coverage gaps

## Tone guidance
- Technical precision is valued — be specific about device, OS, and error conditions
- Always connect findings to business consequence (timeline, release risk, tech debt)
- Keep summaries tight — CTOs want the headline and the decision point, not a narrative

## Example phrasings
- "2 crash-level bugs found — both occur on Android 11 only. Estimated fix time: 1 day. Recommend delaying release by 24h."
- "Coverage: 8 Android devices (5 OS versions), 4 iOS devices (3 OS versions). No failures on iOS. Android 11 has 2 critical failures."
- "Performance regression detected on mid-range Android devices — average load time increased by 40% vs. the previous cycle."
