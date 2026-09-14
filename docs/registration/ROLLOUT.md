# Registration without manual activation

Owner requested immediate access for new registrations and review emails to their specified personal inbox. Email verification, tenant RLS, identity guards, existing suspended/inactive states and administrator suspension controls remain in place. No frontend deployment is necessary: existing signup inserts omit organization status.

Deploy registration-notify first; it uses the existing CASE_NOTIFY_SECRET gate and RESEND_API_KEY, with platform Verify JWT off because the private scheduler supplies the secret. No public browser invocation. Apply registration_review_queue with app.registration_review_recipient explicitly set in the SQL session to the owner's requested inbox. Starts disabled; no auth/clinical trigger is added. Queue polls new auth records from installation time, then emits a second event after profile creation. No credentials/tokens/patient information enters these messages. Contact/professional details are self-reported, not verified identity.

Enable queue and verify delivery before applying registration_immediate_access. Defaults become active only for new clinics/labs. Existing pending and suspended records are not changed. If pending pre-release organizations exist, resolve separately using owner authorization and exact IDs. No bulk activation of suspended records.

Minute scheduling and a 10-event batch deliver promptly under normal load; five-minute leases support retries and prevent concurrent claims. Stable payloads and provider idempotency keys cover retries for under 23 hours. Eight failed attempts or expired windows remain visibly unsent for operator intervention; delivery is not guaranteed during provider outages. Polling never blocks signup. Recipient remains server-controlled.

Validation: tests/registrationReview.mjs (disposable PGlite), tests/registrationWorker.mjs (actual bundled worker, mocked network), existing sprint1Database.mjs. Full local staging schema migration passed after granting postgres access to the staging-only cron stub. Authenticated fictional clinic/profile INSERTs received active status and produced signup/setup queue records; transaction rolled back. Production and Resend egress blocked in staging.

Rollback: set registration_review_settings.enabled=false to stop emails; restore clinic/lab defaults to pending to pause immediate access for future organizations only. Retain all accounts, organizations and delivery history; never restore an old database over current work. Existing active users remain active.
