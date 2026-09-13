# Production rollout — 13 September 2026

The approved release is deployed to https://dr-crown.com. Optional new-user guidance remains OFF as agreed. This report supersedes pre-release status statements in FINAL-VERIFICATION.md and LIVE-PREFLIGHT.md.

## Changes deployed

- New cases receive server-stamped Submitted By; the treating-dentist roster/selection and legacy identity display remain compatible. No historical submitter backfill.
- Clear Owner/Admin, Dentist and Receptionist labels use existing role/membership values; existing owners keep access without re-registration. Receptionists retain selection and submission for a treating dentist.
- Improved named-dentist invitations alongside the legacy unnamed invitation path.
- Role-specific, skippable guidance enrollment only for accounts created after installation. Existing users were not enrolled; the guide is disabled.
- Existing email/password authentication retained, with a provider boundary for later additional methods. OTP/magic link is not activated.
- Three tested safeguards protect lab-owned financial columns, prevent membership relocation/reassignment, and protect platform-controlled clinic/lab settings.
- Deployment retains prior hashed assets to support open tabs during upgrades and rollback.

## Migrations applied successfully through production SQL Editor

1. 20260914_guard_lab_financial_columns_restore.sql
2. 20260914_lab_members_no_relocation.sql
3. 20260914_tenant_platform_columns_guard.sql
4. 20260912_sprint1_safe_onboarding.sql

Each used its reviewed transaction with 5-second lock and 30-second statement limits. SQL entered matched executable content; comments/formatting were omitted in the editor. Schema reload notifications completed. No row deletion, historical update, credential change, storage change, or production restore was performed. The first financial-guard paste failed parsing before execution; it was corrected and successfully applied. All subsequent SQL was clipboard round-trip verified before execution.

## Production verification

Before/after record counts and full-row digests matched exactly for cases (21), profiles (20), clinics (12), labs (6), lab_members (17), clinic_members (14). The case comparison excluded only the newly added nullable column. Auth user count remained 23. Guide enabled=false; enrolled users=0; historical cases with stamped submitter=0; all five new triggers present.

Required build checks passed: 53 JSX files, 30 identifier-check files; production build completed. Existing chunk-size and mixed-import warnings remain. An initial local publication attempt stopped before publishing; missing worktree build configuration and no-clobber copy handling were corrected before the successful release.

Source commit: 132d709 (main and feature/sprint1-safe-onboarding).
Pages commit: f18da8ec92f53cb509e8fd1e7aea352b0dd0c364.
Live bundle: index-C7kjz2Gu.js.
Live entry JS, CSS, service worker and previous entry JS were byte-identical to the published artifacts. The existing browser transitioned from the previous cached bundle to the new bundle; login rendered with no captured console errors.

Production health check: data tables responded; 1,650 statements and existing drafts/invitations remained available. Latest recorded client crash remained 12 September 13:22 UTC, preceding this release. Protected Edge Function probes returned 401 as expected. Noor's newest run was SHADOW and completed. The known malformed empty mobile-upload probe still returns 500; valid uploads passed staging tests. No claim of zero possible future errors is made.

## Staging and rollback evidence

See FINAL-VERIFICATION.md: lab workflows 78/78, authenticated rollback 27/27, mobile upload 43/43, additional historical display 79/79, self-signup 102/102, security 17/17; independent database suites and cached-app upgrade/rollback passed. All 2,935 original staged records remained and all 77 original storage files matched their hashes.

Rollback preserves the additive database and every new record: republish the saved previous Pages tree (81559e0), retaining current hashed assets. Do not restore an older database over ongoing work. Previous artifact SHA-256: 39afba9f71a9bb27bc7377f41b028ec26ed668f0414d8a8bd2dac9d828bbb9c6. Provider daily backup visible before release: 12 September 23:04:51 UTC; PITR was not enabled. No new paid service was enabled.

## Remaining limits / next activation

The live Dr-Crown browser was signed out. Authenticated role workflows, submissions, invitations and files were tested in isolated staging, not repeated with real clinical production writes. No real email or test account was created during rollout. Physical printer output and external email delivery are not certified by these checks. The guide remains OFF pending its separate activation decision; Noor remains shadow. The accepted staging restore does not certify recovery of production credentials or an exact full-database disaster restore.
