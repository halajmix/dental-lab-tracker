import type { CaseSummary, Language, Stage } from "./types.ts";
import { stageLabel } from "./redact.ts";

/* Fixed templates. Every slot is a value from get_case; a missing slot renders
   as "—", never as prose. Arabic is فصحى; technical terms stay in English. */

export type TemplateId = "picked_up" | "in_progress" | "work_complete" | "clinic_received" | "clarification_request" | "overdue_confirmed";
export interface Rendered { subject: string; html: string; text: string }

const DASH = "—";
const AR_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

export const esc = (v: unknown): string =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const arDigits = (s: string): string => s.replace(/\d/g, (d) => AR_DIGITS[Number(d)]);

export function fmtDate(iso: string | null | undefined, lang: Language): string {
  if (!iso) return DASH;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const day = String(Number(d));
  return lang === "ar" ? arDigits(`${day} ${MONTHS_AR[Number(mo) - 1]} ${y}`) : `${day} ${MONTHS_EN[Number(mo) - 1]} ${y}`;
}

const DELIVERY_AR: Record<string, string> = { Anytime: "في أي وقت", Morning: "صباحًا", Afternoon: "بعد الظهر", "Before sunset": "قبل الغروب", Evening: "مساءً" };
const slot = (v: unknown): string => (v == null || v === "" ? DASH : String(v));

export function restorationLine(c: CaseSummary): string {
  if (!c.restorations.length) return DASH;
  return c.restorations.map((r) => [r.category, r.material, r.shade_guide && r.shade ? `${r.shade_guide} ${r.shade}` : r.shade_guide, r.teeth.length ? r.teeth.join(", ") : r.arches].filter(Boolean).join(" · ")).join(" | ");
}

function footer(lang: Language): string {
  return lang === "ar"
    ? "— نور، منسّقة الحالات، dr-crown.com (مساعد ذكاء اصطناعي)"
    : "— Noor, Case Coordinator, dr-crown.com (an AI assistant)";
}

const STAGE_SUBJECT: Record<TemplateId, Record<Language, string>> = {
  picked_up:         { en: "picked up by the lab", ar: "استلمها المختبر" },
  in_progress:       { en: "work has started", ar: "بدأ العمل" },
  work_complete:     { en: "work complete", ar: "اكتمل العمل" },
  clinic_received:   { en: "received by the clinic", ar: "استلمتها العيادة" },
  clarification_request: { en: "one question before the lab can start", ar: "سؤال واحد قبل أن يبدأ المختبر" },
  overdue_confirmed: { en: "running late", ar: "تأخر عن الموعد" },
};

export function templateForStage(s: Stage): TemplateId | null {
  return ({ PICKED_UP_BY_LAB: "picked_up", WORK_IN_PROGRESS: "in_progress", WORK_COMPLETE: "work_complete", CLINIC_RECEIVED: "clinic_received" } as Partial<Record<Stage, TemplateId>>)[s] ?? null;
}

export function renderStatus(id: TemplateId, c: CaseSummary, lang: Language, extra: { question?: string; daysOver?: number } = {}): Rendered {
  const subject = `${lang === "ar" ? "الحالة" : "Case"} ${c.case_id} — ${STAGE_SUBJECT[id][lang]}`;
  const delivery = lang === "ar" ? (c.delivery_time ? DELIVERY_AR[c.delivery_time] ?? c.delivery_time : DASH) : slot(c.delivery_time);
  const lines: string[] = [];
  if (lang === "ar") {
    const opening: Record<TemplateId, string> = {
      picked_up: `استلم مختبر ${c.lab_name} الحالة ${c.case_id}.`,
      in_progress: `بدأ مختبر ${c.lab_name} العمل على الحالة ${c.case_id}.`,
      work_complete: `أكمل مختبر ${c.lab_name} العمل على الحالة ${c.case_id}.`,
      clinic_received: `سُجِّل استلام العيادة للحالة ${c.case_id}.`,
      clarification_request: `قبل أن يبدأ مختبر ${c.lab_name} العمل على الحالة ${c.case_id}، هناك سؤال واحد:`,
      overdue_confirmed: `الحالة ${c.case_id} لم تكتمل بعد، وقد مضى موعد المريض التالي${extra.daysOver ? ` بـ${arDigits(String(extra.daysOver))} يوم` : ""}.`,
    };
    lines.push(opening[id]);
    if (id === "clarification_request" && extra.question) lines.push("", extra.question, "", "يمكنكم الرد من صفحة الحالة في dr-crown.com أو بالرد على هذه الرسالة.");
    lines.push("", `التعويض: ${restorationLine(c)}`, `موعد التسليم الذي التزم به المختبر: ${fmtDate(c.promise_date, "ar")}`,
      `موعد المريض التالي: ${fmtDate(c.need_by_date, "ar")}${c.delivery_time ? `، ${delivery}` : ""}`,
      `التسليم: ${c.open_rounds.some((r) => r.kind === "stage") ? "طلب المختبر الاستلام" : DASH}`,
      "", "يمكنكم الرد على هذه الرسالة للتواصل مع المختبر مباشرة.", footer("ar"));
  } else {
    const opening: Record<TemplateId, string> = {
      picked_up: `${c.lab_name} has picked up case ${c.case_id}.`,
      in_progress: `${c.lab_name} has started work on case ${c.case_id}.`,
      work_complete: `${c.lab_name} has marked case ${c.case_id} complete.`,
      clinic_received: `Case ${c.case_id} has been recorded as received by the clinic.`,
      clarification_request: `Before ${c.lab_name} can start case ${c.case_id}, one question:`,
      overdue_confirmed: `Case ${c.case_id} is not yet complete and the clinic's next appointment has passed${extra.daysOver ? ` by ${extra.daysOver} day${extra.daysOver === 1 ? "" : "s"}` : ""}.`,
    };
    lines.push(opening[id]);
    if (id === "clarification_request" && extra.question) lines.push("", extra.question, "", "Reply from the case page on dr-crown.com, or reply to this email.");
    lines.push("", `Restoration: ${restorationLine(c)}`, `Lab promise date: ${fmtDate(c.promise_date, "en")}`,
      `Your next appointment: ${fmtDate(c.need_by_date, "en")}${c.delivery_time ? `, ${delivery}` : ""}`,
      `Delivery: ${c.open_rounds.some((r) => r.kind === "stage") ? "pick-up requested by the lab" : DASH}`,
      "", "Reply to this email to reach the lab directly.", footer("en"));
  }
  const text = lines.join("\n");
  const html = `<div dir="${lang === "ar" ? "rtl" : "ltr"}" style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:560px;color:#0f172a;line-height:1.5">${lines.map((l) => (l === "" ? "<br/>" : `<p style="margin:0">${esc(l)}</p>`)).join("")}</div>`;
  return { subject, html, text };
}

export interface BriefSections {
  due_today: CaseSummary[]; overdue: CaseSummary[]; awaiting_clarification: CaseSummary[];
  needs_decision: Array<{ case_id: string; what: string }>;
}
export function renderBrief(labName: string, day: string, s: BriefSections, lang: Language): Rendered {
  const t = lang === "ar"
    ? { subject: `موجز ${labName} — ${fmtDate(day, "ar")}`, due: "مستحقة اليوم", over: "متأخرة", clar: "في انتظار توضيح", dec: "تحتاج قرارًا", none: "لا شيء" }
    : { subject: `${labName} brief — ${fmtDate(day, "en")}`, due: "Due today", over: "Overdue", clar: "Awaiting clarification", dec: "Needs a decision", none: "nothing" };
  const line = (c: CaseSummary) => `${c.case_id} · ${c.clinic_name} · ${restorationLine(c).split(" | ")[0]} · ${lang === "ar" ? stageLabel(c.stage, "ar") : stageLabel(c.stage, "en")}`;
  const sections: string[] = [];
  const add = (title: string, rows: string[]) => { if (rows.length) sections.push(`${title} (${lang === "ar" ? arDigits(String(rows.length)) : rows.length})`, ...rows.map((r) => `  • ${r}`), ""); };
  add(t.due, s.due_today.map(line));
  add(t.over, s.overdue.map(line));
  add(t.clar, s.awaiting_clarification.map(line));
  add(t.dec, s.needs_decision.map((d) => `${d.case_id} · ${d.what}`));
  const lines = [t.subject, "", ...sections, footer(lang)];
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n");
  const html = `<div dir="${lang === "ar" ? "rtl" : "ltr"}" style="font-family:system-ui,sans-serif;max-width:560px;line-height:1.5">${lines.map((l) => (l === "" ? "<br/>" : `<p style="margin:0">${esc(l)}</p>`)).join("")}</div>`;
  return { subject: t.subject, html, text };
}

export interface EscalationCtx { stage: Stage; timeline: string[]; parties: string[]; attempted: string[]; stop_reason: string }
export function renderEscalation(id: string, caseId: string | null, category: string, summary: string, ctx: EscalationCtx, lang: Language, caseLine?: string): Rendered {
  const subject = lang === "ar" ? `تصعيد ${id}${caseId ? ` — الحالة ${caseId}` : ""}` : `Escalation ${id}${caseId ? ` — case ${caseId}` : ""}`;
  const lines = lang === "ar"
    ? [caseLine ?? "", `المرحلة: ${stageLabel(ctx.stage, "ar")}`, "", summary, "", "التسلسل الزمني", ...ctx.timeline.map((l) => `  ${l}`), "",
       `ما فعلته نور: ${ctx.attempted.join("، ") || DASH}`, `سبب التوقف: ${ctx.stop_reason}`, `التصنيف: ${category}`, "", "افتحوا الحالة: https://dr-crown.com/", footer("ar")]
    : [caseLine ?? "", `Stage: ${stageLabel(ctx.stage, "en")}`, "", summary, "", "Timeline", ...ctx.timeline.map((l) => `  ${l}`), "",
       `What Noor did: ${ctx.attempted.join(", ") || DASH}`, `Why it stopped: ${ctx.stop_reason}`, `Category: ${category}`, "", "Open the case: https://dr-crown.com/", footer("en")];
  const text = lines.filter((l, i) => !(i === 0 && l === "")).join("\n");
  const html = `<div dir="${lang === "ar" ? "rtl" : "ltr"}" style="font-family:system-ui,sans-serif;max-width:560px;line-height:1.5">${lines.map((l) => (l === "" ? "<br/>" : `<p style="margin:0;white-space:pre-wrap">${esc(l)}</p>`)).join("")}</div>`;
  return { subject, html, text };
}
