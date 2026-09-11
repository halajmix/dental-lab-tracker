import type { CaseSummary } from "./types.ts";
import type { BriefSections } from "./templates.ts";

/* Compose the daily brief from already-fetched summaries. Pure code. */
export interface BriefInput {
  today: string;                    // YYYY-MM-DD in the lab's timezone
  openCases: CaseSummary[];         // stage < CLINIC_RECEIVED
  openEscalations: Array<{ case_id: string | null; category: string }>;
  cancellationRequests: string[];   // case ids with cancel_status='requested'
}
export function composeBrief(i: BriefInput): BriefSections {
  const due_today = i.openCases.filter((c) => c.need_by_date === i.today || c.promise_date === i.today);
  const overdue = i.openCases.filter((c) => c.open_flags.some((f) => f.kind === "overdue") || (c.need_by_date !== null && c.need_by_date < i.today && c.stage !== "WORK_COMPLETE"));
  const awaiting_clarification = i.openCases.filter((c) => c.open_clarification !== null);
  const needs_decision: BriefSections["needs_decision"] = [];
  for (const e of i.openEscalations) needs_decision.push({ case_id: e.case_id ?? "—", what: `open escalation (${e.category.replace(/_/g, " ")})` });
  for (const c of i.openCases) for (const r of c.open_rounds) if (r.kind === "remake") needs_decision.push({ case_id: c.case_id, what: "open remake round" });
  for (const id of i.cancellationRequests) needs_decision.push({ case_id: id, what: "cancellation requested" });
  const dedupe = (xs: CaseSummary[]) => [...new Map(xs.map((c) => [c.case_id, c])).values()];
  return { due_today: dedupe(due_today), overdue: dedupe(overdue).filter((c) => !due_today.includes(c)), awaiting_clarification: dedupe(awaiting_clarification), needs_decision };
}
export const briefIsEmpty = (s: BriefSections): boolean =>
  !s.due_today.length && !s.overdue.length && !s.awaiting_clarification.length && !s.needs_decision.length;

/** Local calendar date and hour for a timezone, without a date library. */
export function localParts(now: Date, timezone: string): { date: string; hour: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
}
