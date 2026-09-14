# Nightly platform summary

Owner requested a patient-free summary to their existing registration-review inbox at night. Selected 23:00 Asia/Muscat (19:00 UTC), covering [previous 23:00, current 23:00). Quiet days still produce a summary. Preview messages are separate from scheduled reports.

Confirmed live root cause: error-alerts-hourly exists; no daily digest job or pickup_digest_settings exists. Earlier pickup-digest source was never deployed and would not cover full-platform activity.

Database aggregation exports counts only: registrations/profile setups/new organizations, clinic invitations, cases sent/updated, follow-ups, recorded sign-ins/users/stage actions/print views/other actions, categorized client errors, affected identified users, Noor runs/failures/shadow runs, registration mail delivery counts/failures and current pickup/follow-up backlog. No patient fields, activity details, names, identifiers or raw error text appear in the email. Activity logging is not complete telemetry; a clean count is not proof of no problems. Printing counts are sheet opens, not completed prints.

Deploy platform-digest with Verify JWT ON and existing CASE_NOTIFY_SECRET, RESEND_API_KEY, SUPABASE credentials. Scheduler uses the same public anon JWT + private secret as registration-notify. Apply 20260914_platform_daily_digest.sql, initially disabled, then enable and run one preview via the authenticated scheduler path. Recipient copied from the owner's verified registration-review settings. No signup/case/authentication writes or client changes needed.

Cron checks every five minutes during UTC hour 19. A daily key, five-minute lease, frozen snapshot/recipient and provider idempotency prevent repeated emails. Twelve attempts maximum, within 23 hours. Failure retained for inspection; no unlimited retry or guaranteed delivery during provider outages. Turning enabled=false stops future sends, retaining all history.

Tests: platformDigest.mjs covers Oman cutoff, half-open ranges, privacy, metric counts, disabled state, stable snapshots, leases, deduplication, preview separation and denied access. platformDigestWorker.mjs runs bundled worker against fake network/provider for unauthorized calls, disabled/no-due, success, fixed recipient/idempotency and provider failure. Full staging migration and preview aggregation returned 27 summary fields; transaction rolled back. No external staging mail was sent.
