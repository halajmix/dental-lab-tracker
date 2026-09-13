# Live schema preflight — 13 September 2026

Read-only inspection completed through the signed-in Chrome Supabase SQL Editor for project mtxkushcxczjwypwoxdh, main Production. Queries ran inside BEGIN READ ONLY with a 15-second statement timeout. No clinical/user rows were queried, no migration was applied, no trigger/flag was altered, and no restore was started. A separate query tab preserved the existing user SQL.

## Results

- guard_lab_financial_columns is SECURITY INVOKER and its live body protects the seven September fields but omits statement_id, invoice_number, price_overridden and lab_shade, matching the reproduced staging regression. cases_guard_financials binds it BEFORE UPDATE.
- lab_members_update_admin uses the same-lab/admin USING predicate with implicit WITH CHECK. The separate permissive lab_members_claim_invite check is user_id=auth.uid(). Only claim and notification triggers exist on lab_members; there is no tenant-pinning trigger. The live definitions match the combination reproduced in staging.
- Clinics have owner and administrator UPDATE policies and only the owner-membership trigger. Labs have the expected owner/creator/admin UPDATE policies and only the owner-membership trigger. No platform-column guard is present. The candidate protection addresses this live configuration.
- guard_invite_claim, guard_case_lab_binding and sync_invited_dentist match the relevant pre-migration source. The latter still lacks the candidate's legacy unnamed-invitation compatibility return.
- is_admin, is_lab_admin and my_lab_id bodies were read live and compared to the running staging database; they match after whitespace normalization. Administrator behavior is preserved by the proposed fixes.
- Required cases/clinics/labs/lab_members columns and types are present. cases.submitted_by_name and both sprint1 onboarding tables are absent. No custom auth.users trigger appeared in the inspected trigger inventory. The onboarding migration has not been applied.

This is targeted verification of the release dependencies, not a claim that every production function or policy was compared. No exploit was attempted against production; matching live definitions substantiate the staging findings.

## Recovery point

The Scheduled Backups screen lists seven physical daily backups, newest 2026-09-12 23:04:51 UTC (2026-09-13 03:04:51 Oman). The Point in Time screen says the add-on must be enabled; it is not enabled. Supabase explicitly notes that storage object bytes are not included in its database backups. No backup settings or paid add-ons were changed. The independently verified 77 storage files remain available locally.

Routine release rollback is the tested previous-client rollback with all additive schema and intervening records retained. The daily backup is not an up-to-the-minute substitute for that procedure.

## Decision

The signed-in access blocker and targeted live-schema preflight are cleared. The concrete staged release comprises the three 20260914 security migrations and 20260912_sprint1_safe_onboarding.sql, followed by the reviewed client with optional guidance initially OFF. Final owner production approval remains pending. Guide activation is a later explicit step: its current switch covers all eligible new accounts, not a per-clinic cohort.
