# 04 — Interaction examples

Three end-to-end transcripts. Context blocks are abbreviated to the fields the
model actually receives. All names, ids and dates are fictional.

---

## Example 1 — Intake Checker: zirconia crown with no shade, dentist answers in Arabic

**Trigger** `prescription_submitted` · webhook INSERT on `cases` · `C-MTZ4Q7K2AA`

**Runner (code, no model yet)** — `validate_prescription("C-MTZ4Q7K2AA")` →
```json
{ "issues": [
  { "field": "shade", "restoration_index": 0, "severity": "blocking",
    "detail": "Crown - implant, Zirconia, tooth 24: shade_guide 'Vita Classical' set but shade is empty" }
] }
```
Issues non-empty → model invoked.

**Context assembled**
```
caller: role=system trigger=prescription_submitted
recipient_language: ar        (clinics.language for Al Noor Dental Clinic)
<data>
case_id: C-MTZ4Q7K2AA   stage: STILL_AT_CLINIC   promise_date: 2026-09-16   need_by_date: 2026-09-18
restoration[0]: Crown - implant · Zirconia · Vita Classical · shade: (empty) · teeth: 24 (FDI)
issues: [ shade / blocking / …as above ]
</data>
```

**Model → tool call**
```json
{ "tool": "request_clarification", "input": {
  "case_id": "C-MTZ4Q7K2AA",
  "issue": { "field": "shade", "restoration_index": 0, "severity": "blocking", "detail": "…" },
  "language": "ar",
  "question": "الحالة C-MTZ4Q7K2AA: تاج الزركونيا على السن 24 مُسجَّل بدليل الألوان Vita Classical دون تحديد درجة اللون. يرجى تحديد الدرجة (مثال: A2)، أو اختيار «Shade by Lab» إذا كان المختبر سيحدّدها."
} }
```

**Tool result** `{ "clarification_id": "clr_8f1c", "asked_at": "2026-09-11T06:02:14Z" }`

**Side effects (by the tool, not the model):** `case_clarifications` row (open) ·
`case_flags(needs_clarification, visible_to=both)` · templated email to the
clinic in Arabic containing the question · case note `Noor: طُلب توضيح درجة اللون للسن 24`.

**Noor's final output** (to the runner; the dentist sees the email/banner):
```
تم طلب توضيح واحد من العيادة بشأن درجة اللون للسن 24. الحالة في انتظار الرد.
```

**Dentist replies** in the banner (`case_clarifications.answer`):
```
الدرجة A2 على دليل فيتا الكلاسيكي
```

**Trigger** `clarification_answered` → runner re-runs `validate_prescription`.
The tool reads the answer, matches "A2" against `Vita Classical` shades, and
because the prescription itself is locked after 30 minutes for the clinic and
never editable by the lab, the tool does **not** mutate the prescription; it
records the resolved value on the clarification row and adds a case note:
`Noor: درجة اللون للسن 24 مؤكَّدة من العيادة: Vita Classical A2`. Issues now
empty → model outputs `PASS`. Flag resolved. Lab sees the note on the card.

> Design note: whether an answered clarification should *write back* into
> `prescription` (which the guard trigger currently forbids for anyone but the
> clinic inside 30 min) is decision D3 in the summary.

---

## Example 2 — Status Messenger: same stage change, one clinic in English, one in Arabic

**Trigger** `stage_changed` · webhook UPDATE · `old_record.stage_index 2 → record.stage_index 3` (WORK_COMPLETE)

Two cases completed within the same minute by Smile World Dental Lab:
`C-MTZ5A1B9C1` for **Kenz Dental** (`clinics.language = en`) and
`C-MTZ5A1C0D2` for **Al Noor Dental Clinic** (`clinics.language = ar`).

**No model call.** The runner routes `stage_changed` straight to the template
path. For each case:

```
gate: noor.global=on · labs.noor_enabled=on · idempotency (C-…, 2→3) unused
get_case (service role, scoped)
send_status_update({ case_id, template_id: "work_complete" })   // language from clinics.language
```

**Template `work_complete` — en**, rendered from `get_case` only:
```
Subject: Case C-MTZ5A1B9C1 — work complete

Smile World Dental Lab has marked case C-MTZ5A1B9C1 complete.

Restoration: Crown - implant · Zirconia · Vita Classical A2 · tooth 24
Lab promise date: 16 Sep 2026
Your next appointment: 18 Sep 2026, Morning
Delivery: pick-up requested by the lab — 

Reply to this email to reach the lab directly.
— Noor, Case Coordinator, dr-crown.com (an AI assistant)
```

**Template `work_complete` — ar**:
```
الموضوع: الحالة C-MTZ5A1C0D2 — اكتمل العمل

أكمل مختبر Smile World Dental Lab العمل على الحالة C-MTZ5A1C0D2.

التعويض: Crown - implant · Zirconia · Vita Classical A2 · السن 24
موعد التسليم الذي التزم به المختبر: ١٦ سبتمبر ٢٠٢٦
موعد المريض التالي: ١٨ سبتمبر ٢٠٢٦، صباحًا
التسليم: —

يمكنكم الرد على هذه الرسالة للتواصل مع المختبر مباشرة.
— نور، منسّقة الحالات، dr-crown.com (مساعد ذكاء اصطناعي)
```

The `—` in the delivery slot is the fixed "no value" marker: a slot without
data is never filled with prose.

**Tool results** `{ sent: true, resend_id: "re_…" }` ×2 · `agent_runs` ×2 with
`outcome=completed`, `model=null`, `tokens=0`.

**Watcher re-check (same trigger):** stage 3 reached on 11 Sep vs promise 16 Sep
→ `per_stage[WORK_COMPLETE].status = done`; any earlier `at_risk` flag on
these cases is resolved.

---

## Example 3 — Escalator: stalled case routed to the lab manager

**Trigger** `scheduled_watch` (every 30 min) · lab **Smile World Dental Lab**

**Runner (code):** for `C-MTY9H3P0QX`, `stage = PICKED_UP_BY_LAB` since
2026-09-04 08:12; last `history` entry 2026-09-04; last `case_notes` entry none
since; today 2026-09-11 → **7 days without activity ≥ stale_days (5)** and
`need_by_date = 2026-09-12`. The watcher marks the case `stale` and, because
staleness is an escalation rule, asks the model to summarise the context log.

**Context assembled**
```
caller: role=system trigger=scheduled_watch lab=Smile World Dental Lab language=en
<data>
case_id: C-MTY9H3P0QX  stage: PICKED_UP_BY_LAB  stage_since: 2026-09-04T08:12Z
promise_date: 2026-09-09   need_by_date: 2026-09-12
restoration[0]: Bridge - tooth (conventional) · PFM · Vita Classical A3 · teeth 14, 15 (pontic), 16
history: [2026-09-02 advance→STILL_AT_CLINIC by dentist, 2026-09-04 advance→PICKED_UP_BY_LAB by lab]
open_rounds: []   open_flags: [at_risk: "promise date 09 Sep passed at Picked Up"]
open_clarification: null
</data>
```

**Model → tool call**
```json
{ "tool": "escalate_to_human", "input": {
  "case_id": "C-MTY9H3P0QX",
  "category": "stale_case",
  "language": "en",
  "summary": "Case C-MTY9H3P0QX has been at Picked Up by Lab for 7 days with no stage change, note or follow-up. The lab's promise date (9 Sep) has passed and the clinic's next appointment is tomorrow, 12 Sep.",
  "context": {
    "stage": "PICKED_UP_BY_LAB",
    "timeline": [
      "02 Sep — submitted by Kenz Dental (dentist)",
      "04 Sep 08:12 — picked up by lab",
      "09 Sep — promise date passed (flagged at_risk)",
      "11 Sep — no activity for 7 days (stale threshold 5)"
    ],
    "parties": ["clinic", "lab"],
    "attempted": ["get_case", "get_turnaround_benchmark", "flag_case_risk"],
    "stop_reason": "Stale ≥ 5 days with need-by date tomorrow; requires a human decision on scheduling or contacting the clinic."
  }
} }
```

**Tool result** `{ "escalation_id": "esc_2b7e", "assigned_to_name": "Tony Hannoun" }`
(resolved by rule G6: `labs.escalation_user_id` unset → `owner_id`).

**Side effects:** `escalations` row · email to the manager with the log above ·
case note `Noor: escalated to Tony Hannoun (esc_2b7e) — stale 7 days, need-by 12 Sep` ·
flag `stale` visible to **lab only** (the clinic is not told the lab is stalled;
it sees `overdue` only once the watcher confirms it against `need_by_date`).

**Noor's final output** (to the run log; nobody is chatting):
```
Escalated C-MTY9H3P0QX to Tony Hannoun (esc_2b7e).
```

**What the manager receives**
```
Subject: Escalation esc_2b7e — case C-MTY9H3P0QX stalled

Case C-MTY9H3P0QX (Kenz Dental → Smile World Dental Lab)
Stage: Picked Up by Lab since 04 Sep · promise 09 Sep · clinic's next appointment 12 Sep

Timeline
  02 Sep — submitted by Kenz Dental (dentist)
  04 Sep 08:12 — picked up by lab
  09 Sep — promise date passed (flagged at_risk)
  11 Sep — no activity for 7 days (stale threshold 5)

What Noor did: get_case, get_turnaround_benchmark, flag_case_risk
Why it stopped: stale ≥ 5 days with need-by date tomorrow; requires a human decision.

Open the case: https://dr-crown.com/  (case C-MTY9H3P0QX)
— Noor (an AI assistant). Reply-to reaches dr-crown support.
```
