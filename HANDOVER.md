# Dr-Crown — handover notes

Everything a new developer (or coding agent) needs that **cannot be inferred
from the code**. Read this before touching production.

Live at **https://dr-crown.com** · real users: 6 labs, 11 clinics, 18 active
accounts, ~1,650 statements. This is a production system handling real
patients and real money. There is no separate staging backend. Super Admin has a prescription sandbox (see below).

---

## Current patient-name policy — owner override, 19 October 2026

The dentist may type ANY nonblank patient name or reference. Keep placeholder `A. Al Harthi` as an example only. Never require initials, surnames, punctuation, spelling or a particular character set, now or in future. This explicitly supersedes the earlier typed-initial/surname restrictions described below. Patient identity stays typed; Noor remains off. No patient-code or Oman-hosting migration has been implemented.

## Noor update — 13 October 2026

Noor has a shared $15/month platform AI cap. Prescription dictation/typed assistance is now PRIVATE super-admin testing only; ordinary dentists use the manual form. Public prescription flag is off; private admin preview flag is on. Use Super Admin → Test prescription → AI-assisted (or Manual). The private guide walks through patient/lab, treatment, appointment/files, then human review. This sandbox shares the form and Noor service, but cannot save/send cases, share prescriptions, upload files to storage, invite dentists or read/write real drafts. Sandbox attachments are local blobs only. Test input is memory-only and clears on close; AI requests still use the existing private gate and budget. The clinic named “Testing platform” is an ordinary production organization, not isolation by itself. The expired Anthropic key was replaced by the owner and real provider checks passed. See [the release notes](docs/agents/noor/08-prescription-assistant-and-budget.md) for scope, budget accounting, flags, verification and voice limitations.

## 2026-10-19 private prescription sandbox

Published frontend `index-BwNJqJz1.js`. Chrome Super Admin verified: Test prescription → Testing platform context → Smile World → Treatment. Real Noor synthetic request returned FDI 21 / Monolithic Zirconia / A2, reviewed and applied to the memory-only form. Missing patient/date validation passed; complete test clicked twice with local success, file controls disabled in that earlier build, closing/reopening cleared the patient and restorations. No live case-save handler is supplied by this entry point. No microphone recording or device compatibility claim was made. No browser console errors observed. Checks: 63 client tests (including 14 Noor UI tests and two sandbox handler tests), 66 Noor runtime tests, undefined identifier/component checks and production build. Public prescription flag remains off. This is a non-submitting form sandbox, not a separate staging backend; Noor calls retain normal private authorization, audit and budget enforcement.

## 2026-10-19 guided prescription redesign

Private sandbox now opens directly on AI-assisted / Manual choice. AI-assisted uses the same actual form state and validation: browser-only patient/lab speech, four short treatment prompts (teeth, prosthesis, material, shade), one model clarification at a time for omitted implant/bridge details, required appointment date AND time, explicit files/no-files choice, and final human review. Exact spoken lab match only; ambiguous names require dropdown confirmation. Appointment speech accepts explicit ISO or English day/month/year plus explicit 12/24-hour time; uncertain/Arabic/relative dates require the editable date/time controls. Shade photos select lab-confirmed shade and require a photo before review; images are not interpreted by Noor. The only AI payload is treatment answers. Global manual form also has a real three-stage completion bar; public AI feature flag stays off. The sandbox is the sole UI entry for the redesigned AI choice pending owner testing.

Local browser checks cover full typed flow, simulated speech callbacks through patient/lab/treatment/date, implant omissions and follow-up, local STL/photo attachments, repeated final testing, manual switching preserving entered form details, and 375px layout without horizontal overflow. Microphone/device recognition is not certified by these simulated tests. Sandbox file selections never reach storage; QR upload is disabled there, and final test still exits before all case save/share callbacks. Tests: 71 client tests, 66 Noor tests, undefined-name/component gates and production build. No backend/schema/secret/feature-flag change.

Live guided release verified in Chrome: `index-qO1LADb7.js` (source `5f388ef`, test follow-up `e4eb997`). Real structured treatment request and actual new UI both returned tooth 21 / Monolithic Zirconia / A2. Completed patient/lab → treatment → date/time → No files → review → sandbox test, then closed/reopened to verify empty patient. No browser console errors observed. Public flag read back false; private preview true. Original Pages run failed at deploy with HTTP 500; a fresh Pages build completed successfully (run 39299949938). Production backend and clinical records were not modified. The doctor’s own real-device microphone remains an owner test.

## 2026-10-19 typed patient identification

Owner explicitly prohibited patient-name dictation. Both assisted and manual prescriptions now use the shared PatientNameInput: first-name initial plus surname, stored in existing patientName as e.g. `A. Al Harthi`. Guided patient stage has no SpeechAnswer, microphone/language controls, or spoken-name apply action. Voice starts only after Continue to lab. Shared form validation rejects full given-name labels and missing/invalid initials/surnames. Unicode letters, Arabic names, compound/hyphenated surnames and apostrophes are supported. Existing full names are never guessed into initials or surnames and historical records are not migrated; authoring/editing such a prescription requires the dentist to enter the abbreviated label. New UI validation does not replace server access controls or disable operating-system keyboard dictation.

Verification: 74 client tests including name format/privacy renders; undefined JSX/identifier checks and production build. Local Chrome confirmed zero Dictate controls during patient identification, typed `A` + `Al Harthi` becomes `A. Al Harthi`, Manual preserves both fields, and `AB` initial is rejected. Patient identity never enters the Noor treatment payload. Updated existing browser fixtures for split typed name fields. No backend/SQL/feature-flag change.

Live release verified: `index-DLJMcpa9.js`, source `9227af7`, Pages run 39301071334 succeeded. Chrome patient stage has zero Dictate buttons; typed A + Al Harthi becomes A. Al Harthi and remains split correctly in Manual. Closing/reopening cleared the synthetic values; left an empty typed-only patient step open. No real prescription submitted.

## 2026-10-19 lab dictation matching

Owner reported “Smile World Lab” transcribed as “small world love” and no automatic lab selection. The lab step now uses a short single-utterance recognition session with up to five browser alternatives. A unique catalog name/short brand (e.g. Smile World Lab → Smile world dental lab) selects automatically after a final result and recognition end. Joined/spaced brand names and omitted generic Dental/Laboratory suffixes are supported. Brand/branch collisions, conflicting recognized labs and negative/disjunctive utterances require explicit confirmation. No fuzzy match can automatically route a case. The reported noisy phrase produces a “Did you mean …?” button instead. Only currently available labs supplied to the form participate.

New lab dictation replaces the preceding attempt and clears an old selection while listening; typed edits also invalidate it. Re-emitted speech result lists are rebuilt rather than appended, preventing duplicated words. Each recording has a generation guard against late results/end events from a previous session. Patient entry remains typed initials/surname with no speech component; treatment is not auto-corrected or auto-submitted. Browser speech recognition is still the existing provider: alternate transcripts are not guaranteed, and real accented/audio quality still requires owner microphone testing. Experimental phrase bias was deliberately not enabled because support is limited; see MDN SpeechRecognition.maxAlternatives and SpeechRecognition.phrases.

Validation: 80 client tests; local Chrome simulated speech checks for alternative recovery, retry replacement, noisy suggestion/confirmation, conflicting-lab rejection and disabled Continue until selection. No actual microphone accessed in these simulated tests, no case submitted, no new model/provider or platform AI spend for lab matching. Private AI launch gate remains unchanged.

Live lab-matching release verified: `index-BvkbYYPJ.js`, source `5e50c68`, successful Pages run 39302486911 (the superseded concurrent run was cancelled). In a separate signed-in Chrome test, typed short name Smile World Lab resolved to the real Smile world dental lab; editing it to small world love cleared the selection/disabled Continue and offered the correct confirmation. Confirming selected it and re-enabled Continue. No console errors. The auto-speech-end/alternatives path was tested with the local simulated recognizer; actual owner-accent microphone recognition remains an owner test. Existing owner test tab was preserved; a separate current-version private lab question was left ready. No clinical case submitted.

## Stack

| | |
|---|---|
| Frontend | React 18 + Vite 6 + Tailwind 3, PWA via vite-plugin-pwa. **No router** — `/` is the whole app, views switch on state |
| Backend | Supabase (Postgres + PostgREST + Storage + Auth + Edge Functions), project `mtxkushcxczjwypwoxdh`, **Pro** plan |
| Hosting | GitHub Pages from the `gh-pages` branch of `halajmix/dental-lab-tracker` (**public repo**) |
| Email | Resend, from `Dr-Crown <noreply@dr-crown.com>`, called from Edge Functions |
| Node | 22+ (developed on 26) |

## Everyday commands

```bash
npm install
npm run dev          # vite dev server
npm run build        # production build
./deploy.sh          # check + build + publish dist/ to gh-pages
```

## Key files

| Path | What |
|---|---|
| `src/DentalLabTracker.jsx` | The main app — dashboards, case state, most handlers |
| `src/LifecycleEngine.jsx` | Stages, case drawer, inline editors (price, discount, note, shade) |
| `src/PrescriptionForm.jsx` | Rx authoring + shared helpers (`toothSummary`, `includedSummary`) |
| `src/PrintInvoice.jsx` / `src/PrintReceipt.jsx` | A4 invoice and 80 mm thermal receipt |
| `src/lib/invoiceDoc.js` | Money and work-item derivation **shared by both papers** — change it here or they disagree |
| `src/lib/data.js` | Every Supabase call + row↔camelCase mapping (`PATCH_KEY_MAP`) |
| `src/AdminDashboard.jsx` | Super-admin |
| `supabase/schema.sql` | Full schema, RLS, triggers — the source of truth |
| `supabase/migrations/` | Incremental SQL, applied **by hand** (see below) |
| `supabase/functions/` | `admin-actions`, `case-notify`, `mobile-upload`, `payment-reminders` |

## Database changes are manual

There is no migration runner. You write SQL into `supabase/migrations/`, then
**paste it into the Supabase SQL editor and run it**. The repo does not know
what has actually been applied — verify with:

```bash
node scripts/schema-probe.mjs cases     # prints column names only, no data
```

End every migration with `notify pgrst, 'reload schema';` — see gotcha 6.

## Ops scripts

All read the service-role key from the **macOS Keychain** (`drcrown-service-key`)
via `scripts/lib/serviceKey.mjs`.

| Script | Purpose |
|---|---|
| `backup.mjs` | Full dump — all tables + both storage buckets → `~/DrCrown-Backups`, keeps 8. Weekly LaunchAgent `com.drcrown.backup` |
| `health-check.mjs` | Row counts, crash reports, edge-function liveness, backup age |
| `schema-probe.mjs` | One table's column names. Fastest "did that migration land?" |
| `receipt-proof.mjs` | Renders the real receipt via CDP and asserts page geometry |
| `check-jsx-undef.mjs` | Runs inside `deploy.sh` |
| `audit.mjs`, `reprice.mjs` | One-off data tools |

---

## Gotchas — every one of these has already caused a production bug

**1. `guard_lab_financial_columns` silently reverts finance writes.**
Updates to `total_price`, `discount`, `invoice_status`, `base_fee`,
`adjustments`, `billing_note` are reverted for any writer that is not the
case's own lab. The SQL editor runs as `postgres`, not `service_role`, so
data-fix pastes **appear to succeed and change nothing**. Prefix them with
`set role service_role;` and end with a proof `SELECT`.

**2. `price_case()` overwrites `total_price`.**
It fires on any change to `prescription`, `remake` or `lab_id` and recomputes
from the price list. This is why the lab discount is subtracted *inside* that
function — otherwise a later Rx edit silently re-inflates the price. `total_price`
is always the **payable** amount (net of discount); gross is derived, never stored,
because `clinic_statements` sum that column and nothing recomputes a stored
statement total afterwards.

**3. `guard_prescription_edits()` strips lab-side Rx writes.**
The lab cannot edit a prescription — the write succeeds and the change vanishes.
Clinics get a 30-minute window from `created_at`. The prescription is the
dentist's clinical order; this is deliberate.

**4. `@page { size: 80mm auto }` is invalid CSS.**
`size` takes `auto` OR one/two lengths, never both. Browsers drop the whole
at-rule and print the default paper (US Letter), so a receipt written that way
looks correct in source and prints completely wrong. `PrintReceipt.jsx`
therefore **measures** the rendered sheet and injects `@page { size: 72mm <N>mm }`
before printing.

**5. The thermal printer's imageable width is 72 mm, not 80.**
The Xprinter POS-80 driver names its papers `80(72mm) * <height>`. In the macOS
print dialog the user must pick one of those and set **Scaling 100%** — left on
A4 the 72 mm page is *centred* on a 210 mm sheet and lands ~69 mm to the right,
off the roll. Also: Chrome's `--print-to-pdf` CLI flag **ignores** `@page` size,
which is why `receipt-proof.mjs` drives DevTools Protocol with
`preferCSSPageSize: true`.

**6. PostgREST caches the schema.**
After `ALTER TABLE`, writes to the new column can fail with PGRST204 even though
the DDL succeeded — indistinguishable from the value silently vanishing.
Always `notify pgrst, 'reload schema';`.

**7. `is_admin()` is a single function used by 36 RLS policies** (`schema.sql:246`).
It is the one chokepoint for all super-admin reads. It is **deliberately not
gated** and admin accounts cannot be deactivated — see the no-self-lockout note
at `schema.sql:5204` before changing it.

**8. `client_errors` timestamps rows in `at`, not `created_at`.**

**9. `station-session` returning 404 is correct** — that Edge Function's
device-OTP step-up was removed 2026-08-13 for causing friction (it fired on IP
rotation, so lab techs on cellular data hit OTP prompts during normal work).
Nothing calls it.

**10. `deploy.sh` publishes `dist/` to `gh-pages` and never commits source.**
Deploying and committing are independent. It is easy to leave the live site
running code that exists nowhere in git.

**11. THE REPO IS PUBLIC.** Scan every diff for patient data before committing.
The receipt test fixtures were once built from a real invoice and had to be
scrubbed to fictional names. `scripts/.proof/` is gitignored for the same reason.

**12. A trigger function shared across tables must never reference `new.<col>`.**
PL/pgSQL resolves `new.kind` against the *firing* table's row type before it
evaluates your `TG_TABLE_NAME` guard. One such line in `notify_noor_webhook()`
raised on **every write to `cases`** for 13 hours (2026-09-11/12) — dentists
could not submit, labs could not advance stages. Read fields through
`to_jsonb(new)->>'col'`, and give any notification trigger an
`exception when others then raise warning …; return new;` so it can never
block a clinical write. The fix is `20260912_noor_trigger_hotfix.sql`.

**13. Turning a feature flag on is a deployment.** That outage was latent while
`noor.global` was off (the function returned early) and armed the moment it went
on. After any flag flip, probe a real user write within a minute — not just
the feature's own logs.

**14. Vite does not catch undefined identifiers.** A free variable in JSX is a
runtime `ReferenceError` (`noorFlagsByCase is not defined` blanked the dentist
dashboard for 25 minutes). `scripts/check-undef.mjs` runs TypeScript's checker
over every `.jsx` and fails the deploy on `Cannot find name`; it is wired into
`deploy.sh`. Tests that never mount a component prove nothing about it — load
the live page as the affected role before calling a deploy done.

---

## Where security is actually enforced

- **RLS** on all 25 API-exposed tables. Verified: an anonymous request with the
  public `anon` key returns `[]`, not data.
- **`admin-actions`** verifies the caller's JWT then re-checks `profiles.role = 'admin'`
  server-side. The React UI is *not* a boundary.
- **`case-photos` is a private bucket** (clinical photos, STL scans). `avatars`
  is public — profile pictures only.
- Only the `anon` key ships in the browser bundle. The service-role key is in
  the Keychain and used by local scripts only.
- Email **subjects** carry the case ID, never the patient's name; bodies do name
  the patient, since the lab and clinic are both treating them.
- Every case view is written to `login_events`.

## Known open issues (refreshed 2026-09-12)

- **Noor timing blocker resolved 2026-10-11.** Owner specified six calendar
  days for Smile World's clinics, thirteen for Health Center. The pilot uses
  total turnaround rather than assumed one/two-day intermediate stage SLAs;
  stalled work is a separate flag. Later explicit promises are preserved.
- **`SUPPORT_PHONE` in `PrintReceipt.jsx` is one constant**, so every lab prints
  the same phone number and none print their own `contact`.
- **Patient-billed clinics are matched by name** (`PATIENT_BILLED_CLINICS` in
  `lib/invoiceDoc.js`). Renaming the clinic silently reverts to billing it;
  `billsPatientDirectly()` already checks `clinic.billsPatient` first, so a
  `bills_patient` column is a drop-in fix.
- **No account has MFA.** The `Admin` account can read every lab and impersonate
  any user. A device-bound super-admin design exists (see project memory /
  earlier handover) but is not built.
- `mobile-upload` returns HTTP 500 on an empty probe (harmless, undiagnosed).
- `supabase/migrations/20260908_demo_org_flag.sql` + `supabase/demo/` — demo
  data for filming, written, **not applied**, owner deprioritised.
- Two clinic invitations (hind@…, aldhamrif@…) still pending, expire 2026-09-16.
  (The invite accept flow and the expired-link screen were fixed on 2026-09-10 —
  two of four reissued invitations have since been accepted.)

## 2026-09-09 invitation follow-up (source fix)

Read-only production check found one accepted and three pending invitations
expiring September 16. Acceptance therefore works in at least one path; the
confirmation redirect was nonetheless dropping the clinic token.

The frontend now includes the token in signup/reset/resend redirects, remembers
it locally for up to seven days, and clears it when the invitation screen is
completed or dismissed. The server still validates the invitation and email.
Failed auth fragments are consumed before Supabase initializes and shown in a
recovery screen with confirmation resend and login options. No global suppression
of generic script errors was added.

Validation: `node --test tests/authLinks.test.mjs`, JSX checks, production build,
and local browser verification of expired-link messaging and return to login.
End-to-end confirmation and acceptance still need an owner-controlled account;
no accounts were created and no emails sent during these checks. No SQL changes.
Production health also returned HTTP 500 for the empty mobile-upload probe; that
is separate from this fix and has not been diagnosed.

## 2026-09-09 finance organization — requires manual migration

`supabase/migrations/20260909_finance_history.sql` enables a 2026-08-19
history cutoff for the requested lab. Apply it manually, then probe `labs`
and verify `finance_history_before` before deploying the frontend.

Billing history includes old statements and expenses; current billing excludes
old-only work and opening balances. Mixed or undated cutoff-month bills remain
intact in both date views, labelled Spans cutoff. Pending payments defaults to
outstanding records and can filter imported balances, imported bills and app
bills. Its Paid/All statuses filter allows reopening settled opening balances.
A read-only production classification found 1,629 historical, 2 current,
5 mixed/undated and 9 opening-balance statements. One clinic has both an opening
balance and unpaid imported bills; their possible overlap needs reconciliation,
not automatic deletion or settlement.

For the configured lab, accountants gain full same-lab finance history through
RLS. Other labs retain the prior accountant window. Clicking Unpaid opens the
existing payment form; clicking Paid requests a reason and calls the new
lab-finance-only `reopen_clinic_statement` RPC. Reopening voids linked payments
without deleting them, stores actor/reason/payment IDs in the append-only
`statement_payment_corrections` audit table and resets linked paid cases to
issued. Normal payment reads exclude voids even for older clients. Treasury
keeps all available expenses in its balances while the ledger is date-filtered.

Validation: `node --test tests/*.test.mjs`, JSX checks, production build,
fictional browser preview, and disposable PGlite migration/RLS/correction tests
in `tests/financeDatabase.mjs` (PGLITE_MODULE selects a scratch installation).
Production records were only read; no live payment status was changed. The
frontend and database migration must be verified together after owner rollout.

## Clinic balance overview (2026-09-09)

Pending payments is now Clinic balances: read-only grouped balances from
opening debt, Excel bills and platform bills, minus payments applied to open
bills. Settled bills remain available in the statement detail. Unallocated
receipts are displayed separately, never silently deducted; opening cash imports
can also produce such receipts. Integer thousandths keep OMR sums exact.
Unique exact normalized clinic names can be grouped with a registered clinic;
ambiguous matches and spelling variants are not merged or persisted.

The user confirmed the pending sheet covers ALL paper-work debt through
2026-08-31, including August, excluding digital Dr-Crown prescriptions.
`20260909_paper_opening_snapshot.sql` records that cutoff for Smile World only.
After owner application, covered imported bills (clinic_id null, kind work,
month through August) are supporting history and excluded from receivables.
The payment trigger rejects a new payment against such a covered bill; payment
must target the opening balance instead. Digital bills remain collectible at
any date. Future monthly paper imports after August remain collectible.
No records are deleted or marked paid by this change. History PDFs identify
covered bills as supporting history, not new amounts due.

The production read-only rollup with the confirmed rule is 3,173 OMR:
2,703 opening + 470 digital + 0 post-cutoff paper. The former 4,208 of unpaid
paper bills is covered by the snapshot and must not be added again. Payment
allocation and mismatched clinic-name reconciliation are still explicit; the
UI does not infer aliases or deduct unlinked receipts. Tests cover the
snapshot cutoff and server-side duplicate-collection guard as well as grouping.

## Pickup follow-up and daily summary (2026-09-09)

Super-admin Pickup follow-up uses the existing Still at Clinic / Picked Up by
Lab stages, across all labs. No acknowledgment state is invented. Collection
is a recorded lab action, not independent proof of physical pickup. Cancelled
cases are excluded, waiting cases sort oldest first, and elapsed time includes
nights/weekends. Cases refresh every minute while the tab is open.

`supabase/functions/pickup-digest/index.ts` shares reporting logic with the UI
via `_shared/pickupMonitor.js`. Deploy it as pickup-digest, Verify JWT OFF;
CASE_NOTIFY_SECRET is required and fail-closed. It reuses RESEND_API_KEY.
Then owner-applied `20260909_pickup_digest.sql` schedules 18:00 Oman daily to
the sole existing platform admin. No patient fields enter the email. No email
on empty activity/no waiting work. A saved daily payload plus provider
idempotency key avoids duplicate delivery on same-day retries. No automatic
retry cron is added; failed runs can be retried manually that day.

The SQL creates admin-readable, service-writable settings and delivery records.
Pause using `update pickup_digest_settings set enabled=false where id=true;`.
Email delivery is NOT active until the new function and migration are deployed.
Tests: pickupMonitor.test.mjs, pickupDigest.mjs (mocked mail, no real sends),
and pickupSchedule.mjs (disposable PGlite). Browser checked with fictional cases.


## September finance workspace (2026-09-10)

`20260910_work_ledger.sql` is owner-applied. It sets every lab's history boundary
to 1 September 2026 (also defaults for new labs), preserves the existing paper
snapshot configuration, and enables `work_ledger_enabled`. Client tabs and
paper entry are hidden until this flag is returned. Outstanding Balances is
the renamed Clinic balances; its receivable formula is unchanged.

All Work groups completed cases and dated imported/manual line items by clinic.
It uses actual stage-3 completion history in Oman time, never submission date;
cancelled/in-progress cases are excluded. Missing completion dates or aggregate
paper bills are flagged rather than inventing dates or patient details. Digital
statements are not counted again as work. Payment status never hides production.
Older dated work appears alongside bills and expenses in Billing history.

Summary shows current-period production and applied payments, all-date billed
receivables, unbilled completed work, and unlinked receipts separately. Work is
not added a second time to outstanding statements. Unlinked receipts are never
automatically deducted. No new opening debt is inferred for other labs.

Manual paper work is saved by an active same-lab tech/admin/accountant through
`save_manual_lab_work`; it atomically creates a separate imported-style statement
and an append-only audit. Null clinic_id deliberately avoids the digital monthly
generator overwriting paper amounts. Names use the existing unique exact match
for grouping; spelling variants need explicit review. Invoice numbers are required
and cannot reuse existing digital/imported/manual references within the lab.
Totals-only imports overlapping manual entries are blocked for review. Changes
require the current revision; paid entries need payment correction first. Techs
can submit work without gaining access to statements or payments. SQL guards
protect direct API writes and duplicate paper/digital invoice references.

Tests: workLedger.test.mjs, workLedgerDatabase.mjs (PGlite), existing finance and
JSX/build checks. Browser verification uses fictional fixtures only. Database
migration activation must be checked after owner application; no live work or
payments were entered during implementation.

Activation verified after owner application on 2026-09-10: all six labs have
work_ledger_enabled=true and finance_history_before=2026-09-01. The existing
Smile World paper snapshot remains 2026-08-31. Both manual-work tables and
the save RPC are present; a no-user probe is rejected before any write. No
production work entries or payments were created during verification.


## Monthly finance simplification and loading guards (2026-09-10)

All Work, Outstanding Balances, Summary lead the lab finance navigation.
Billing is removed; Billing history now uses the archive view containing all
statements, with year/month/status filters. Pre-September completed work and
expenses remain in that history workspace. Expenses group by month and expand
into category totals and original entries, including existing delete controls.

Summary selects a completion/billing month and reports that month's work,
settlement and unpaid amount. Payments received later still settle their bill's
month. Opening debt and unallocated receipts do not alter another month's
status. Older bills spanning completion months are flagged for review rather
than inventing a per-case payment allocation. The all-date receivable view
remains separate. Existing settled imports use their recorded paid status.

Null-lab guards prevent financeHistoryBefore/workLedgerEnabled crashes while
account data loads, including the technician paper button and finance panels.

`20260910_auto_completed_billing.sql` is NOT applied at source publication.
Owner runs it manually. It attaches completed priced digital cases to the Oman
completion-month statement BEFORE the case response, then recomputes the bill
against saved receipts AFTER the change. Private helper execution is denied to
anon/authenticated. The new `auto_completed_billing` flag activates this for all
labs. Backfill includes only unlinked unpaid completed work with a recorded
completion since September; pre-period work, existing links and payments are
preserved. There is no manual Generate step for new work after activation.

Tests: monthlyFinance.test.mjs, autoBillingDatabase.mjs (PGlite), existing tests,
JSX/build checks, fictional browser checks of monthly expenses, month selection
and missing-lab recovery. Activation still requires owner application and a
read-only verification afterwards.

Automatic billing activation verified after owner application: all six labs
have auto_completed_billing=true. All four eligible completed priced cases
from September are linked to bills, with no missing links, lab/clinic mismatch,
completion-month mismatch, bill-total mismatch or payment-status mismatch.
The September cutoff and existing paper opening snapshot are preserved.
Verification was read-only; no test work or payments were created.


Paper-work clinic input is now a required dropdown sourced from same-lab
billing history (registered display names and imported clinic names). No
free-text clinic creation is offered. `20260910_paper_clinic_dropdown.sql`
adds the names-only staff RPC and validates the selected name in the save
function before any write. Owner application is pending. Until applied,
finance staff use existing RLS-scoped statement reads for the dropdown;
technicians without finance read access may have no choices. No finance
read privileges are granted to technicians by the new RPC. Tested in the
fictional browser and PGlite for valid choices, unknown-name rejection,
other-lab isolation and anonymous denial.


## Noor — the AI case coordinator (2026-09-11 → 12)

**State (2026-10-11):** owner-authorized internal pilot is active for Smile
World lab accounts. Other labs remain disabled and clinic accounts cannot ask
Noor. All Noor email is off. Normal case-notify owns completion messages.
See `docs/agents/noor/07-smile-world-pilot.md` for current scope and checks.

| Piece | Where |
|---|---|
| Design (7 docs + eval fixtures) | `docs/agents/noor/` — read `00` and `02` first |
| Runtime (Deno Edge Function `noor`) | `supabase/functions/noor/` — `index.ts` auth → gate → route; `runner.ts` manual tool loop with hard caps; `authz.ts` server-side tenancy for the 6 write tools; `lib/` pure modules; `jobs/` watcher · brief · patterns (no model) |
| Client UI | `src/Noor.jsx` (`NoorFlagChips`, `NoorClarificationBanner`, `AskNoorPanel`, `NoorBriefCard`, `NoorEscalationInbox`, `NoorStatusPill`); data calls `fetchNoorState` / `askNoor` in `src/lib/data.js`; mounted in `DentalLabTracker.jsx` (dentist table, lab card, lab dashboard, Lab Admin workspace ~line 750) and `LifecycleEngine.jsx` (drawer) |
| Schema | `20260911_noor_phase2_schema.sql`, `20260911_noor_phase2_jobs.sql`, `20260912_noor_trigger_hotfix.sql` — **all applied** |
| Cron | `noor-watch-30min`, `noor-brief-hourly` (fires 07:30 in `labs.timezone`), `noor-patterns-weekly` |
| Switches | `feature_flags.noor.global` (on) · `labs.noor_enabled` (Smile World) · function secret `NOOR_SHADOW` (unset = shadow; `false` = live) · `labs.escalation_user_id` (Tony Hannoun) |
| Model | official SDK; both purposes use `claude-haiku-4-5-20251001`. Real provider checks passed 3/3. Atomic $2/day budget includes input, output and cache usage; no hidden retries. Scheduled monitoring does not call AI |
| Evidence | `agent_runs.would_have` per run; `node scripts/health-check.mjs` has a Noor section — the `would have` line is the daily read |

**Deploying:** CLI is authenticated. `supabase functions deploy noor
--project-ref mtxkushcxczjwypwoxdh --no-verify-jwt --use-api`. The handler verifies
JWT users or the webhook secret itself; do not remove that authentication.

**Verification:** `npm run noor:test` (54), `npm run noor:ui` (9),
`npm run noor:check` (schemas + prompt == docs), `npm run noor:evals`
(14 code-path fixtures; model scenarios are explicitly skipped offline),
`NOOR_EVAL_LAB_ID=<pilot lab UUID> npm run noor:live-evals` (3 synthetic scenarios
against the deployed provider; billable, no patient records or emails),
`PGLITE_MODULE=<installed module> node tests/noorPilotDatabase.mjs` (budget,
rate limits, privileges and unique escalation constraints),
`supabase/tests/test_noor.sql` (RLS matrix + the trigger regression, Docker).

**Pilot controls:** additive migration `20261011_noor_pilot.sql` is applied.
`noor_pilot_settings` has per-trigger live/shadow modes, email opt-in, timings,
and budget. Global `NOOR_SHADOW=false` does not activate an unconfigured trigger.
Rollback: set `NOOR_SHADOW=true` or turn off `feature_flags.noor.global`.
Broader clinic/general rollout still requires a separate decision based on
observed usefulness, correct answers, zero access leaks and zero duplicate sends.

**Design decisions to respect:** Noor reads under the caller's JWT so RLS
decides visibility; the model never sees a tenant id it did not get from a
tool; patient name/phone go to the model only when the case's own clinic asks;
email subjects carry case ids, never patient names; a returned case (open
follow-up round on completed work) is live work again — for the lab queue,
the clinic dashboard and the watcher alike.


## Clinic dentist delegation (2026-09-12)

Clinic admins (including owners) and receptionists can select a treating dentist
when submitting a new prescription. Settings → My Clinics → Team now asks for
name and email for doctor invitations; the prescription form offers the same
operation through Add a Dentist → Add and Invite. Doctors submit their own work
and do not see these invitation controls. Invitation creation uses the existing
email webhook; no new Edge Function or secret is needed.

`supabase/migrations/20260912_clinic_dentist_delegation.sql` requires owner
application **before publishing the frontend**. It creates `clinic_dentists`,
adds invitation names and separate case dentist attribution, and extends the
existing case/notes/rounds/photo/Noor visibility policies to the selected dentist.
The submitting user's `created_by` still comes from their JWT. Dentist/clinic/
submitter attribution cannot be repointed by a client. Existing prescription
edit restrictions and the 30-minute window are preserved.

Invited dentists are selectable immediately, without accounts. Invitation
acceptance links the stable roster identity to the verified account, so their
previous delegated cases become visible. Revoking an unaccepted invite disables
selection; removing membership disables selection and access. Re-inviting reuses
the same identity. Invitation expiry alone does not remove the clinic's dentist
record; revoke/re-invite through Team to renew an expired link. Duplicate pending
invitations are rejected with instructions; no duplicate email is sent.

Backfill adds existing doctor members and existing named clinic owners only.
It sends no invitations and rewrites no historical case attribution. Older
pending invitations lack a supplied dentist name and are not guessed into the
roster; revoke and re-invite with a name if they must be selected before joining.
During the migration-to-frontend interval, old clients' doctor invitations lack
the required name and will be rejected. Publish promptly and refresh open tabs.
Old doctor/admin prescription submissions continue to work; receptionists must
supply a valid same-clinic dentist. Active-account checks are enforced on save.

The selected dentist appears in the case drawer, prescription printout, PDF and
shared prescription text. New prescriptions keep their draft when a save is
rejected. Offline queued submissions retain their selected dentist; the server
revalidates that selection on replay.

Rollout: apply the migration → probe `clinic_dentists`, `clinic_invitations`,
and `cases` → publish committed source with `./deploy.sh` → refresh the affected
clinic role's live page → verify one owner-controlled Add and Invite, receipt
of its email, delegated submission and invitation acceptance. Do not use real
patients as test fixtures. No test email/account/case was created in production
during implementation. Noor remains in shadow with the existing review gate.

Validation: existing 40 client tests, 44 Noor tests, schema/prompt check, 14
code-path evals (3 model evals skipped), both undefined-name checks and build.
`tests/clinicDentistDatabase.mjs` runs the actual migration twice in disposable
PGlite and tests invitation acceptance with the existing RPC, attribution,
permissions/tenant isolation, removal/re-invitation, inactive accounts and
notes/photos/Noor access. `PGLITE_MODULE` can point to a scratch installation.
`tests/clinicDentistBrowser.mjs` uses Playwright/Chrome against a local Vite server
on port 5182 and `tests/fixtures/clinic-dentist-preview.html`; all external
requests are mocked. Set `PLAYWRIGHT_MODULE` if installed outside the repo.
It covers both staff roles, doctor gating, immediate selection, duplicate
invitations, clinic switching, preserving the form after a failed save, and
mobile layout. Screenshots go into ignored `work/`.

Owner reported migration applied on 2026-09-12. Read-only production probes
confirmed clinic_dentists, invitation dentist_name and both case attribution
columns. The roster contains 13 active linked dentists. Latest 10 Noor runs
remain shadow. Frontend rollout follows this verification; real invitation
delivery and delegated case submission still require an owner-controlled flow.

Frontend published and live bundle `index-BLJ4sWTS.js` verified on 2026-09-12.
Live clinic-admin view loaded the treating-dentist roster, Add a Dentist dialog
and Settings team name/email invitation fields. The existing saved draft was
preserved; no invitation or case was submitted. Real email delivery/acceptance
remains an owner-controlled verification. Latest health check has no new client
crashes and Noor remains shadow. Existing mobile-upload empty-probe 500 persists.


## Pending dentist invitation repair (2026-09-12 — activated)

The first delegation rollout missed existing pending doctor invitations without
roster entries: Add and Invite hit the unique pending-email constraint and
incorrectly told staff to select a dentist who was absent from their list.
`20260912_reuse_pending_dentist_invites.sql` adds an authenticated, clinic-scoped
`add_clinic_dentist` RPC used by both Settings and the prescription popup.
It reuses an existing dentist, or creates the missing roster entry from the
entered name and the existing pending invitation. Original token and expiry
are preserved, including pending invitations whose links have expired.
No new email is sent when reusing an invitation. A new email still creates a
normal invitation and a immediately selectable dentist. Invitation acceptance
is not required to submit on the dentist's behalf. A pending invitation for a
different staff role cannot silently be converted to doctor.

Apply this follow-up migration before deploying the new client. It makes no
production data changes until staff use Add and Invite. Tests cover unnamed
legacy invitations, expired links, repeated Add, no duplicate invitation,
submission before acceptance, existing dentists, staff/tenant isolation and
both UI entry points. Noor settings remain unchanged.

Owner applied the pending-invitation repair. The production RPC is present and
rejects a no-user probe before writing. Frontend `index-Cmhhvbxo.js` is live
and its bytes match the built artifact; it calls `add_clinic_dentist`. No real
invitation or case was submitted during rollout verification.

## 2026-10-19 Noor deactivated by owner

Owner explicitly requested deactivation after unsatisfactory prescription dictation. Live database read-back verified all three `noor.*` flags false (global, public prescription assistance, private admin preview); no lab has `noor_enabled=true`; pilot `role_modes={}` and `emails_enabled=false`. A private settings snapshot is outside the public repo. Existing Noor data and provider credentials are retained; do not reactivate without a new owner instruction. Global gate stops scheduled/event processing before audit/model/tools; the database scheduling and event-posting wrappers also return while global is off. Ordinary case-notify and other feature flags were not changed.

Authenticated live probes verified: admin prescription status invisible/disabled with private preview false, draft request rejected before model invocation (403), lab status disabled, lab question skipped with `noor disabled`. No case or email was created. Frontend sandbox now opens the manual form directly and has no AI mode choice or switch. Normal submit/draft controls and the non-submitting manual sandbox remain. Unfinished, untracked tooth-selection experiments were not included in this release.

Deactivation published as source `a85f4fa`, live `index-CkqT-3sg.js`, Pages run 39305503992 succeeded. Current Chrome manual sandbox verified typed fictional identity → Smile World → exact teeth 21/23/24 → Monolithic Zirconia/A2 → required-date rejection → keyboard-entered date → Test passed, nothing saved/sent. No AI choice or microphone controls remain. Existing user test tab was preserved. Old open app tabs may need refresh for the UI change; backend denial is immediate.

Owner requested broader platform checks: 80 client tests, 66 Noor runtime tests, production build/undefined-name checks, and six disposable database suites passed (security guards, finance, automatic billing, dentist delegation, work ledger, onboarding). Added `tests/noorOffDatabase.mjs`: actual production SQL functions with global off emit zero Noor scheduled/event HTTP calls; fictional case insertion/stage update, remake/clarification writes, and an independent ordinary-notification trigger continue. Live read-only checks passed for anonymous protected-table denial, private clinical bucket, lab/clinic case isolation, cross-lab finance denial, invalid QR-token rejection, and no reported crashes since shutdown. These are bounded regression/access checks, not a penetration test or certification of all devices. Live case/email/payment mutations were deliberately not performed. The longstanding mobile-upload JSON-empty-body probe still returns 500; proper missing-token GET/multipart requests correctly return 401. Recent backup is 18 October; no new backup failure indicated.

## 2026-10-19 restore compact manual patient/lab layout

Owner requested the previous organised prescription layout. Restored one typed Patient Name field (initial + surname, e.g. A. Al Harthi) beside Select Lab, replacing the tall split-name fieldset in the manual form. Clinic/dentist context occupies a separate row above this pair, so odd numbers of context fields cannot stagger patient and lab. Existing name-format validation, case data, drafts, treatment/appointment/file workflows and Noor off switches are unchanged. No patient-code migration or hosting migration was performed.

80 client tests, undefined JSX/identifier checks and production build passed. Local Chrome fictional multi-clinic fixture verified patient and lab columns have identical top position and width; screenshot inspected. The private sandbox remains manual and non-submitting.

Live verified: source `ed06424`, bundle `index-DFPCI1e3.js`, Pages run 39308039081 succeeded. Signed-in dentist with three clinics opened the actual New Prescription form: one Patient Name input and Select Lab have identical vertical positions and equal widths; clinic/dentist context is above. No browser console errors. The form was left empty; no patient values, draft, prescription or notification was created. Previous user tabs were preserved; a separate updated empty prescription tab is ready. Old PWA tabs may need refresh.

## 2026-10-19 visible required-field warnings on Next

Owner's live form had an empty Patient Name and a selected lab; Next correctly blocked on validation but only changed a distant footer, making the button appear broken. Next now shows a live alert immediately beside the button listing missing patient/lab/dentist details, gives the patient input an accessible invalid state and explicit example, and focuses that input when it is missing/invalid. Treatment Next likewise lists its missing clinical details. The final submission warning is an accessible alert. Required-field checks remain enforced; no automatic submission or field clearing.

Local fictional Chrome checks: empty name/lab shows both; selecting a lab removes it from warning without clearing other entries; entering F. Example then Next opens Treatment; omitted restoration shows the appropriate treatment warning. The actual user's saved draft was inspected read-only and left unchanged. 80 client tests, undefined JSX/identifier checks and production build passed. Noor remains deactivated.

Live verified: source `bb22ee0`, bundle `index-B3m8jtq-.js`, Pages run 39309134193 succeeded. In a separate Chrome tab, resumed the owner's existing draft read-only, clicked Next without editing values, and confirmed the alert specifically names missing Patient name (initial and surname), with aria-invalid=true and focus on that input. Existing Smile World selection and saved draft retained. Original owner tab untouched. No prescription submitted, notification sent or patient data entered. Screenshot saved outside the public repository.

## 2026-10-19 remove patient name-format restriction

Shared validity now checks only that a string contains a non-whitespace entry. Removed initial/surname parsing and formatting, split-name UI and restrictive helper messages, including in dormant guided UI. Manual placeholder remains A. Al Harthi; empty field shows Enter a patient name or reference. No case data rewritten. 80 client tests, undefined JSX/identifier checks and production build passed; fictional Chrome flow accepted Fictional Person / 123 and advanced to Treatment with its text intact.

Live verified: source `3d4f23c`, bundle `index-4yVojef1.js`, Pages run 39309910308 succeeded. The owner's saved non-initial-form name was retained; Next opened Treatment successfully. No name was typed or rewritten in production, no case submitted, and the existing draft was kept. Original user tab untouched. Local fictional screenshot shows free-form identification accepted; no real patient name included in the evidence artifact.

## 2026-10-19 enlarge prescription working area

Owner reported the fixed header, step navigation, summary and pink footer taking most of the viewport. Manual form now uses a wider max-w-6xl dialog at 96dvh on desktop, compact title/mode/progress rows, and a fixed white action-only footer. Draft-save status, order summary, readiness and submission warnings scroll with the form. Required-field alerts beside Next remain; patient names remain unrestricted and Noor remains off. Phone actions use two columns with 40px minimum button height instead of vertically stacking every action. No clinical, submission, draft or authorization logic changed.

80 client tests, undefined JSX/identifier checks and build passed. Local fictional normal-form Chrome preview measured a 467px scroll area (72% of a 649px dialog), a 51px fixed footer, no horizontal page overflow; triggering required-field alerts does not enlarge the fixed footer. Treatment/Add Restoration remains accessible. No real case submitted. These measurements are for the tested laptop viewport, not physical-device certification.

Live verified: source `cd88323`, bundle `index-1Ovf-zgb.js`, Pages run 39310673797 succeeded. Existing dentist draft was resumed without editing values; live scroll area measured 414px of a 595px dialog (70%), footer 51px with all four actions, no horizontal overflow. No console errors. Original user tab preserved and no case submitted. Fictional normal-form preview also verified New Case / Follow-up switching and Treatment/Add Restoration. Screenshot outside repo uses the fictional preview to avoid patient information.

## 2026-10-19 responsive prescription and centred FDI chart

Owner approved the responsive audit plan and specifically requested the FDI chart open in the middle on iPhone. Tooth chart now centres on mount/container resize, has a Centre chart button, preserves selection during rotation, and uses at least 44px tooth glyphs with accessible keyboard buttons. Horizontal scrolling stays inside the chart; the full arch is not shrunk to unreadable phone-size teeth.

Shared new/follow-up form overlays follow visualViewport height/offset when keyboards/toolbars change. Safe-area padding is applied on mobile/coarse input. Short (<=450px) views scroll the whole dialog so headers/actions cannot sandwich the editor into a tiny strip. Phone/tablet form buttons and file labels have 44px minimum touch targets and inputs stay at 16px. Dropdowns choose available space above/below their trigger; scrolling inside the menu no longer closes it. Lab/dentist/QR dialogs fit the visible viewport. Tailwind hover states are limited to devices supporting hover (verified supported by the installed Tailwind implementation). Added missing horizontal containment to the all-cases and staff-role tables.

80 client tests, 66 Noor runtime tests, JSX/identifier checks and build passed. Chrome CUA viewport tests covered 320x568, 360x640, 375x667, 390x844, 430x932, 540x720, 640x600, 768x1024, 820x1180, 1024x768, 1280x720, 1440x900, 1920x1080, 2560x1440, 844x390, 568x320, 390x360. No page-wide overflow; touch controls >=44px at phone/tablet widths. Short-view actions were reached by scrolling. At 390x360 lab search remained within view. Chart offsets matched centre at widths 320/390/844/768/1440; teeth 21/23/24 stayed selected through all changes. Extended the repository browser test matrix and added a chart/rotation regression; that browser script was syntax-checked, while interactions in this task were exercised through CUA. These are Chrome viewport/reduced-height simulations, not real iOS/Android keyboard or Safari/Firefox/Windows device certification. Source retains unrestricted patient names, Noor off and existing clinical/draft/security behavior.
