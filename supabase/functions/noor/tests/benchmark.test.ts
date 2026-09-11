import { test } from "node:test";
import assert from "node:assert/strict";
import { benchmark } from "../lib/benchmark.ts";

const row = (o: Record<string, unknown> = {}) => ({ id: "C-T", created_date: "2026-09-01", created_at: "2026-09-01T08:00:00Z", appointment_date: "2026-09-12", stage_index: 1,
  prescription: { estReady: "2026-09-09", restorations: [{ category: "Crown - tooth" }] }, history: [{ at: "2026-09-02T08:00:00Z", action: "advance", toStage: 1 }], ...o });
const base = { procedureTats: { "Crown - tooth": 5 }, labTat: 5, lastActivityAt: "2026-09-02T08:00:00Z", staleDays: 5 };

test("2.1 picked up 3 days, benchmark 1 day → overdue for in-progress", () => {
  const b = benchmark({ row: row() as never, ...base, now: new Date("2026-09-04T10:00:00Z") });
  assert.equal(b.per_stage[2].stage, "WORK_IN_PROGRESS"); assert.equal(b.per_stage[2].status, "overdue"); assert.equal(b.overdue_confirmed, false);
});
test("2.2 promise date passed at WIP → overdue, lab-only", () => {
  const b = benchmark({ row: row({ stage_index: 2 }) as never, ...base, now: new Date("2026-09-10T10:00:00Z") });
  assert.equal(b.verdict, "overdue"); assert.equal(b.overdue_confirmed, false);
});
test("2.3 need-by passed and not complete → confirmed (clinic-visible)", () => {
  const b = benchmark({ row: row({ stage_index: 2 }) as never, ...base, now: new Date("2026-09-13T10:00:00Z") });
  assert.equal(b.overdue_confirmed, true);
});
test("2.4 complete before promise → done, nothing to flag", () => {
  const b = benchmark({ row: row({ stage_index: 3 }) as never, ...base, now: new Date("2026-09-05T10:00:00Z") });
  assert.equal(b.per_stage[3].status, "done"); assert.notEqual(b.verdict, "overdue");
});
test("2.5 no procedure_tats → lab default source", () => {
  const b = benchmark({ row: row({ prescription: { restorations: [{ category: "Crown - tooth" }] } }) as never, ...base, procedureTats: {}, now: new Date("2026-09-03T10:00:00Z") });
  assert.equal(b.source, "lab_default"); assert.equal(b.effective_tat_days, 5);
});
test("stale: 7 idle days at picked-up", () => {
  const b = benchmark({ row: row() as never, ...base, now: new Date("2026-09-09T10:00:00Z") });
  assert.equal(b.stale, true); assert.equal(b.days_idle, 7);
});
test("not stale once work complete", () => {
  const b = benchmark({ row: row({ stage_index: 3 }) as never, ...base, now: new Date("2026-09-30T10:00:00Z") });
  assert.equal(b.stale, false);
});
