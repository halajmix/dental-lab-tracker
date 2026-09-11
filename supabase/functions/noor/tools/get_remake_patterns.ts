import type { ToolContext } from "../lib/types.ts";
import { detectPatterns, type RemakeRecord } from "../lib/patterns.ts";

export async function getRemakePatterns(input: { lab_id: string; period_days: 30 | 90 | 180 }, ctx: ToolContext) {
  if (ctx.caller.kind === "system" && ctx.caller.jobLabId !== input.lab_id) throw new Error("job is not scoped to this lab");
  if (ctx.caller.kind === "user" && ctx.caller.role !== "admin" && ctx.caller.labId !== input.lab_id) throw new Error("not this caller's lab");
  const since = new Date(ctx.now.getTime() - input.period_days * 86400000).toISOString();
  const [rounds, cases, clinics] = await Promise.all([
    ctx.admin.from("case_rounds").select("parent_case_id,reason_class,reason_code,created_at").eq("kind", "remake").gte("created_at", since).not("reason_code", "is", null),
    ctx.admin.from("cases").select("id,clinic_id,created_at,remake").eq("lab_id", input.lab_id).gte("created_at", since),
    ctx.admin.from("clinics").select("id,name"),
  ]);
  const caseClinic = new Map((cases.data ?? []).map((c: { id: string; clinic_id: string }) => [c.id, c.clinic_id]));
  const clinicName = new Map((clinics.data ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));
  const records: RemakeRecord[] = [];
  for (const r of (rounds.data ?? []) as Array<{ parent_case_id: string; reason_class: RemakeRecord["reason_class"]; reason_code: string; created_at: string }>) {
    const clinicId = caseClinic.get(r.parent_case_id); if (!clinicId) continue;
    records.push({ clinic_id: clinicId, clinic_name: clinicName.get(clinicId) ?? "—", reason_class: r.reason_class, reason_code: r.reason_code, created_at: r.created_at });
  }
  for (const c of (cases.data ?? []) as Array<{ id: string; clinic_id: string; created_at: string; remake: { reason_class?: RemakeRecord["reason_class"]; reason_code?: string } | null }>) {
    if (c.remake?.reason_code && c.remake.reason_class) records.push({ clinic_id: c.clinic_id, clinic_name: clinicName.get(c.clinic_id) ?? "—", reason_class: c.remake.reason_class, reason_code: c.remake.reason_code, created_at: c.created_at });
  }
  const volumes = [...caseClinic.values()].reduce((m, id) => m.set(id, (m.get(id) ?? 0) + 1), new Map<string, number>());
  return { patterns: detectPatterns(records, [...volumes].map(([clinic_id, cases_in_period]) => ({ clinic_id, cases_in_period }))) };
}
