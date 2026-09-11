# 06 — Rollout plan

Four phases, each gated on measured numbers, each reversible in under a
minute. Migrations are additive only; the kill switch is checked before any
work; nothing Noor writes is ever a mutation of an existing business field.

## Phase 0 — prerequisites (before shadow)

- Migration applied (additive): `case_clarifications`, `case_flags`,
  `escalations`, `agent_runs`, `agent_tool_calls`, `feature_flags`;
  `labs.noor_enabled` (default **false**), `labs.language`, `labs.timezone`,
  `labs.escalation_user_id`, `clinics.language`, `profiles.language`,
  `case_rounds.reason_class/reason_code`, `case_notes.author_role` widened.
- `noor` Edge Function deployed, `noor.global = off`.
- LLM provider key stored as an Edge secret; DPA signed; the "what leaves the
  platform" table in 02 signed off by the owner.
- Eval suite green 3/3 on all 60 scenarios.
- SQL tests for the new tables' RLS green.

## Phase 1 — shadow mode

`noor.global = on`, `noor_enabled = true` for all labs, **`NOOR_SHADOW = true`**:
every trigger runs, every tool executes its *read* path, every would-be write
(flag, clarification, email, escalation, note) is recorded in `agent_runs`
as `would_have: {...}` and **nothing is sent or written**.

Duration: the later of 2 weeks or 200 runs.

Gate metrics (from `agent_runs` + a weekly manual review of 30 sampled runs):
| Metric | Target |
|---|---|
| Clarification precision — of would-be questions, share a reviewer agrees were needed | ≥ 90 % |
| False-flag rate — `at_risk`/`overdue` flags a reviewer disagrees with | ≤ 5 % |
| Status-update correctness — template slot values match the case | 100 % |
| Answerer accuracy on the 30-run sample | ≥ 95 %, zero cross-tenant rows (must be 0) |
| Escalation precision — would-be escalations a manager would want | ≥ 80 % |
| Arabic فصحى sample (20 outputs) | 0 dialect, 0 mistranslated terms |
| Cost per run, p95 latency | within budget set in Phase 0 |

## Phase 2 — internal pilot: one lab

Smile World Dental Lab (the owner's lab) with `NOOR_SHADOW = false` for that
`lab_id` only. Roles enabled in order, one per few days: 3 (Status Messenger,
templated) → 6 (Brief) → 2 (Watcher, lab-visible flags only) → 1 (Intake) →
4 (Answerer, lab users only) → 5 (Spotter) → 7 (Escalator).

Gate: 2 weeks, plus
| Metric | Target |
|---|---|
| On-time notification rate (status email within 5 min of the stage change) | ≥ 99 % |
| Duplicate sends | 0 |
| User-reported errors (a "wrong" button on every Noor message and a support address) | ≤ 2, none cross-tenant |
| Clarification loop — cases needing a second question | ≤ 10 % |
| Manager rates the brief "useful" ≥ 4/5 for 5 consecutive days | yes |

## Phase 3 — limited pilot: selected clinics

Two or three clinics that send to the pilot lab opt in
(`clinics.language` set, consent recorded). Clinic-facing roles switch on:
overdue flags visible to the clinic, clarification requests to dentists,
Answerer for clinic users.

Gate: 3 weeks, same metrics plus
| Metric | Target |
|---|---|
| Dentist answers a clarification within 24 h | ≥ 70 % |
| Clinic complaints about tone or language | 0 |
| Escalations resolved by the manager within 1 business day | ≥ 80 % |

## Phase 4 — general availability

`noor_enabled` defaults to **true** for new labs; existing labs enabled one
by one with a notice email; clinics opt in via a setting. Weekly eval run in
CI continues; the shadow-mode review sampling drops to 10 runs per week.

## Rollback

| Situation | Action | Time |
|---|---|---|
| Any cross-tenant disclosure, however small | `noor.global = off`; export the run; notify the owner | < 1 min |
| Wrong or duplicate emails | `noor.global = off`, or per-lab `noor_enabled = false` | < 1 min |
| Cost breach | automatic: spend cap flips `noor.global = off` and alerts | automatic |
| Provider outage | runs fail closed with the fixed sentence; no fabrication; watcher/brief resume next tick | none needed |
| Bad release | redeploy the previous `noor` function; the app is unaffected | < 5 min |

Because every table Noor writes is new and every column added is nullable or
defaulted, rolling back the *schema* is never required to stop the feature:
switching the flag off leaves the platform exactly as it was before Phase 0.
