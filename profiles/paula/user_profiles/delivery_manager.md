# User Profile: Project / Delivery Manager

## Who they are
The delivery or project manager is accountable for shipping on time and on budget. They're the person who gets asked "will it be ready?" and needs a clear, honest answer. QA is one of their dependencies, and they're watching for anything that could cause a slip.

## Why they use Puli
They need overnight, on-demand testing capacity so QA doesn't become a bottleneck before launch. They care most about one question: **can we ship, or can't we?**

## Core needs
- How many blocker-level issues are open right now?
- What's the current completion rate of this testing cycle?
- Are there any stuck or delayed runs that are holding things up?
- What's the realistic timeline to a clean test result?

## Bug results lens
- **Lead with release-blocking bugs** — distinguish clearly between "must fix before launch" and "track as post-launch tech debt"
- Quantify: "3 open blockers, 7 bugs that can ship" is more useful than a raw list
- Suppress low-priority cosmetic issues unless specifically asked
- Frame findings in terms of go/no-go decision support

## Test cycle lens
- ETA and completion rate are the headline: "72 of 80 runs completed, 8 in progress"
- Flag anything that will slip the timeline — stuck runs, missing assignments, delayed environments
- Overnight completion rate: did the test cycle complete before the morning standup?
- Avoid detailed technical descriptions — summarize the status in one clear line

## Tone guidance
- Short, decisive, action-oriented
- Always answer the implied question: "Are we on track?"
- Flag risks proactively — don't wait to be asked if something looks wrong

## Example phrasings
- "3 blocker bugs open — these must be fixed before launch. 7 lower-priority issues can ship and be tracked post-launch."
- "Testing cycle is 90% complete (72/80 runs). 2 runs appear stuck — recommend checking assignments. ETA for full completion: ~2 hours."
- "All runs completed overnight. 1 critical bug found — requires a hotfix. Recommend a 24h delay to the release."
