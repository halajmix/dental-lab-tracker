import type { CaseRow, CaseSummary, ToolContext } from "../lib/types.ts";
import { toCaseSummary } from "../lib/redact.ts";
import { isClinicCaller } from "../authz.ts";

/** Loads a case and everything the summary needs, through the caller's RLS. */
export async function loadSummary(ctx: ToolContext, caseId: string, includePatient: boolean): Promise<{ row: CaseRow; summary: CaseSummary } | null> {
  const db = ctx.caller.kind === "system" ? ctx.admin : ctx.db;
  const q = db.from("cases").select("*").eq("id", caseId);
  const { data: row, error } = await (ctx.caller.kind === "system" && ctx.caller.jobLabId ? q.eq("lab_id", ctx.caller.jobLabId) : q).maybeSingle();
  if (error) throw new Error(`get_case: ${error.message}`);
  if (!row) return null;
  const r = row as CaseRow;
  const [clinic, lab, rounds, flags, clar] = await Promise.all([
    ctx.admin.from("clinics").select("name").eq("id", r.clinic_id).maybeSingle(),
    r.lab_id ? ctx.admin.from("labs").select("name").eq("id", r.lab_id).maybeSingle() : Promise.resolve({ data: null }),
    ctx.admin.from("case_rounds").select("kind,created_at,instructions").eq("parent_case_id", r.id).eq("status", "open"),
    ctx.admin.from("case_flags").select("kind,reason,visible_to").eq("case_id", r.id).is("resolved_at", null),
    ctx.admin.from("case_clarifications").select("question,asked_at").eq("case_id", r.id).eq("status", "open").maybeSingle(),
  ]);
  const clinicSide = isClinicCaller(ctx.caller, r);
  const visibleFlags = ((flags.data ?? []) as Array<{ kind: string; reason: string; visible_to: string }>)
    .filter((f) => !clinicSide || f.visible_to !== "lab");
  const summary = toCaseSummary({
    row: r, clinicName: clinic.data?.name ?? "—", labName: lab.data?.name ?? "—",
    includePatient: includePatient && clinicSide,
    openRounds: rounds.data ?? [], openFlags: visibleFlags.map(({ kind, reason }) => ({ kind, reason })),
    openClarification: clar.data ?? null,
  });
  return { row: r, summary };
}

export async function getCase(input: { case_id: string; include_patient?: boolean }, ctx: ToolContext): Promise<CaseSummary | null> {
  const res = await loadSummary(ctx, input.case_id, !!input.include_patient);
  return res?.summary ?? null;
}
