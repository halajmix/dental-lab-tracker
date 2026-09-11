import type { Language, ToolContext } from "../lib/types.ts";
import { loadCaseForAuthz, assertCanAct } from "../authz.ts";
import { loadSummary } from "./get_case.ts";
import { renderStatus, type TemplateId } from "../lib/templates.ts";
import { sendEmail } from "../../_shared/email.ts";

export async function sendStatusUpdate(input: { case_id: string; template_id: TemplateId; language?: Language; idempotency_key?: string }, ctx: ToolContext): Promise<{ sent: boolean; skipped_reason: string | null; resend_id: string | null }> {
  const row = await loadCaseForAuthz(ctx, input.case_id);
  assertCanAct(ctx.caller, row);
  const key = `status:${row.id}:${input.template_id}:${input.idempotency_key ?? row.stage_index}`;
  if (!ctx.shadow) {
    const { error } = await ctx.admin.from("noor_idempotency").insert({ key });
    if (error) return { sent: false, skipped_reason: "duplicate", resend_id: null };
  }
  const { data: clinic } = await ctx.admin.from("clinics").select("email,language").eq("id", row.clinic_id).maybeSingle();
  if (!clinic?.email) {
    if (!ctx.shadow) await ctx.admin.from("case_notes").insert({ case_id: row.id, author_name: "Noor", author_role: "agent", body: "Noor: status update not emailed — clinic has no email on file" });
    return { sent: false, skipped_reason: "clinic has no email on file", resend_id: null };
  }
  const loaded = await loadSummary({ ...ctx, caller: { kind: "system", jobLabId: row.lab_id ?? undefined, language: "en", timezone: ctx.caller.timezone } }, row.id, false);
  if (!loaded) return { sent: false, skipped_reason: "case not found", resend_id: null };
  const lang = input.language ?? ((clinic.language as Language) || "en");
  const r = renderStatus(input.template_id, loaded.summary, lang);
  if (ctx.shadow) { ctx.wouldHave.push({ tool: "send_status_update", input: { ...input, to: "[clinic]", subject: r.subject } }); return { sent: true, skipped_reason: "shadow", resend_id: null }; }
  const id = await sendEmail({ to: clinic.email, subject: r.subject, html: r.html, idempotencyKey: `noor-${key}` }, ctx.resendKey);
  return { sent: !!id, skipped_reason: id ? null : "email provider error", resend_id: id };
}
