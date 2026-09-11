import type { ToolContext } from "../lib/types.ts";
import { benchmark } from "../lib/benchmark.ts";
import { loadCaseForAuthz, assertCanAct } from "../authz.ts";

export const STALE_DAYS_DEFAULT = 5;

export async function lastActivity(ctx: ToolContext, caseId: string, history: Array<{ at: string }> | undefined): Promise<string | null> {
  const [notes, rounds] = await Promise.all([
    ctx.admin.from("case_notes").select("created_at").eq("case_id", caseId).order("created_at", { ascending: false }).limit(1),
    ctx.admin.from("case_rounds").select("created_at").eq("parent_case_id", caseId).order("created_at", { ascending: false }).limit(1),
  ]);
  const candidates = [history?.at(-1)?.at, notes.data?.[0]?.created_at, rounds.data?.[0]?.created_at].filter(Boolean) as string[];
  return candidates.length ? candidates.sort().at(-1)! : null;
}

export async function getTurnaroundBenchmark(input: { case_id: string }, ctx: ToolContext) {
  const row = await loadCaseForAuthz(ctx, input.case_id);
  assertCanAct(ctx.caller, row);
  const { data: lab } = row.lab_id ? await ctx.admin.from("labs").select("tat,procedure_tats").eq("id", row.lab_id).maybeSingle() : { data: null };
  const last = await lastActivity(ctx, row.id, row.history);
  const b = benchmark({ row, procedureTats: lab?.procedure_tats ?? {}, labTat: lab?.tat ?? 0, lastActivityAt: last, now: ctx.now, staleDays: STALE_DAYS_DEFAULT });
  return { effective_tat_days: b.effective_tat_days, promise_date: b.promise_date, per_stage: b.per_stage, source: b.source };
}
