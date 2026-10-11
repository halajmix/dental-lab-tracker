import type { CaseRow, CaseSummary, ToolContext } from "../lib/types.ts";
import { STAGES, stageIndexOf } from "../lib/types.ts";
import { toCaseSummary } from "../lib/redact.ts";
import {pilotSummary} from '../pilot.ts';

export interface ListInput { stage?: string[]; due_from?: string; due_to?: string; due_field?: "promise_date" | "need_by_date"; flag_kind?: string; has_open_clarification?: boolean; search?: string; limit?: number; cursor?: string }

export async function listCases(input: ListInput, ctx: ToolContext): Promise<{ items: CaseSummary[]; next_cursor: string | null; total: number }> {
  const db = ctx.caller.kind === "system" ? ctx.admin : ctx.db;
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  let q = db.from("cases").select("*", { count: "exact" }).neq("cancel_status","cancelled").order("created_at", { ascending: false }).order("id");
  if (ctx.caller.kind === "system" && ctx.caller.jobLabId) q = q.eq("lab_id", ctx.caller.jobLabId);
  if (input.stage?.length) q = q.in("stage_index", [...new Set([...input.stage,...(input.stage.some(s=>["WORK_IN_PROGRESS","WORK_COMPLETE"].includes(s))?["CLINIC_RECEIVED"]:[])].map((s) => stageIndexOf(s as typeof STAGES[number])).filter((n) => n >= 0))]);
  if (input.due_field !== "promise_date") {
    if (input.due_from) q = q.gte("appointment_date", input.due_from);
    if (input.due_to) q = q.lte("appointment_date", input.due_to);
  }
  if (input.search) {
    const s = input.search.replace(/[%,]/g, "").slice(0, 40);
    q = q.or(`id.ilike.%${s}%,patient_id.ilike.%${s}%`);
  }
  const offset = input.cursor ? Number(input.cursor) || 0 : 0;
  const { data, error, count } = await q.range(offset, offset + limit - 1);
  if (error) throw new Error(`list_cases: ${error.message}`);
  let rows = (data ?? []) as CaseRow[];
  const ids = rows.map((r) => r.id);
  const [flags, clars, orgs, rounds] = await Promise.all([
    ids.length ? ctx.admin.from("case_flags").select("case_id,kind,reason,visible_to").in("case_id", ids).is("resolved_at", null) : Promise.resolve({ data: [] }),
    ids.length ? ctx.admin.from("case_clarifications").select("case_id,question,asked_at").in("case_id", ids).eq("status", "open") : Promise.resolve({ data: [] }),
    Promise.all([ctx.admin.from("clinics").select("id,name"), ctx.admin.from("labs").select("id,name")]),
    ids.length?ctx.admin.from("case_rounds").select("parent_case_id,kind,created_at,instructions").in("parent_case_id",ids).eq("status","open"):Promise.resolve({data:[]}),
  ]);
  if(flags.error||clars.error||rounds.error) throw new Error("Case details could not be read");
  if(input.stage && !input.stage.includes("CLINIC_RECEIVED")) rows=rows.filter(r=>r.stage_index<4||(rounds.data??[]).some((x:any)=>x.parent_case_id===r.id));
  const clinicName = new Map<string,string>((orgs[0].data ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));
  const labName = new Map<string,string>((orgs[1].data ?? []).map((l: { id: string; name: string }) => [l.id, l.name]));
  const clinicSide = ctx.caller.kind === "user" && !!ctx.caller.clinicIds?.length && !ctx.caller.labId;
  let items = rows.map((r) => pilotSummary(r,toCaseSummary({
    row: r, clinicName: clinicName.get(r.clinic_id) ?? "—", labName: (r.lab_id && labName.get(r.lab_id)) || "—", includePatient: false,
    openRounds:(rounds.data??[]).filter((x:any)=>x.parent_case_id===r.id),
    openFlags: ((flags.data ?? []) as Array<{ case_id: string; kind: string; reason: string; visible_to: string }>).filter((f) => f.case_id === r.id && (!clinicSide || f.visible_to !== "lab")).map(({ kind, reason }) => ({ kind, reason })),
    openClarification: ((clars.data ?? []) as Array<{ case_id: string; question: string; asked_at: string }>).find((c) => c.case_id === r.id) ?? null,
  }),ctx.pilot,ctx.now));
  if(input.due_field==='promise_date') items=items.filter(c=>{const p=c.promise_date??'';return (!input.due_from||p>=input.due_from)&&(!input.due_to||p<=input.due_to);});
  if (input.flag_kind) items = items.filter((c) => c.open_flags.some((f) => f.kind === input.flag_kind));
  if (input.has_open_clarification !== undefined) items = items.filter((c) => (c.open_clarification !== null) === input.has_open_clarification);
  const total = count ?? items.length;
  return { items, next_cursor: offset + limit < total ? String(offset + limit) : null, total };
}
