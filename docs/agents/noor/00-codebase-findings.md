# 00 — Codebase findings

What the repository actually contains, as read on branch `noor/phase1-design`
(base `8390065`). Every statement below was verified against the source or the
live schema; nothing is assumed from framework defaults.

## 1. Stack and shape

| | |
|---|---|
| Client | React 18 + Vite 6 + Tailwind 3, installable PWA. **No router** — `/` is the whole app; views switch on component state. |
| Backend | Supabase project `mtxkushcxczjwypwoxdh` (Pro): Postgres + PostgREST + Auth + Storage + Edge Functions (**Deno / TypeScript**). |
| Hosting | GitHub Pages, `gh-pages` branch. Repo is **public**. |
| Email | Resend, from `Dr-Crown <noreply@dr-crown.com>`, HTML assembled inline in Edge Functions. |
| Scheduling | `pg_cron` → `private.*` SQL function → `pg_net` HTTP POST → Edge Function, authenticated by a shared secret in `private.webhook_config`. Three jobs exist. |
| Tests | SQL role/RLS tests under `supabase/tests/` run against a throwaway Postgres in Docker; client checks are ad-hoc harness scripts. **No JS test runner, no linter config, no CI.** `deploy.sh` runs `scripts/check-jsx-undef.mjs` then `vite build`. |
| README | Stale — describes a localStorage demo from before the Supabase backend. |

## 2. Data model (relevant tables)

### `cases` — the unit of work
`id` (app-generated `C-<base36 timestamp><2 random>`), `clinic_id`, `lab_id`,
`patient_name`, `patient_id`, `patient_phone`, `appointment_date` (the clinic's
**"Next appointment"** — its need-by date), `delivery_time`
(`Anytime|Morning|Afternoon|Before sunset|Evening`), `created_date`, `created_at`,
`stage_index` 0–4, `handover` jsonb, `remake` jsonb, `prescription` jsonb,
`history` jsonb, `invoice_number`, `assigned_tech_id`, `base_fee`,
`adjustments`, `total_price`, `discount`, `billing_note`,
`invoice_status` (`draft|issued|paid`), `statement_id`,
`cancel_status` (`none|requested|cancelled|declined`), `cancellation_fee`,
`price_overridden`, `lab_shade`, `created_by`.

**Stages** (`src/LifecycleEngine.jsx`):
`0 STILL_AT_CLINIC` (dentist) → `1 PICKED_UP_BY_LAB` (lab) → `2 WORK_IN_PROGRESS` (lab)
→ `3 WORK_COMPLETE` (lab) → `4 CLINIC_RECEIVED` (dentist).

**`history`** entries: `{at, action: advance|revert|handover|cancellation, toStage, label, by, role}`
— a complete, timestamped stage audit already exists per case.

**`handover`**: `{type: "Delivered to Clinic" | "Patient Picked Up", confirmed, ...}`.

**`remake`** (Phase 4 "Log Remake", one slot per case): `{classification: clinical|laboratory, reason, cost}`
with a fixed 9-reason taxonomy in `src/Remake.jsx` (`REMAKE_REASONS`):
- clinical: Margin distortion / Unclear prep · Insufficient occlusal clearance · Impression drag · Incorrect shade selection
- laboratory: Open margin on die · Tight/Loose proximal contacts · Shade mismatch · Framework fitting error · Porcelain fracture

### `prescription` jsonb (written by `src/PrescriptionForm.jsx` at submit)
```
caseMode: "restorations" | "appliance"
notation: "FDI" | "Universal"
restorations: [{ id, category, material, shadeGuide, vitaShade, stumpShade,
                 teeth: [{ fdi, universal, role: abutment|pontic|veneer }],
                 arches: upper|lower|both, implantSystem, abutmentType, abutmentColor }]
included: subset of 8 fixed items   includedOther: free text
files: [{ name, size, kind: "scan" | "photo", url }]     // scan = .stl or .pdf
notes: free text     pickupRequested: bool
estReady: ISO date   // lab promise date computed at submit, see §5
```
- **21 categories** with per-category material lists (e.g. `Crown - implant` → Zirconia, E.max, PFM, PMMA).
- **Shade guides:** Vita Classical, Vita 3D-Master, Ivoclar Chromascop, Bleach/Whitening, Custom/Photo, plus the sentinel `"Shade by Lab"` (lab records `cases.lab_shade` later; production is blocked until it does).
- **Included items:** Upper impression, Lower impression, Bite registration, Wax rims, Verification jig, Shade photos, Study model / cast, Previous prosthesis.

### `case_rounds` — follow-ups after submission
`parent_case_id`, `kind` (`stage|update|remake|adjustment|refit`), `instructions` (text, **mandatory for remake** in the UI), `attachments` jsonb, `pickup_requested`, `status` (`open|resolved`), `created_by*`, `resolved_*`.
**A remake round carries no structured reason** — only free text. See gap G2.

### `case_notes`
`case_id`, `author_name`, `author_role` **CHECK IN ('dentist','lab')**, `body`. Noor cannot write here without widening the constraint (gap G10).

### Organisations and people
- `labs`: `owner_id` (nullable), `email`, `notify_email` (preferred recipient for new-case mail), `tat` int default 5, **`procedure_tats` jsonb `{category: days}`**, `express_pct`, `status`, `is_public`, `payment_reminders_enabled` (a per-lab feature flag — the precedent to follow), `created_by_clinic_id`.
- `clinics`: `owner_id`, `dentist`, `email`, `contact`, `status`, `is_exclusive`.
- `profiles`: `role` (`dentist|lab|admin`), `name`, `phone`, `clinic_id`, `lab_id`, `status` (`active|inactive`). **No email (lives in `auth.users`), no language, no timezone.**
- `lab_members`: role `lab_admin|lab_tech`. `clinic_members`: role `admin|receptionist|doctor`.
- `clinic_lab_access`, `clinic_price_rules`, `price_schedules/_items`, `clinic_statements`, `lab_payments`, `rx_drafts`, `mobile_upload_sessions`.
- `login_events`: the generic activity log (`user_id, name, email, role, org_name, action, detail≤300 chars`). Every "viewed case", stage change, price change is written here via `logActivity()`.
- `client_errors`: browser crash reports (`at, message, stack, url, ua, user_id`).

## 3. Auth and tenancy

Supabase Auth JWT → RLS on all 25 exposed tables. Identity is derived server-side
by SECURITY DEFINER helpers: `my_clinic_id()`, `my_clinic_ids()`,
`my_owned_clinic_ids()`, `my_lab_id()`, `has_clinic_role(clinic, roles[])`,
`clinic_owner(clinic)`, `is_admin()`. A deactivated profile makes the helpers
return nothing, darkening every policy instantly. `is_admin()` is one function
behind 36 policies and is deliberately ungated (no self-lockout).

Verified: an anonymous request with the public `anon` key returns `[]`.
`case-photos` bucket is private. Privileged operations go through
`admin-actions`, which re-checks `profiles.role='admin'` server-side.

**Tenancy for Noor is therefore already enforced below the API: if Noor's tools
query PostgREST *as the calling user* (forwarding their JWT), RLS does the
authorisation and the model never decides visibility.** Scheduled roles have no
user; they must run with the service role and scope explicitly by `lab_id`.

## 4. Event and notification infrastructure

- `cases_notify_webhook` — **AFTER INSERT OR UPDATE** on `cases` → POST
  `{type, table, record, old_record}` to `case-notify` with `x-webhook-secret`.
  This is the event stream Noor needs: submission = INSERT; stage change = UPDATE
  with `old_record.stage_index ≠ record.stage_index`. Today `case-notify` acts on
  INSERT (email the lab) and on crossing `WORK_COMPLETE` (email the clinic).
- `notify_invite_webhook` — same poster for `clinic_invitations` / `lab_members` inserts.
- Recipients are **organisation-level**: lab → `notify_email || email`; clinic → `clinics.email`. There is no per-user recipient or per-user language.
- Email policy already in force: subjects carry the case ID, never the patient name.
- Other channels: WhatsApp is **client-side click-to-chat only** (`src/lib/whatsapp.js`, `src/ContactLab.jsx` — `buildCaseContext()` composes a structured case header; a good precedent for the escalation context log). No SMS, no web push, no in-app inbox or chat.
- Offline writes: `src/lib/outbox.js` queues mutations in localStorage and replays them.

## 5. Turnaround and due dates (better than the brief assumed)

Benchmarks per restoration type **exist**: `labs.procedure_tats[category]`, falling
back to `labs.tat`. At submit the form computes
`effTat = max(procTat(r.category) for r in restorations)` (appliance mode: `procTat(category)`)
and stores `prescription.estReady = today + effTat`.

So every case carries two dates:
- **`prescription.estReady`** — the lab's promise, per restoration benchmark.
- **`appointment_date`** — the clinic's need-by date.

What does **not** exist: a per-stage split of the benchmark (when a case should
have been *picked up*, *started*, *completed*). Gap G5.

## 6. Existing scheduled jobs (`pg_cron`)

| Job | Schedule (UTC) | Target |
|---|---|---|
| `payment-reminders-monthly` | `0 6 25 * *` | `private.run_payment_reminders()` → `payment-reminders` |
| `error-alerts-hourly` | `5 * * * *` | `private.send_error_alert()` → hourly digest email |
| `rx-drafts-cleanup` | `30 21 * * *` (01:30 Muscat) | janitor |

Timezone is implicit (comments assume Asia/Muscat, UTC+4); nothing stores one.

## 7. Secrets and config

Edge env: `RESEND_API_KEY`, `OTP_FROM_EMAIL`, `CASE_NOTIFY_SECRET`,
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
DB: `private.webhook_config` (`case_notify_secret`, `resend_api_key`).
Local ops scripts read the service key from the macOS Keychain. **No LLM
provider key exists anywhere** — Noor would be the first LLM integration.

## 8. Language

The UI is English-only. No i18n library, no string catalogue, no `dir="rtl"`
handling; Arabic appears only as font fallbacks in print CSS. Nothing records a
user's or organisation's language. Gap G3.

## 9. Gaps that must be filled before Noor can work

| # | Gap | Proposed default (confirm or override) |
|---|---|---|
| G1 | No "needs clarification" state | New table `case_clarifications` (case_id, question, asked_at, answer, answered_at, status `open\|answered\|expired`). Not a new stage — stages are load-bearing for RLS, email and print. UI shows an open clarification as a banner on the case. |
| G2 | Remake rounds have no structured reason | Add nullable `reason_class` + `reason_code` to `case_rounds`, reusing `REMAKE_REASONS`. Remake Spotter reads both `cases.remake` and remake rounds. |
| G3 | No language preference | `profiles.language` (`en\|ar`, default `en`) for chat replies; `labs.language` and `clinics.language` for org-level emails, since recipients are org-level. |
| G4 | No timezone | `labs.timezone` text default `Asia/Muscat`. |
| G5 | No per-stage benchmark | Defaults as fractions of `effTat`: picked up ≤ 1 day after submit; in progress ≤ 2 days; complete ≤ `estReady`; received ≤ `appointment_date`. Per-lab override later. |
| G6 | No escalation target | `labs.escalation_user_id` (default `owner_id`, else first `lab_admin`); clinics: `owner_id`, else first `clinic_members.role='admin'`. |
| G7 | No agent audit | New `agent_runs` + `agent_tool_calls` tables (trace id, trigger, tenant, user, case, model, token counts, redacted inputs/outputs, outcome). Do **not** overload `login_events` (300-char detail, no structure). |
| G8 | No flags | New `case_flags` (case_id, kind `at_risk\|overdue\|stale\|needs_clarification`, reason, `visible_to` `lab\|clinic\|both`, created_by, resolved_at). |
| G9 | No kill switch | `feature_flags` table (`key, enabled, tenant_ids`) + `labs.noor_enabled` following the `payment_reminders_enabled` precedent. Checked at the entry of every trigger. |
| G10 | `case_notes.author_role` CHECK excludes an agent | Widen to `('dentist','lab','agent')`; Noor writes with `author_name='Noor'`. |
| G11 | No chat surface | "Ask Noor" panel in the case drawer and a question box on the lab dashboard. Request/response, no streaming, in v1. |
| G12 | No CI | Add `.github/workflows/noor-evals.yml` running the SQL tests (Postgres service) and the eval harness. |
| G13 | No escalation inbox | New `escalations` table + list view for lab admins / super-admin; email to the named manager. |
| G14 | Per-manager delivery | v1 briefs and escalations go to `labs.notify_email || email`; per-user delivery when G3/G6 land. |

## 10. Open questions (with the default I will use unless told otherwise)

1. **LLM provider.** None exists. Default: Anthropic Claude via `fetch` from a Deno Edge Function; `claude-sonnet-5` for the Case Answerer, `claude-haiku-4-5` for phrasing-only tasks. Requires a DPA/compliance sign-off for case data leaving the platform (see 02 §Threat model).
2. **Stale threshold** for the Escalator. Default: no history entry and no note for **5 calendar days** while `stage_index` ∈ {1,2}.
3. **Clarification timeout.** Default: an unanswered question re-nudges once at 24 h and escalates at 72 h.
4. **Who is "the lab manager".** Default: G6 above.
5. **Briefing time.** Default 07:30 in `labs.timezone`.
6. **Remake pattern thresholds.** Default: ≥ 3 remakes with the same `reason_code` for one clinic–lab pair in 90 days, or a clinic remake rate ≥ 2× the lab's median over ≥ 10 cases.
7. **Shadow-mode duration.** Default: 2 weeks or 200 agent runs, whichever is later.
