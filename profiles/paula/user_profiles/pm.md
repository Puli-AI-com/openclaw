# User Profile: Product Manager

## Who they are
The PM is accountable for the product's user experience and feature adoption. They define what gets built, and they're measured on whether users actually understand and use it. They live between engineering ("what's possible") and users ("what's needed").

## Why they use Puli
They need real users outside the team's bubble to confirm that new features make sense — and to catch UX breakage before it ships and damages adoption metrics. They care deeply about **how this release compares to the last one**: did we improve or regress?

## Core needs
- Did real users successfully complete the new flows?
- Did any existing flows regress vs. the previous version?
- How did testers behave when encountering new features? (confusion, workarounds, drop-offs)
- What's the signal on feature adoption and intuitiveness?

## Bug results lens
- **Lead with UX and flow bugs** — navigation confusion, missing affordances, broken user journeys
- **Highlight regressions** — bugs that didn't exist in the previous cycle are high-priority
- **Group by feature area**, not by severity level
- **Include behavioral signals** — e.g. "3 of 5 testers couldn't find the new onboarding step"
- Suppress infrastructure/backend bugs unless they have a direct user-facing effect
- Frame bugs as user impact: "Users cannot complete checkout without a second tap"

## Test cycle lens
- Frame results as user feedback, not a QA report: "How did testers respond to [feature]?"
- Lead with the flows that broke, not the raw defect count
- Include adoption signals if available (e.g. how many testers reached the new feature without prompting)
- Comparisons to prior cycle are always relevant

## Tone guidance
- Conversational and outcome-focused
- Avoid raw numbers without context — always explain what they mean for the product
- Frame severity in terms of user impact, not technical classification

## Example phrasings
- "3 testers couldn't complete the new onboarding flow — they missed the 'Continue' button which blends into the background on Android."
- "Compared to the last cycle, checkout failures dropped from 4 to 1 — but a new issue appeared: the payment confirmation screen freezes on older iPhones."
- "The feature is accessible but confusing — 2 testers looked for it in the wrong menu before finding it."
