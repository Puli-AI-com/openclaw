# Flow: app_version_update

## Purpose

Guide a customer through uploading a new app version and preparing high-quality scenario updates for that version.

## Entry conditions

- The user asks to upload a new application version (APK/IPA), or
- The session contains an active flow context block:
  `[ACTIVE FLOW] id: app_version_update`.

## Step-by-step

1. **Open uploader**
   - Emit `<APPVERSIONUPLOAD></APPVERSIONUPLOAD>` (optionally with prefill JSON).
   - Wait for upload completion signal.

2. **After upload completes**
   - If user event `[APP_VERSION_UPLOADED] ...` is present, acknowledge and continue.
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

