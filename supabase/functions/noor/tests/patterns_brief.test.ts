import { test } from "node:test";
import assert from "node:assert/strict";
import { detectPatterns, observationText } from "../lib/patterns.ts";
import { composeBrief, briefIsEmpty, localParts } from "../lib/brief.ts";
import type { CaseSummary } from "../lib/types.ts";

const rec = (clinic: string, code: string, n: number) => Array.from({ length: n }, (_, i) => ({ clinic_id: clinic, clinic_name: clinic, reason_class: "laboratory" as const, reason_code: code, created_at: `2026-08-${String(10 + i).padStart(2, "0")}` }));

test("5.4 four shade mismatches in 90 days → pattern; wording is neutral", () => {
  const p = detectPatterns([...rec("X", "shade_mismatch", 4), ...rec("Y", "other", 1)], [{ clinic_id: "X", cases_in_period: 20 }, { clinic_id: "Y", cases_in_period: 20 }]);
  assert.equal(p.length, 1); assert.equal(p[0].count, 4); assert.equal(p[0].reason_code, "shade_mismatch");
  const t = observationText(p[0], 90, "en"); assert.match(t, /4 remakes/); assert.doesNotMatch(t, /fault|blame|error by|negligen/i);
});
test("5.6 below threshold → nothing", () => { assert.deepEqual(detectPatterns(rec("X", "shade_mismatch", 2), [{ clinic_id: "X", cases_in_period: 20 }]), []); });
test("rate trigger: 2× the lab median over ≥10 cases", () => {
  // A: 4 remakes across two codes (neither reaches 3) on 10 cases = 0.4; B and C: 0.1 each → median 0.1, A ≥ 2× median.
  const p = detectPatterns([...rec("A", "porcelain_fracture", 2), ...rec("A", "proximal_contacts", 2), ...rec("B", "other", 1), ...rec("C", "other", 1)],
    [{ clinic_id: "A", cases_in_period: 10 }, { clinic_id: "B", cases_in_period: 10 }, { clinic_id: "C", cases_in_period: 10 }]);
  assert.ok(p.some((x) => x.clinic_name === "A" && x.trigger === "rate"), JSON.stringify(p));
});

const cs = (id: string, o: Partial<CaseSummary> = {}): CaseSummary => ({ case_id: id, stage: "WORK_IN_PROGRESS", clinic_name: "K", lab_name: "L", created_date: "2026-09-01", promise_date: null, need_by_date: null, restorations: [], files: [], history: [], open_rounds: [], open_flags: [], open_clarification: null, cancel_status: "none", ...o });
test("6.1 brief sections, dedupe, decisions", () => {
  const s = composeBrief({ today: "2026-09-11", openCases: [cs("A", { need_by_date: "2026-09-11" }), cs("B", { need_by_date: "2026-09-01" }), cs("C", { open_clarification: { question: "?", asked_at: "x" } }), cs("D", { open_rounds: [{ kind: "remake", created_at: "x", instructions: "" }] })], openEscalations: [{ case_id: "E", category: "fee_dispute" }], cancellationRequests: ["F"] });
  assert.deepEqual(s.due_today.map((c) => c.case_id), ["A"]); assert.deepEqual(s.overdue.map((c) => c.case_id), ["B"]);
  assert.deepEqual(s.awaiting_clarification.map((c) => c.case_id), ["C"]); assert.equal(s.needs_decision.length, 3);
});
test("6.4 empty brief detected", () => { assert.equal(briefIsEmpty(composeBrief({ today: "2026-09-11", openCases: [], openEscalations: [], cancellationRequests: [] })), true); });
test("local hour in Asia/Muscat (UTC+4)", () => { const p = localParts(new Date("2026-09-11T03:30:00Z"), "Asia/Muscat"); assert.equal(p.hour, 7); assert.equal(p.date, "2026-09-11"); });
