import type { Db, ToolContext } from "../lib/types.ts";
import { briefIsEmpty, localParts } from "../lib/brief.ts";
import { renderBrief } from "../lib/templates.ts";
import { composeDailyBrief } from "../tools/compose_daily_brief.ts";
import { sendEmail } from "../../_shared/email.ts";

/* Daily Briefer. Hourly tick; sends once per lab per local day at brief_hour_local. */
export async function runBrief(admin: Db, makeCtx: (labId: string) => ToolContext): Promise<{ considered: number; sent: number; skipped: string[] }> {
  const { data: labs } = await admin.from("labs").select("id,name,email,notify_email,language,timezone,brief_hour_local").eq("noor_enabled", true);
  let sent = 0; const skipped: string[] = [];
  for (const lab of (labs ?? []) as Array<{ id: string; name: string; email: string | null; notify_email: string | null; language: "en" | "ar"; timezone: string; brief_hour_local: number }>) {
    const ctx = makeCtx(lab.id);
    const { date, hour } = localParts(ctx.now, lab.timezone || "Asia/Muscat");
    if (hour !== lab.brief_hour_local) { skipped.push(`${lab.name}: not the hour`); continue; }
    if (!ctx.shadow) {
      const { error } = await admin.from("noor_brief_runs").insert({ lab_id: lab.id, day: date });
      if (error) { skipped.push(`${lab.name}: already sent today`); continue; }
    }
    const sections = await composeDailyBrief({ lab_id: lab.id, date }, ctx);
    if (briefIsEmpty(sections)) { skipped.push(`${lab.name}: empty`); continue; }
    const to = (lab.notify_email ?? "").trim() || lab.email;
    if (!to) { skipped.push(`${lab.name}: no email`); continue; }
    const r = renderBrief(lab.name, date, sections, lab.language ?? "en");
    if (ctx.shadow) { ctx.wouldHave.push({ tool: "send_brief", input: { lab: lab.name, subject: r.subject, text: r.text } }); sent++; continue; }
    const id = await sendEmail({ to, subject: r.subject, html: r.html, idempotencyKey: `noor-brief-${lab.id}-${date}` }, ctx.resendKey);
    if (id) { await admin.from("noor_brief_runs").update({ sent_at: ctx.now.toISOString(), resend_id: id }).eq("lab_id", lab.id).eq("day", date); sent++; }
    else skipped.push(`${lab.name}: email failed`);
  }
  return { considered: (labs ?? []).length, sent, skipped };
}
