import type { CaseRow, Db, ToolContext } from "../lib/types.ts";
import { benchmark } from "../lib/benchmark.ts";
import { stageOf } from "../lib/types.ts";
import { flagCaseRisk, resolveFlag } from "../tools/flag_case_risk.ts";
import { activity } from "../tools/get_turnaround_benchmark.ts";
import { escalateToHuman } from "../tools/escalate_to_human.ts";
import { claimIdempotency } from "../gate.ts";
import { fmtDate } from "../lib/templates.ts";
import {pilotTat} from '../pilot.ts';

/* Timeline Watcher. Pure code end to end; no model call. */
export async function runWatch(admin: Db, makeCtx: (labId: string) => ToolContext, staleDays: number): Promise<{ labs: number; cases: number; flagged: number; escalated: number }> {
  const { data: labs,error:labError } = await admin.from("labs").select("id,name,tat,procedure_tats,language").eq("noor_enabled", true);
  if(labError) throw new Error("Watcher labs could not be read");
  let cases = 0, flagged = 0, escalated = 0;
  for (const lab of (labs ?? []) as Array<{ id: string; name: string; tat: number; procedure_tats: Record<string, number>; language: "en" | "ar" }>) {
    const ctx = makeCtx(lab.id);
    const returnedIds:string[]=[];
    for(let cursor=0;;cursor+=500) {
      const {data:rounds,error:roundError}=await admin.from('case_rounds').select('parent_case_id,cases!inner(lab_id)').eq('status','open').eq('cases.lab_id',lab.id).order('id').range(cursor,cursor+499);
      if(roundError) throw new Error('Returned cases could not be read');
      returnedIds.push(...(rounds??[]).map((r:any)=>r.parent_case_id));
      if((rounds??[]).length<500) break;
    }
    for(let offset=0;;offset+=200) {
    let query=admin.from('cases').select('*').eq('lab_id',lab.id).neq('cancel_status','cancelled');
    query=returnedIds.length?query.or(`stage_index.lt.4,id.in.(${[...new Set(returnedIds)].join(',')})`):query.lt('stage_index',4);
    const {data:open,error}=await query.order('id').range(offset,offset+199);
    if(error) throw new Error('Watcher cases could not be read');
    for (const row of (open ?? []) as CaseRow[]) {
      const { last, openRoundAt } = await activity(ctx, row.id, row.history);
      if(row.stage_index>=4&&!openRoundAt) continue;
      cases++;
      const b = benchmark({ row, minimumTatPromise:!!ctx.pilot, procedureTats: ctx.pilot?{}:lab.procedure_tats ?? {}, labTat: pilotTat(ctx.pilot??null,row.clinic_id,lab.tat??0), lastActivityAt: last, openRoundAt, now: ctx.now, staleDays });
      const next = ctx.pilot?b.per_stage.find(p=>p.stage==='WORK_COMPLETE'):b.per_stage.find((p) => p.status !== "done");
      if (b.verdict === "at_risk" && next) { await flagCaseRisk({ case_id: row.id, kind: "at_risk", reason: `${next.stage.replace(/_/g, " ").toLowerCase()} expected by ${fmtDate(next.expected_by, "en")}`, visible_to: "lab" }, ctx); flagged++; }
      else await resolveFlag(ctx, row.id, "at_risk");
      if (b.verdict === "overdue" && next) {
        await flagCaseRisk({ case_id: row.id, kind: "overdue", reason: `${next.stage.replace(/_/g, " ").toLowerCase()} was expected by ${fmtDate(next.expected_by, "en")} (${b.days_over} day${b.days_over === 1 ? "" : "s"} over)`, visible_to: ctx.labOnly?'lab':b.overdue_confirmed ? "both" : "lab", days_over: b.days_over }, ctx); flagged++;
      } else await resolveFlag(ctx, row.id, "overdue");
      if (b.stale) {
        await flagCaseRisk({ case_id: row.id, kind: "stale", reason: `no activity for ${b.days_idle} days at ${stageOf(row.stage_index).replace(/_/g, " ").toLowerCase()}`, visible_to: "lab" }, ctx);
        flagged++;
        const weekKey = `stale:${row.id}:${ctx.now.toISOString().slice(0, 10)}`;
        if (ctx.shadow || await claimIdempotency(admin, weekKey)) {
          const timeline = (row.history ?? []).map((h) => `${fmtDate(h.at.slice(0, 10), "en")} — ${h.label ?? h.action}${h.role ? ` (${h.role})` : ""}`);
          timeline.push(`${fmtDate(ctx.now.toISOString().slice(0, 10), "en")} — no activity for ${b.days_idle} days (stale threshold ${staleDays})`);
          await escalateToHuman({
            case_id: row.id, category: "stale_case", language: lab.language ?? "en",
            summary: `Case ${row.id} ${b.returning ? "was sent back by the clinic and" : ""} has been at ${b.returning ? "rework" : stageOf(row.stage_index).replace(/_/g, " ").toLowerCase()} for ${b.days_idle} days with no stage change, note or follow-up.${b.promise_date ? ` The lab's promise date is ${fmtDate(b.promise_date, "en")}.` : ""}${row.appointment_date ? ` The clinic's next appointment is ${fmtDate(row.appointment_date, "en")}.` : ""}`,
            context: { stage: stageOf(row.stage_index), timeline, parties: ["clinic", "lab"], attempted: ["get_case", "get_turnaround_benchmark", "flag_case_risk"], stop_reason: `Stale ≥ ${staleDays} days; requires a human decision on scheduling or contacting the clinic.` },
          }, ctx);
          escalated++;
        }
      } else await resolveFlag(ctx, row.id, "stale");
    }
    if((open??[]).length<200) break;
    }
  }
  return { labs: (labs ?? []).length, cases, flagged, escalated };
}
