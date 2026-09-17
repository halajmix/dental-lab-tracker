# Account deletion blocked by onboarding — 2026-09-18

Super Admin's Delete clinic action uses `admin-actions/delete-account` when the clinic has an owner, which calls Supabase Auth `deleteUser`. The Sprint 1 onboarding table referenced `auth.users` without an ON DELETE action. Every newly enrolled user therefore had a child row that prevented account deletion, reported by Auth as `Database error deleting user`.

Read-only production inspection confirmed `sprint1_onboarding_user_id_fkey` was the non-cascading auth-user foreign key and that the reported Testing platform clinic had an onboarding record. That clinic has no cases and its owner owns one clinic. No production delete was attempted.

Migration `20260918_onboarding_account_delete.sql` changes only that foreign key to ON DELETE CASCADE, with a short lock timeout and an in-transaction structural assertion. Existing accounts, clinics, cases, and onboarding rows remain unchanged. Future account deletion removes the account's disposable onboarding metadata. Permissions and existing clinic/case deletion semantics remain unchanged.

Isolated PGlite/PostgreSQL regression reproduces SQLSTATE 23503 with the original FK, verifies the migration preserves existing rows, verifies deletion cleans only the selected fictional account and its dependent records, and confirms orphan onboarding records remain prohibited.

Run with PGlite installed: `node tests/onboardingDeletion.integration.mjs`. Alternatively set `PGLITE_MODULE` to an existing PGlite module's absolute path. The test never connects to Supabase.
