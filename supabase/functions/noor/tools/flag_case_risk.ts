import type { FlagKind, ToolContext, Visibility } from "../lib/types.ts";
import { loadCaseForAuthz, assertCanAct } from "../authz.ts";

export async function flagCaseRisk(input: { case_id: string; kind: FlagKind; reason: string; visible_to: Visibility; days_over?: number }, ctx: ToolContext): Promise<{ flag_id: string; created: boolean }> {
  const row = await loadCaseForAuthz(ctx, input.case_id);
  assertCanAct(ctx.caller, row);
  if (ctx.shadow) { ctx.wouldHave.push({ tool: "flag_case_risk", input }); return { flag_id: "shadow", created: true }; }
  const { data: existing } = await ctx.admin.from("case_flags").select("id").eq("case_id", row.id).eq("kind", input.kind).is("resolved_at", null).maybeSingle();
  if (existing) {
    await ctx.admin.from("case_flags").update({ reason: input.reason, visible_to: input.visible_to, days_over: input.days_over ?? null }).eq("id", existing.id);
    return { flag_id: existing.id, created: false };
  }
  const { data, error } = await ctx.admin.from("case_flags").insert({ case_id: row.id, kind: input.kind, reason: input.reason, visible_to: input.visible_to, days_over: input.days_over ?? null, trace_id: ctx.traceId }).select("id").single();
  if (error) throw new Error(`flag_case_risk: ${error.message}`);
  return { flag_id: data.id, created: true };
}

export async function resolveFlag(ctx: ToolContext, caseId: string, kind: FlagKind): Promise<void> {
  if (ctx.shadow) { ctx.wouldHave.push({ tool: "resolve_flag", input: { caseId, kind } }); return; }
  await ctx.admin.from("case_flags").update({ resolved_at: ctx.now.toISOString() }).eq("case_id", caseId).eq("kind", kind).is("resolved_at", null);
}
