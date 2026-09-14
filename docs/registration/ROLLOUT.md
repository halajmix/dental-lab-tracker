# Registration without manual activation

Owner requested immediate access for new registrations and review emails to their specified personal inbox. Email verification, tenant RLS, identity guards, existing suspended/inactive states and administrator suspension controls remain in place. No frontend deployment is necessary: existing signup inserts omit organization status.

Deploy registration-notify first; it uses the existing CASE_NOTIFY_SECRET gate and RESEND_API_KEY, with platform Verify JWT ON. The scheduler supplies the existing public anon JWT as well as the private webhook secret. Store that public token under registration_public_anon_token in private.webhook_config; never use a service-role token. No public browser invocation. Apply registration_review_queue with app.registration_review_recipient explicitly set in the SQL session to the owner's requested inbox. Starts disabled; no auth/clinical trigger is added. Queue polls new auth records from installation time, then emits a second event after profile creation. No credentials/tokens/patient information enters these messages. Contact/professional details are self-reported, not verified identity.

Enable queue and verify delivery before applying registration_immediate_access. Defaults become active only for new clinics/labs. Existing pending and suspended records are not changed. If pending pre-release organizations exist, resolve separately using owner authorization and exact IDs. No bulk activation of suspended records.

Minute scheduling and a 10-event batch deliver promptly under normal load; five-minute leases support retries and prevent concurrent claims. Stable payloads and provider idempotency keys cover retries for under 23 hours. Eight failed attempts or expired windows remain visibly unsent for operator intervention; delivery is not guaranteed during provider outages. Polling never blocks signup. Recipient remains server-controlled.

Validation: tests/registrationReview.mjs (disposable PGlite), tests/registrationWorker.mjs (actual bundled worker, mocked network), existing sprint1Database.mjs. Full local staging schema migration passed after granting postgres access to the staging-only cron stub. Authenticated fictional clinic/profile INSERTs received active status and produced signup/setup queue records; transaction rolled back. Production and Resend egress blocked in staging.

Rollback: set registration_review_settings.enabled=false to stop emails; restore clinic/lab defaults to pending to pause immediate access for future organizations only. Retain all accounts, organizations and delivery history; never restore an old database over current work. Existing active users remain active.

## Production activation — 14 September 2026

Applied queue migration and final scheduler definition, then enabled notifications for the owner's explicitly requested inbox. Platform Verify JWT stayed ON; unsigned/public-token-only requests cannot pass the worker's private-secret gate. The existing public anon token is kept in private webhook configuration, not in these source files.

A single setup review event was deliberately queued from the owner's existing dummy registration to verify real delivery. Provider accepted it on attempt 1 at 17:14:40 UTC; the matching 21:14 Oman message was visible in the owner's Gmail inbox. No new account was created for this check. No other historic signup was backfilled.

Applied immediate-access migration after delivery succeeded. Read-only confirmation: clinics/labs both default to active; 13 clinics and 6 labs (unchanged from preflight); no pending organizations existed before activation; notification switch true; configured recipient verified; cron active; sent=1, failed=0. Latest client crash remained 12 September 13:22 UTC. The live login screen rendered. No frontend build or Pages deployment was needed.

Limit: live authenticated new-account creation was not repeated by the agent. The staged authenticated clinic/profile insert and regression tests covered immediate access. An email-service outage can delay review messages but cannot block registrations. Exhausted deliveries remain in registration_review_events for operational follow-up.
