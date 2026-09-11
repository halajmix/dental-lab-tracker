import type { CaseRow, Stage, StageStatus } from "./types.ts";
import { STAGES, stageOf } from "./types.ts";

/* Timeline benchmark. Pure code; the model never decides lateness.
   Per-stage expectations (G5 defaults): picked up ≤ created+1d; in progress
   ≤ created+2d; complete ≤ promise date (estReady, else created+effTat);
   received ≤ next appointment. */

export interface BenchmarkInput {
  row: Pick<CaseRow, "id" | "created_date" | "created_at" | "appointment_date" | "stage_index" | "prescription" | "history">;
  procedureTats: Record<string, number>;
  labTat: number;
  lastActivityAt: string | null;     // newest of history[].at, case_notes.created_at, case_rounds.created_at
  now: Date;
  staleDays: number;
  atRiskWindowDays?: number;         // default 1
}
export interface StageExpectation { stage: Stage; expected_by: string; status: StageStatus }
export interface BenchmarkResult {
  effective_tat_days: number;
  promise_date: string | null;
  source: "procedure_tats" | "lab_default" | "none";
  per_stage: StageExpectation[];
  verdict: "on_track" | "at_risk" | "overdue" | "done";
  overdue_confirmed: boolean;        // need-by date passed and work not complete → clinic-visible
  days_over: number;
  stale: boolean;
  days_idle: number;
}

const DAY = 86400000;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => isoDate(new Date(new Date(iso + "T00:00:00Z").getTime() + n * DAY));
const daysBetween = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / DAY);

export function effectiveTat(rx: CaseRow["prescription"], procedureTats: Record<string, number>, labTat: number): { days: number; source: BenchmarkResult["source"] } {
  const cats = rx?.restorations?.length ? rx.restorations.map((r) => r.category ?? "") : rx?.category ? [rx.category] : [];
  const fromProc = cats.map((c) => Number(procedureTats?.[c]) || 0).filter((n) => n > 0);
  if (fromProc.length) return { days: Math.max(...fromProc), source: "procedure_tats" };
  if (labTat > 0) return { days: labTat, source: "lab_default" };
  return { days: 0, source: "none" };
}

export function benchmark(i: BenchmarkInput): BenchmarkResult {
  const created = i.row.created_date;
  const { days: tat, source } = effectiveTat(i.row.prescription, i.procedureTats, i.labTat);
  const promise = i.row.prescription?.estReady ?? (source === "none" ? null : addDays(created, tat));
  const today = isoDate(i.now);
  const window = i.atRiskWindowDays ?? 1;
  const expected: Record<Stage, string | null> = {
    STILL_AT_CLINIC: created,
    PICKED_UP_BY_LAB: addDays(created, 1),
    WORK_IN_PROGRESS: addDays(created, 2),
    WORK_COMPLETE: promise,
    CLINIC_RECEIVED: i.row.appointment_date ?? promise,
  };
  const per_stage: StageExpectation[] = STAGES.map((s, idx) => {
    const exp = expected[s] ?? today;
    let status: StageStatus;
    if (i.row.stage_index >= idx) status = "done";
    else if (today > exp) status = "overdue";
    else if (daysBetween(new Date(exp + "T00:00:00Z"), new Date(today + "T00:00:00Z")) <= window) status = "at_risk";
    else status = "on_track";
    return { stage: s, expected_by: exp, status };
  });
  // The verdict is about the LAB's work. Stages 0 and 4 belong to the dentist
  // (submitting, collecting), so a finished case waiting for pick-up is "done"
  // here, never "overdue" — that would flag the lab for the clinic's delay.
  const next = per_stage.find((p, idx) => p.status !== "done" && idx >= 1 && idx <= 3);
  const verdict: BenchmarkResult["verdict"] = !next ? "done" : next.status === "on_track" ? "on_track" : next.status;
  const needBy = i.row.appointment_date;
  const overdue_confirmed = !!needBy && today > needBy && i.row.stage_index < 3;
  const days_over = next && next.status === "overdue" ? daysBetween(new Date(today + "T00:00:00Z"), new Date(next.expected_by + "T00:00:00Z")) : 0;
  const idleFrom = i.lastActivityAt ? new Date(i.lastActivityAt) : new Date((i.row.created_at ?? created + "T00:00:00Z"));
  const days_idle = daysBetween(i.now, idleFrom);
  const stale = i.row.stage_index >= 1 && i.row.stage_index <= 2 && days_idle >= i.staleDays;
  return { effective_tat_days: tat, promise_date: promise, source, per_stage, verdict, overdue_confirmed, days_over, stale, days_idle };
}

export const currentStage = (row: Pick<CaseRow, "stage_index">): Stage => stageOf(row.stage_index);
