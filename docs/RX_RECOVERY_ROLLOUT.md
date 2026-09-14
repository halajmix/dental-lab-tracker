# Easier prescription steps and recoverable errors

Changes (2026-09-14):
- Plain-language Patient & lab → Treatment → Appointment & files flow. Next buttons keep the user at an incomplete step; submission opens the first incomplete step. The footer lists missing requirements before the first submit attempt.
- New prescriptions autosave after a short typing pause using the existing authenticated server draft. Explicit saving, saved and failure states; manual retry and retry when the browser reconnects. Existing 24-hour lifetime is unchanged. No new browser patient-data store.
- Serial draft writes prevent delayed saves from resurrecting a submitted/discarded draft. Browser unload warning when the latest draft or files are not safely saved. Close preserves the mounted form and offers Resume.
- Synchronous submit lock; form fields and close actions cannot change the work during a submission. The same client case ID is retained on retry and included in the saved draft. Existing server duplicate reconciliation is reused.
- New-case offline queue admission must succeed before reporting the case saved. Full, unavailable or corrupt device storage leaves the form intact. Repeated queue admission for the same case ID does not add a second operation. Existing non-insert queue behavior is unchanged.
- Failed attachments must be retried or explicitly removed before sending, rather than silently omitted.

Validation:
- All 45 client tests pass, including new storage-full, corrupt-queue, duplicate queue admission and offline replay tests. Both undefined-identifier checks pass.
- Isolated browser fixture uses fictional data and intercepts all API fetches locally. Verified required-field guidance, restoration entry, automatic draft save, close/reload/resume, failed draft warning and successful retry, failed submission retaining input, double-tap producing one call, retry using the same ID, and success clearing the draft. Phone viewport 390×844 has no horizontal overflow. No browser error logs.
- Local staging database: save_rx_draft under authenticated role and own-draft readback succeeded inside a transaction; rolled back. No production clinical writes used for testing.
- Source build succeeds (existing bundle size and mixed-import warnings remain).

No migration, account changes, clinical-data rewrite or authentication changes.
Rollback: republish the pre-release website artifact with its retained assets. Previous Pages revision: f18da8ec92f53cb509e8fd1e7aea352b0dd0c364. No database restore is necessary. Preserve prior hashed assets on release to support already-open tabs.

Limits: drafts still expire after 24 hours; unsaved changes cannot survive a forced browser/process termination while disconnected. Failed or incomplete attachment uploads are not backed up by the server draft. The existing single-draft-per-user design does not merge simultaneous edits from different devices. Existing offline queue security/ownership design is outside this change.

Release verification:
- Source d8360ba published; live entry `/assets/index-BuHJW46u.js` matches the local build byte-for-byte by SHA-256.
- Prior hashed assets retained. Live login page reloaded without browser errors. No authenticated production form session was available; form interaction verification used the isolated fixture.
- Post-release health check: latest recorded client crash still September 12; no new recorded crash. Existing empty mobile-upload probe still returns 500, unchanged from before this release. Noor remains in shadow mode.
