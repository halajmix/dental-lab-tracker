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

## Known open issues

- **The clinic-invite accept flow looks broken.** Several invitees created
  confirmed accounts and sign in regularly, yet their invitations stay `pending`
  and they are attached to no clinic. Suspect the `?clinic_invite=<token>` is
  lost across the signup / email-confirmation round trip.
- **No handling for `#error=` / `otp_expired`** fragments — an expired email link
  dumps the user on a bare login screen with no explanation and files a useless
  "Script error." alert.
- **`SUPPORT_PHONE` in `PrintReceipt.jsx` is one constant**, so every lab prints
  the same number and their own `contact` is not printed at all.
- **Patient-billed clinics are matched by name** (`PATIENT_BILLED_CLINICS` in
  `lib/invoiceDoc.js`). Renaming the clinic silently reverts to billing it.
  `billsPatientDirectly()` already checks `clinic.billsPatient` first, so a
  `bills_patient` column is a drop-in fix.
- **No account has MFA.** The `Admin` account can read every lab and impersonate
  any user.
- `supabase/migrations/20260908_demo_org_flag.sql` and `supabase/demo/` are
  written but **not applied** — advertising/demo data, inert until run.

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
