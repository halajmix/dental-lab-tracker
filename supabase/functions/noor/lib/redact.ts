import type { CaseRow, CaseSummary, Language, Stage } from "./types.ts";
import { stageOf } from "./types.ts";

/* Everything that leaves the platform or lands in the audit log passes
   through here. Patient identifiers are the point: the model works from case
   ids, and only the case's own clinic may ask for the patient's name/phone. */

const SENSITIVE_KEYS = new Set(["patient_name", "patient_phone", "patientName", "patientPhone", "email", "token", "password", "authorization", "apikey", "api_key"]);

export function redactForAudit<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactForAudit) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k) ? "[redacted]" : redactForAudit(v);
    }
    return out as T;
  }
  return value;
}

/** Wrap untrusted content so the prompt can label it as data, never instruction. */
export function wrapData(label: string, value: unknown): string {
  const body = typeof value === "string" ? value : JSON.stringify(value, null, 0);
  return `<data label="${label.replace(/"/g, "")}">\n${body.replace(/<\/data>/gi, "&lt;/data&gt;")}\n</data>`;
}

export function toothLabel(t: { fdi?: number | string; universal?: number | string; role?: string }, notation: "FDI" | "Universal" | undefined): string {
  const n = notation === "Universal" ? (t.universal ?? t.fdi) : (t.fdi ?? t.universal);
  const suffix = t.role === "pontic" ? "(p)" : t.role === "veneer" ? "(v)" : "";
  return `${n ?? "?"}${suffix}`;
}

export interface SummaryInput {
  row: CaseRow;
  clinicName: string;
  labName: string;
  includePatient: boolean;
  openRounds?: Array<{ kind: string; created_at: string; instructions: string | null }>;
  openFlags?: Array<{ kind: string; reason: string }>;
  openClarification?: { question: string; asked_at: string } | null;
}

export function toCaseSummary(i: SummaryInput): CaseSummary {
  const rx = i.row.prescription ?? {};
  const restorations = (rx.restorations?.length ? rx.restorations : rx.category ? [rx as unknown as NonNullable<typeof rx.restorations>[number]] : []).map((r) => ({
    category: r.category,
    material: r.material,
    shade_guide: r.shadeGuide,
    shade: r.shadeGuide === "Shade by Lab" ? (i.row.lab_shade ? `${i.row.lab_shade} (determined by lab)` : null) : (r.vitaShade ?? null),
    teeth: (r.teeth ?? []).map((t) => toothLabel(t, rx.notation)),
    arches: r.arches ?? null,
  }));
  const history = (i.row.history ?? []).map((h) => ({
    at: h.at,
    action: h.action,
    to_stage: typeof h.toStage === "number" ? stageOf(h.toStage) : undefined,
    by_role: h.role,
  }));
  const stageSince = [...(i.row.history ?? [])].reverse().find((h) => h.toStage === i.row.stage_index)?.at ?? i.row.created_at;
  const out: CaseSummary = {
    case_id: i.row.id,
    stage: stageOf(i.row.stage_index),
    stage_since: stageSince,
    clinic_name: i.clinicName,
    lab_name: i.labName,
    patient_ref: i.row.patient_id,
    created_date: i.row.created_date,
    promise_date: rx.estReady ?? null,
    need_by_date: i.row.appointment_date ?? null,
    delivery_time: i.row.delivery_time ?? undefined,
    restorations,
    lab_shade: i.row.lab_shade ?? null,
    files: (rx.files ?? []).map((f) => ({ kind: f.kind, name: f.name })),
    history,
    open_rounds: (i.openRounds ?? []).map((r) => ({ kind: r.kind, created_at: r.created_at, instructions: (r.instructions ?? "").slice(0, 500) })),
    open_flags: i.openFlags ?? [],
    open_clarification: i.openClarification ?? null,
    cancel_status: i.row.cancel_status ?? "none",
  };
  if (i.includePatient) {
    out.patient_name = i.row.patient_name;
    if (i.row.patient_phone) out.patient_phone = i.row.patient_phone;
  }
  return out;
}

export const stageLabel = (s: Stage, lang: Language): string =>
  lang === "ar"
    ? ({ STILL_AT_CLINIC: "لا تزال في العيادة", PICKED_UP_BY_LAB: "استلمها المختبر", WORK_IN_PROGRESS: "العمل جارٍ", WORK_COMPLETE: "اكتمل العمل", CLINIC_RECEIVED: "استلمتها العيادة" } as Record<Stage, string>)[s]
    : ({ STILL_AT_CLINIC: "Still at Clinic", PICKED_UP_BY_LAB: "Picked Up by Lab", WORK_IN_PROGRESS: "Work in Progress", WORK_COMPLETE: "Work Complete", CLINIC_RECEIVED: "Clinic Received" } as Record<Stage, string>)[s];
