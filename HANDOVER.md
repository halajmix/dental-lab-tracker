# Dr-Crown — handover notes

Everything a new developer (or coding agent) needs that **cannot be inferred
from the code**. Read this before touching production.

Live at **https://dr-crown.com** · real users: 6 labs, 11 clinics, 18 active
accounts, ~1,650 statements. This is a production system handling real
patients and real money. There is no staging environment.

---

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

- **Noor false "overdue" flags.** Smile World has `tat = 5` and no
  `procedure_tats`, so every case older than 5 days trips "overdue vs promise".
  Data fix (per-procedure TATs in Lab Admin), not code. Blocks Noor go-live.
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

**State:** live in **shadow mode** for Smile World only. It watches, decides
and records; it sends and writes nothing. Two-week gate: review on or after
**2026-09-26**, then decide go-live.

| Piece | Where |
|---|---|
| Design (7 docs + eval fixtures) | `docs/agents/noor/` — read `00` and `02` first |
| Runtime (Deno Edge Function `noor`) | `supabase/functions/noor/` — `index.ts` auth → gate → route; `runner.ts` manual tool loop with hard caps; `authz.ts` server-side tenancy for the 6 write tools; `lib/` pure modules; `jobs/` watcher · brief · patterns (no model) |
| Client UI | `src/Noor.jsx` (`NoorFlagChips`, `NoorClarificationBanner`, `AskNoorPanel`, `NoorBriefCard`, `NoorEscalationInbox`, `NoorStatusPill`); data calls `fetchNoorState` / `askNoor` in `src/lib/data.js`; mounted in `DentalLabTracker.jsx` (dentist table, lab card, lab dashboard, Lab Admin workspace ~line 750) and `LifecycleEngine.jsx` (drawer) |
| Schema | `20260911_noor_phase2_schema.sql`, `20260911_noor_phase2_jobs.sql`, `20260912_noor_trigger_hotfix.sql` — **all applied** |
| Cron | `noor-watch-30min`, `noor-brief-hourly` (fires 07:30 in `labs.timezone`), `noor-patterns-weekly` |
| Switches | `feature_flags.noor.global` (on) · `labs.noor_enabled` (Smile World) · function secret `NOOR_SHADOW` (unset = shadow; `false` = live) · `labs.escalation_user_id` (Tony Hannoun) |
| Model | official SDK via `npm:@anthropic-ai/sdk`; answering `claude-opus-5`, phrasing `claude-haiku-4-5`; `ANTHROPIC_API_KEY` is a function secret (owner says set; unverified until a user question runs). Roles 2/3/6 never call a model |
| Evidence | `agent_runs.would_have` per run; `node scripts/health-check.mjs` has a Noor section — the `would have` line is the daily read |

**Deploying the function:** no Supabase CLI login exists. Bundle to one file with
esbuild (entry `index.ts`, esm, platform neutral, keep `npm:`/`jsr:` external,
json loader — recipe in project memory) and paste into Edge Functions → `noor`
→ Code. **Verify JWT must be OFF.** Then probe: unsigned POST → 401, wrong
secret → 401, GET → 405.

**Verification:** `npm run noor:test` (44), `npm run noor:ui` (8),
`npm run noor:check` (schemas + prompt == docs), `npm run noor:evals`
(14 code-path fixtures; 3 model scenarios skip without a key),
`supabase/tests/test_noor.sql` (RLS matrix + the trigger regression, Docker).

**Go-live checklist (owner + dev):** per-procedure TATs set in Lab Admin →
`would have` output reads true for a few days → gate metrics in
`docs/agents/noor/06-rollout-plan.md` → DPA for case data → Anthropic signed →
set `NOOR_SHADOW=false` → probe a real write within a minute → watch the first
live tick. Roll back = flag off (one row) or the secret removed.

**Design decisions to respect:** Noor reads under the caller's JWT so RLS
decides visibility; the model never sees a tenant id it did not get from a
tool; patient name/phone go to the model only when the case's own clinic asks;
email subjects carry case ids, never patient names; a returned case (open
follow-up round on completed work) is live work again — for the lab queue,
the clinic dashboard and the watcher alike.
