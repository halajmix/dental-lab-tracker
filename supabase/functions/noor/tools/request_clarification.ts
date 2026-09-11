import type { Issue, Language, ToolContext } from "../lib/types.ts";
import { assertCanAct, loadCaseForAuthz } from "../authz.ts";
import { loadSummary } from "./get_case.ts";
import { renderStatus } from "../lib/templates.ts";
import { sendEmail } from "../../_shared/email.ts";

export async function requestClarification(input: { case_id: string; issue: Issue; question: string; language: Language }, ctx: ToolContext): Promise<{ clarification_id: string; asked_at: string }> {
  const row = await loadCaseForAuthz(ctx, input.case_id);
  assertCanAct(ctx.caller, row);
  if (row.stage_index > 1) throw new Error("case has already entered production; clarification is no longer possible");
  const { data: open } = await ctx.admin.from("case_clarifications").select("id").eq("case_id", row.id).eq("status", "open").maybeSingle();
  if (open) throw new Error("a clarification is already open on this case");
  if (ctx.shadow) { ctx.wouldHave.push({ tool: "request_clarification", input }); return { clarification_id: "shadow", asked_at: ctx.now.toISOString() }; }

  const { data, error } = await ctx.admin.from("case_clarifications")
    .insert({ case_id: row.id, issue: input.issue, question: input.question, language: input.language, trace_id: ctx.traceId })
    .select("id,asked_at").single();
  if (error) throw new Error(`request_clarification: ${error.message}`);
  await ctx.admin.from("case_flags").upsert({ case_id: row.id, kind: "needs_clarification", reason: input.question.slice(0, 240), visible_to: "both", trace_id: ctx.traceId }, { onConflict: "case_id,kind", ignoreDuplicates: true });
  await ctx.admin.from("case_notes").insert({ case_id: row.id, author_name: "Noor", author_role: "agent", body: `Noor: clarification requested — ${input.issue.field}${input.issue.restoration_index != null ? ` (restoration ${input.issue.restoration_index + 1})` : ""}`.slice(0, 300) });

  const [{ data: clinic }, loaded] = await Promise.all([
    ctx.admin.from("clinics").select("email,language").eq("id", row.clinic_id).maybeSingle(),
    loadSummary({ ...ctx, caller: { kind: "system", jobLabId: row.lab_id ?? undefined, language: input.language, timezone: ctx.caller.timezone } }, row.id, false),
  ]);
  if (clinic?.email && loaded) {
    const r = renderStatus("clarification_request", loaded.summary, (clinic.language as Language) ?? input.language, { question: input.question });
    await sendEmail({ to: clinic.email, subject: r.subject, html: r.html, idempotencyKey: `noor-clar-${data.id}` }, ctx.resendKey);
  }
  return { clarification_id: data.id, asked_at: data.asked_at };
}
