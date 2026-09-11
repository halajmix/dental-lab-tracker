import { test } from "node:test";
import assert from "node:assert/strict";
import { renderStatus, renderBrief, renderEscalation, fmtDate } from "../lib/templates.ts";
import type { CaseSummary } from "../lib/types.ts";

const c: CaseSummary = { case_id: "C-MTZ5A1B9C1", stage: "WORK_COMPLETE", clinic_name: "Kenz Dental", lab_name: "Smile World Dental Lab", patient_ref: "PT-NEW", created_date: "2026-09-02", promise_date: "2026-09-16", need_by_date: "2026-09-18", delivery_time: "Morning",
  restorations: [{ category: "Crown - implant", material: "Zirconia", shade_guide: "Vita Classical", shade: "A2", teeth: ["24"], arches: null }], files: [], history: [], open_rounds: [], open_flags: [], open_clarification: null, cancel_status: "none" };
const DIALECT = /إن شاء الله|شو |وش |لا تشيل/;

test("3.1 English work_complete: subject has case id, never a patient name", () => {
  const r = renderStatus("work_complete", { ...c, patient_name: "Test Patient" }, "en");
  assert.match(r.subject, /C-MTZ5A1B9C1/); assert.doesNotMatch(r.subject, /Test Patient/); assert.doesNotMatch(r.text, /Test Patient/);
  assert.match(r.text, /16 Sep 2026/); assert.match(r.text, /an AI assistant/);
});
test("3.2 Arabic work_complete: فصحى, Zirconia kept, Arabic digits", () => {
  const r = renderStatus("work_complete", c, "ar");
  assert.match(r.text, /الحالة/); assert.match(r.text, /Zirconia/); assert.match(r.text, /١٦ سبتمبر ٢٠٢٦/); assert.doesNotMatch(r.text, DIALECT);
  assert.match(r.html, /dir="rtl"/);
});
test("3.6 missing slot renders as dash, never prose", () => {
  const r = renderStatus("picked_up", { ...c, delivery_time: undefined, promise_date: null }, "en");
  assert.match(r.text, /Lab promise date: —/); assert.match(r.text, /Delivery: —/);
});
test("brief: sections in fixed order, empty omitted, under 120 words", () => {
  const r = renderBrief("Smile World", "2026-09-11", { due_today: [c], overdue: [], awaiting_clarification: [], needs_decision: [{ case_id: "C-X", what: "open remake round" }] }, "en");
  assert.ok(r.text.indexOf("Due today") < r.text.indexOf("Needs a decision")); assert.doesNotMatch(r.text, /Overdue/);
  assert.ok(r.text.split(/\s+/).length < 120);
});
test("escalation email carries timeline, attempted tools, stop reason", () => {
  const r = renderEscalation("esc_2b7e", "C-MTY9H3P0QX", "stale_case", "Stalled.", { stage: "PICKED_UP_BY_LAB", timeline: ["02 Sep — submitted", "04 Sep — picked up"], parties: ["clinic", "lab"], attempted: ["get_case"], stop_reason: "stale" }, "en", "Case C-MTY9H3P0QX (Kenz → Smile World)");
  assert.match(r.subject, /esc_2b7e/); assert.match(r.text, /04 Sep — picked up/); assert.match(r.text, /What Noor did: get_case/); assert.match(r.text, /Why it stopped: stale/);
});
test("fmtDate both languages", () => { assert.equal(fmtDate("2026-09-05", "en"), "5 Sep 2026"); assert.equal(fmtDate("2026-09-05", "ar"), "٥ سبتمبر ٢٠٢٦"); assert.equal(fmtDate(null, "en"), "—"); });
