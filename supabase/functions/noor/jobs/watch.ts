import type { CaseRow, Db, ToolContext } from "../lib/types.ts";
import { benchmark } from "../lib/benchmark.ts";
import { stageOf } from "../lib/types.ts";
import { flagCaseRisk, resolveFlag } from "../tools/flag_case_risk.ts";
import { lastActivity } from "../tools/get_turnaround_benchmark.ts";
import { escalateToHuman } from "../tools/escalate_to_human.ts";
import { claimIdempotency } from "../gate.ts";
import { fmtDate } from "../lib/templates.ts";

/* Timeline Watcher. Pure code end to end; no model call. */
export async function runWatch(admin: Db, makeCtx: (labId: string) => ToolContext, staleDays: number): Promise<{ labs: number; cases: number; flagged: number; escalated: number }> {
  const { data: labs } = await admin.from("labs").select("id,name,tat,procedure_tats,language").eq("noor_enabled", true);
  let cases = 0, flagged = 0, escalated = 0;
  for (const lab of (labs ?? []) as Array<{ id: string; name: string; tat: number; procedure_tats: Record<string, number>; language: "en" | "ar" }>) {
    const ctx = makeCtx(lab.id);
    const { data: open } = await admin.from("cases").select("*").eq("lab_id", lab.id).lt("stage_index", 4).neq("cancel_status", "cancelled").limit(500);
    for (const row of (open ?? []) as CaseRow[]) {
      cases++;
      const last = await lastActivity(ctx, row.id, row.history);
      const b = benchmark({ row, procedureTats: lab.procedure_tats ?? {}, labTat: lab.tat ?? 0, lastActivityAt: last, now: ctx.now, staleDays });
      const next = b.per_stage.find((p) => p.status !== "done");
      if (b.verdict === "at_risk" && next) { await flagCaseRisk({ case_id: row.id, kind: "at_risk", reason: `${next.stage.replace(/_/g, " ").toLowerCase()} expected by ${fmtDate(next.expected_by, "en")}`, visible_to: "lab" }, ctx); flagged++; }
      else await resolveFlag(ctx, row.id, "at_risk");
      if (b.verdict === "overdue" && next) {
        await flagCaseRisk({ case_id: row.id, kind: "overdue", reason: `${next.stage.replace(/_/g, " ").toLowerCase()} was expected by ${fmtDate(next.expected_by, "en")} (${b.days_over} day${b.days_over === 1 ? "" : "s"} over)`, visible_to: b.overdue_confirmed ? "both" : "lab", days_over: b.days_over }, ctx); flagged++;
      } else await resolveFlag(ctx, row.id, "overdue");
      if (b.stale) {
        await flagCaseRisk({ case_id: row.id, kind: "stale", reason: `no activity for ${b.days_idle} days at ${stageOf(row.stage_index).replace(/_/g, " ").toLowerCase()}`, visible_to: "lab" }, ctx);
        const weekKey = `stale:${row.id}:${ctx.now.toISOString().slice(0, 10)}`;
        if (ctx.shadow || await claimIdempotency(admin, weekKey)) {
          const timeline = (row.history ?? []).map((h) => `${fmtDate(h.at.slice(0, 10), "en")} — ${h.label ?? h.action}${h.role ? ` (${h.role})` : ""}`);
          timeline.push(`${fmtDate(ctx.now.toISOString().slice(0, 10), "en")} — no activity for ${b.days_idle} days (stale threshold ${staleDays})`);
          await escalateToHuman({
            case_id: row.id, category: "stale_case", language: lab.language ?? "en",
            summary: `Case ${row.id} has been at ${stageOf(row.stage_index).replace(/_/g, " ").toLowerCase()} for ${b.days_idle} days with no stage change, note or follow-up.${b.promise_date ? ` The lab's promise date is ${fmtDate(b.promise_date, "en")}.` : ""}${row.appointment_date ? ` The clinic's next appointment is ${fmtDate(row.appointment_date, "en")}.` : ""}`,
            context: { stage: stageOf(row.stage_index), timeline, parties: ["clinic", "lab"], attempted: ["get_case", "get_turnaround_benchmark", "flag_case_risk"], stop_reason: `Stale ≥ ${staleDays} days; requires a human decision on scheduling or contacting the clinic.` },
          }, ctx);
          escalated++;
        }
      } else await resolveFlag(ctx, row.id, "stale");
    }
  }
  return { labs: (labs ?? []).length, cases, flagged, escalated };
}
