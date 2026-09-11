import type { ToolContext } from "../lib/types.ts";
import { loadCaseForAuthz, assertCanAct } from "../authz.ts";

export async function recordRemakeReason(input: { case_id: string; round_id?: string; reason_class: "clinical" | "laboratory"; reason_code: string; stated_text?: string }, ctx: ToolContext): Promise<{ recorded: boolean }> {
  const row = await loadCaseForAuthz(ctx, input.case_id);
  assertCanAct(ctx.caller, row);
  if (ctx.shadow) { ctx.wouldHave.push({ tool: "record_remake_reason", input }); return { recorded: true }; }
  if (input.round_id) {
    const { error } = await ctx.admin.from("case_rounds").update({ reason_class: input.reason_class, reason_code: input.reason_code, reason_text: input.stated_text?.slice(0, 500) ?? null })
      .eq("id", input.round_id).eq("parent_case_id", row.id).eq("kind", "remake");
    if (error) throw new Error(`record_remake_reason: ${error.message}`);
  } else {
    // Case-level slot: keep the existing classification/reason/cost, add the code.
    const remake = { ...(row.remake ?? {}), reason_class: input.reason_class, reason_code: input.reason_code };
    const { error } = await ctx.admin.from("cases").update({ remake }).eq("id", row.id);
    if (error) throw new Error(`record_remake_reason: ${error.message}`);
  }
  return { recorded: true };
}
