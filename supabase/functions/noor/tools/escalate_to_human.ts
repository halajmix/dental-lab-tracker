import type { Language, ToolContext } from "../lib/types.ts";
import { loadCaseForAuthz, assertCanAct } from "../authz.ts";
import { renderEscalation, type EscalationCtx } from "../lib/templates.ts";
import { sendEmail } from "../../_shared/email.ts";

/** G6: labs.escalation_user_id → owner_id → first active lab_admin → platform admin. */
export async function resolveManager(ctx: ToolContext, labId: string | null): Promise<{ userId: string | null; name: string; email: string | null }> {
  const admin = ctx.admin;
  const pick = async (userId: string | null) => {
    if (!userId) return null;
    const { data: p } = await admin.from("profiles").select("id,name").eq("id", userId).maybeSingle();
    return p ? { userId: p.id as string, name: (p.name as string) || "Manager" } : null;
  };
  if (labId) {
    const { data: lab } = await admin.from("labs").select("owner_id,escalation_user_id,email,notify_email").eq("id", labId).maybeSingle();
    const chosen = (await pick(lab?.escalation_user_id ?? null)) ?? (await pick(lab?.owner_id ?? null));
    if (chosen) return { ...chosen, email: (lab?.notify_email as string) || (lab?.email as string) || null };
    const { data: m } = await admin.from("lab_members").select("user_id,email").eq("lab_id", labId).eq("role", "lab_admin").eq("status", "active").limit(1);
    if (m?.[0]) { const p = await pick(m[0].user_id); if (p) return { ...p, email: m[0].email ?? (lab?.email as string) ?? null }; }
  }
  const { data: adminProfile } = await admin.from("profiles").select("id,name").eq("role", "admin").limit(1);
  const { data: setting } = await admin.from("pickup_digest_settings").select("recipient").eq("id", true).maybeSingle();
  return { userId: adminProfile?.[0]?.id ?? null, name: adminProfile?.[0]?.name ?? "Admin", email: setting?.recipient ?? null };
}

export async function escalateToHuman(input: { case_id?: string; category: string; summary: string; context: EscalationCtx; language?: Language }, ctx: ToolContext): Promise<{ escalation_id: string; assigned_to_name: string }> {
  let labId: string | null = ctx.caller.kind === "system" ? ctx.caller.jobLabId ?? null : ctx.caller.labId ?? null;
  let clinicId: string | null = null;
  let caseLine: string | undefined;
  if (input.case_id) {
    const row = await loadCaseForAuthz(ctx, input.case_id);
    assertCanAct(ctx.caller, row);
    labId = row.lab_id; clinicId = row.clinic_id;
    const [{ data: c }, { data: l }] = await Promise.all([ctx.admin.from("clinics").select("name").eq("id", row.clinic_id).maybeSingle(), row.lab_id ? ctx.admin.from("labs").select("name").eq("id", row.lab_id).maybeSingle() : { data: null }]);
    caseLine = `Case ${row.id} (${c?.name ?? "—"} → ${l?.name ?? "—"})`;
  } else if (ctx.caller.kind === "user" && !labId && ctx.caller.clinicIds?.length) clinicId = ctx.caller.clinicIds[0];
  const mgr = await resolveManager(ctx, labId);
  if (ctx.shadow) { ctx.wouldHave.push({ tool: "escalate_to_human", input: { ...input, assigned_to: mgr.name } }); return { escalation_id: "shadow", assigned_to_name: mgr.name }; }
  const { data, error } = await ctx.admin.from("escalations").insert({
    case_id: input.case_id ?? null, lab_id: labId, clinic_id: clinicId, category: input.category, summary: input.summary,
    context: input.context, assigned_to: mgr.userId, assigned_to_name: mgr.name, trace_id: ctx.traceId,
  }).select("id").single();
  if (error) throw new Error(`escalate_to_human: ${error.message}`);
  const shortId = `esc_${String(data.id).slice(0, 4)}`;
  if (input.case_id) await ctx.admin.from("case_notes").insert({ case_id: input.case_id, author_name: "Noor", author_role: "agent", body: `Noor: escalated to ${mgr.name} (${shortId}) — ${input.context.stop_reason}`.slice(0, 300) });
  if (mgr.email) {
    const r = renderEscalation(shortId, input.case_id ?? null, input.category, input.summary, input.context, input.language ?? "en", caseLine);
    await sendEmail({ to: mgr.email, subject: r.subject, html: r.html, idempotencyKey: `noor-esc-${data.id}` }, ctx.resendKey);
  }
  return { escalation_id: shortId, assigned_to_name: mgr.name };
}
