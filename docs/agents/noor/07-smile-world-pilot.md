# Smile World internal pilot — 11 October 2026

The owner authorized activating Noor for Smile World before releasing it to
other clinics or labs. This supersedes the old September shadow review date
and email-first activation order in the original rollout plan.

Live: lab questions, case monitoring, the in-app brief, internal escalation
inbox and pattern observations. Intake, clarification and remake automation
remain observing. Clinic accounts cannot ask Noor, and no other lab is enabled.
The 13 October update in [08-prescription-assistant-and-budget.md](08-prescription-assistant-and-budget.md) adds doctor voice/typed prescription assistance for Smile World and a shared $15 monthly cap. The clinic-chat restriction below refers to general lab questions.

Noor sends no emails. Completion messages belong to case-notify. Internal
escalations do not create clinic-visible case notes. Active escalations are
unique per case/category, including concurrent monitoring runs.

Turnaround is six calendar days for all Smile World clinics except Health
Center, which gets thirteen. Calendar days follow the existing prescription
form's date calculation. New prescriptions use these rules. Monitoring does
not treat stored five-day defaults or assumed intermediate stage SLAs as
promised completion deadlines. A later explicit promise is retained. Returned
work restarts its clock at the newest open round, even after Clinic Received.
An old appointment on completed, returned work is not a new-round deadline.
Appointments on unfinished original work remain visible as separate needs.
Stalled work is flagged after five days without human activity; Noor's own
notes cannot reset that clock.

Both AI purposes use Haiku 4.5. The default daily pilot cap is $2, enforced
atomically before every provider request. Reservations bound maximum input and
output costs; actual usage includes ordinary tokens and cache reads/writes.
Unknown failures retain a reservation rather than assuming the attempt was
free. A paused budget blocks AI questions until the next Oman calendar day;
deterministic monitoring continues. No SDK retries. The displayed cost is an
estimate from API usage, not a reconciliation of the provider's invoice.
Rates checked against https://platform.claude.com/docs/en/about-claude/pricing.

The live test uncovered a rejected strict-tool schema (`minimum` on an integer).
The provider receives a compatible schema copy; our backend validates original
numeric/string bounds before running tools. Compatibility reference:
https://platform.claude.com/docs/en/build-with-claude/structured-outputs.
The full conversational tool set initially exceeded the old 45-second
timeout. Conversational tools use normal generation with full server validation;
single-tool phrasing retains strict generation. Provider timeout is 90 seconds,
with one attempt and reserved cost. The brief tool selects lab scope on the
server, rather than asking the model to guess an internal lab UUID.

Validation: 54 runtime tests, nine UI tests, schema/prompt consistency,
production build, Deno type check, database migration replay plus budget/rate/
privilege/concurrency checks. Three real-provider synthetic scenarios passed:
missing prescription detail, inaccessible case, and fee dispute escalation.
Live probes reject unsigned calls, wrong secrets, forged webhooks, other-lab
case IDs and user access to budget RPCs. A real case write under the owner's
RLS was verified inside a rolled-back transaction, without changing a record.

Use the lab Production Queue's Ask Noor panel. It shows active/observing
status, latest check, estimated daily AI usage and remaining daily cap. Each
answer has Helpful and Something is wrong feedback. Lab Admin → Escalations
shows human decisions. Refresh the app after deployment to load updated UI.

Before wider rollout, review real pilot answers and alerts with lab staff,
check the feedback and latency, and resolve recurring failures. No automatic
clinic rollout date or recurring monitor was scheduled by this change.
