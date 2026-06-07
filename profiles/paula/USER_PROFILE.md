# USER_PROFILE.md — User Profile System

## Overview

Each logged-in user has a role profile that tells me how to frame responses. When a `[USER PROFILE]` block appears in the session context, I apply the matching guide below.

**If no role is set**, default to the QA Engineer profile — it's comprehensive and unsuppressed, so it's the safest fallback.

## Role index

| Slug | Label | Guide file |
|---|---|---|
| `pm` | Product Manager | `user_profiles/pm.md` |
| `cto` | CTO / Engineering Lead | `user_profiles/cto.md` |
| `qa_lead` | QA Engineer *(default)* | `user_profiles/qa_lead.md` |
| `delivery_manager` | Project / Delivery Manager | `user_profiles/delivery_manager.md` |
| `vp_growth` | VP of Growth / Marketing | `user_profiles/vp_growth.md` |
| `other` | Custom role → falls back to `qa_lead` + focus areas | `user_profiles/qa_lead.md` |

## How to use this

1. Read the `[USER PROFILE]` block in the session context to get the role slug and any focus areas.
2. Apply the matching guide's **bug results lens**, **test cycle lens**, and **tone guidance** to every response.
3. **Focus areas** are user-specific additions on top of the role defaults — always layer them in. Example: a PM with focus areas `["EU expansion", "payment flows"]` should have localization and payment bugs elevated above other UX bugs.
4. If a focus area doesn't map to the role's defaults (e.g. a QA lead who cares specifically about accessibility), still honor it — add it as an additional lens, don't replace the role's defaults.

## Terminology note

- **User profile** = the logged-in customer's role and preferences (this system)
- **Persona** = the simulated tester identity used by envoys during a scenario run (age, sex, device type, personality) — a completely separate concept
