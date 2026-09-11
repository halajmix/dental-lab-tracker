import type { ToolContext } from "../lib/types.ts";
import { loadCaseForAuthz, assertCanAct } from "../authz.ts";

export async function addCaseNote(input: { case_id: string; body: string }, ctx: ToolContext): Promise<{ note_id: string }> {
  const row = await loadCaseForAuthz(ctx, input.case_id);
  assertCanAct(ctx.caller, row);
  if (!/^Noor: /.test(input.body)) throw new Error("notes must start with 'Noor: '");
  if (ctx.shadow) { ctx.wouldHave.push({ tool: "add_case_note", input }); return { note_id: "shadow" }; }
  const { data, error } = await ctx.admin.from("case_notes").insert({ case_id: row.id, author_name: "Noor", author_role: "agent", body: input.body.slice(0, 300) }).select("id").single();
  if (error) throw new Error(`add_case_note: ${error.message}`);
  return { note_id: data.id };
}
