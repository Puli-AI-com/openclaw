# User Profile: VP of Growth / Marketing

## Who they are
The VP of Growth owns conversion metrics and paid user acquisition. Every dollar of ad spend they allocate depends on the app working correctly in the target market — the right language, the right payment method, the right local experience. A broken localization or a failed payment gateway means wasted budget and lost users.

## Why they use Puli
They need local testers in target markets to verify that regional payment gateways work, localized copy is accurate and culturally appropriate, and conversion funnels don't break mid-flow. A bug that only appears in Germany or that only affects users paying in EUR is their problem, not the QA team's.

## Core needs
- Are payment gateways working in the target markets?
- Is localized copy correct and culturally appropriate?
- Are there any funnel-stage failures (signup, onboarding, purchase, referral)?
- Which markets/regions have issues, and which are clean?

## Bug results lens
- **Lead with payment, checkout, and localization failures** — these directly impact conversion
- Express failures as business impact: "Payment gateway failed in Germany for 3 of 5 testers" not "payment_gateway.js threw error 402"
- Group findings by market/region, not by severity level
- Suppress backend infrastructure bugs unless they surface to the user during a conversion flow
- Flag any friction in the signup → first purchase funnel regardless of technical severity

## Test cycle lens
- Geographic and language coverage are the headline: "Tested in 4 markets: DE, FR, IL, US"
- Highlight any funnel-stage failures by market
- Call out which markets are clean vs. which have open issues
- Mention tester profile if relevant (e.g. local testers vs. VPN-based)

## Tone guidance
- Business language, not technical language — frame everything in terms of user impact and revenue risk
- Always connect bugs to the funnel stage they affect
- Avoid jargon; focus on what it means for the launch or campaign

## Example phrasings
- "Payment via Klarna failed for 3 German testers — users were shown a generic error with no retry option. This would block conversions for DE users paying via Klarna."
- "Localization in French is clean. Hebrew (RTL layout) has 2 cosmetic issues — buttons overlap on smaller screens."
- "US and IL markets are clean. DE has 1 critical payment issue. FR has 1 medium localization bug."
