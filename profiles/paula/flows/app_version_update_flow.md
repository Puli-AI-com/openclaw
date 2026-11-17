# Flow: app_version_update

## Purpose

Get a new app version into Puli with its build, tell the user it is being analyzed, and prepare high-quality scenario updates for that version.

## Entry conditions

- The user says there is a new version, or asks to upload a new application version (APK/IPA) or add a link to one, or
- Step 0 of `test_cycle_creation` picked "new build", or
- The session contains an active flow context block:
  `[ACTIVE FLOW] id: app_version_update`.

## Step-by-step

1. **Get the build.** A declaration without a build creates nothing: when the user only says there is a new version, ask for the build in the same reply.
   - **A file (APK or IPA)** in the web chat and the Teams personal chat: every reply there that asks for the build includes `<APPVERSIONUPLOAD></APPVERSIONUPLOAD>` (optionally with prefill JSON) and says a link works too. The widget is the only way to add a file: never ask for an upload without it. Then wait for the upload signal.
   - **A link** in every channel: a Play, App Store or TestFlight link for a mobile app, or the website's URL for a website. In Teams 1:1 and group chats files cannot be uploaded, so ask for a link there. When the user pastes a link (and the platform did not already add it), collect the app's name, the version, the platform and the kind, then add it with `db-client app-versions create` (the `db_client` skill: `--kind website --target <url>` for a website, `--distribution-type` with `--file-url` and the package or bundle id for a mobile app). If it fails, relay the reason in one line and ask for what is missing.

2. **Once the version is saved** (a user event `[APP_VERSION_UPLOADED] ...`, or the create result):
   - Tell the user in one or two sentences that the version is being analyzed, and that you will tell them when it is ready to run a cycle.
   - Ask what changed in this version, which flows/screens were impacted, and what is highest risk.
   - If release notes were already supplied, include them in your summary.

3. **Update version context**
   - Summarize changes back to the user in plain language.
   - Update the version `brief.md` context (version-scoped; do not edit `app.md` unless foundational change).

4. **Propose scenario updates**
   - Suggest a draft list of scenarios to add/update/remove.
   - Let the user correct or add items.
   - Confirm final agreed scenario changes.

5. **Discovery decision policy**
   - `none`: non-structural changes (copy/theme/telemetry only).
   - `incremental`: scoped structural changes affecting specific flows/screens.
   - `full`: foundational changes (auth/nav/core entity/payment model) or low-confidence classification.
   - If confidence is low, ask one focused clarification question before deciding.

6. **Async handling**
   - If discovery is needed, clearly tell the user it runs asynchronously and can take a long time.
   - Continue with immediate scenario guidance while discovery runs.
   - Share follow-up summary when the async work completes.

## Exit conditions

- User confirms scenario plan and no discovery is needed, or
- Discovery/run has been initiated and user has clear next-step expectations.
