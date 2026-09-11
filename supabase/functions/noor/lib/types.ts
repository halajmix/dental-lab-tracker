/* Runtime-agnostic types. No Deno or npm imports here — these files are
   shared between the Edge Function and the Node test runner. */

export type Language = "en" | "ar";
export type Stage = "STILL_AT_CLINIC" | "PICKED_UP_BY_LAB" | "WORK_IN_PROGRESS" | "WORK_COMPLETE" | "CLINIC_RECEIVED";
export const STAGES: Stage[] = ["STILL_AT_CLINIC", "PICKED_UP_BY_LAB", "WORK_IN_PROGRESS", "WORK_COMPLETE", "CLINIC_RECEIVED"];
export const STAGE_LABEL: Record<Language, Record<Stage, string>> = {
  en: { STILL_AT_CLINIC: "Still at Clinic", PICKED_UP_BY_LAB: "Picked Up by Lab", WORK_IN_PROGRESS: "Work in Progress", WORK_COMPLETE: "Work Complete", CLINIC_RECEIVED: "Clinic Received" },
  ar: { STILL_AT_CLINIC: "لا تزال في العيادة", PICKED_UP_BY_LAB: "استلمها المختبر", WORK_IN_PROGRESS: "العمل جارٍ", WORK_COMPLETE: "اكتمل العمل", CLINIC_RECEIVED: "استلمتها العيادة" },
};
export const stageOf = (index: number): Stage => STAGES[Math.max(0, Math.min(STAGES.length - 1, index))];
export const stageIndexOf = (s: Stage): number => STAGES.indexOf(s);

export type Trigger =
  | "prescription_submitted" | "stage_changed" | "remake_recorded" | "clarification_answered"
  | "scheduled_watch" | "scheduled_brief" | "scheduled_patterns" | "user_question";

export interface Caller {
  kind: "user" | "system";
  userId?: string;
  role?: "dentist" | "lab" | "admin";
  labId?: string | null;
  clinicIds?: string[];
  name?: string;
  language: Language;
  timezone: string;
  /** For scheduled runs: the lab the job is iterating. */
  jobLabId?: string;
}

export interface Restoration {
  id?: string;
  category?: string;
  material?: string;
  shadeGuide?: string;
  vitaShade?: string;
  stumpShade?: string;
  teeth?: Array<{ fdi?: number | string; universal?: number | string; role?: string }>;
  arches?: "upper" | "lower" | "both";
  implantSystem?: string;
  abutmentType?: string;
  abutmentColor?: string;
}

export interface Prescription {
  caseMode?: "restorations" | "appliance";
  notation?: "FDI" | "Universal";
  restorations?: Restoration[];
  category?: string;
  material?: string;
  shadeGuide?: string;
  vitaShade?: string;
  arches?: "upper" | "lower" | "both";
  teeth?: Restoration["teeth"];
  included?: string[];
  includedOther?: string;
  files?: Array<{ name: string; size?: number; kind: "scan" | "photo"; url?: string }>;
  notes?: string;
  estReady?: string | null;
  pickupRequested?: boolean;
}

/** A `cases` row as PostgREST returns it (snake_case). */
export interface CaseRow {
  id: string;
  clinic_id: string;
  lab_id: string | null;
  patient_name: string;
  patient_id: string;
  patient_phone?: string | null;
  appointment_date: string | null;
  delivery_time?: string | null;
  created_date: string;
  created_at?: string;
  stage_index: number;
  prescription: Prescription;
  history?: Array<{ at: string; action: string; toStage?: number; label?: string; by?: string; role?: string }>;
  remake?: { classification?: string; reason?: string; cost?: number | null } | null;
  lab_shade?: string | null;
  cancel_status?: string;
  invoice_status?: string;
  created_by?: string | null;
}

export interface Issue {
  field: "teeth" | "notation" | "category" | "material" | "shade_guide" | "shade" | "impression_or_scan" | "due_date" | "notes_conflict";
  restoration_index?: number;
  severity: "blocking" | "warning";
  detail: string;
}

export interface CaseSummary {
  case_id: string;
  stage: Stage;
  stage_since?: string;
  clinic_name: string;
  lab_name: string;
  patient_ref?: string;
  patient_name?: string;
  patient_phone?: string;
  created_date: string;
  promise_date: string | null;
  need_by_date: string | null;
  delivery_time?: string;
  restorations: Array<{ category?: string; material?: string; shade_guide?: string; shade?: string | null; teeth: string[]; arches?: string | null }>;
  lab_shade?: string | null;
  files: Array<{ kind: "scan" | "photo"; name: string }>;
  history: Array<{ at: string; action: string; to_stage?: Stage; by_role?: string }>;
  open_rounds: Array<{ kind: string; created_at: string; instructions: string }>;
  open_flags: Array<{ kind: string; reason: string }>;
  open_clarification: { question: string; asked_at: string } | null;
  cancel_status: string;
}

export type FlagKind = "at_risk" | "overdue" | "stale" | "needs_clarification";
export type Visibility = "lab" | "clinic" | "both";
export type StageStatus = "on_track" | "at_risk" | "overdue" | "done";

/** Minimal supabase-js surface the tools use; typed loosely on purpose so the
    Node test runner can substitute fixtures without importing the SDK. */
// deno-lint-ignore no-explicit-any
export type Db = { from: (table: string) => any };

export interface ToolContext {
  caller: Caller;
  db: Db;          // caller-scoped (RLS) for reads
  admin: Db;       // service role for writes, after authz
  shadow: boolean;
  now: Date;
  traceId: string;
  resendKey?: string;
  wouldHave: Array<{ tool: string; input: unknown }>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolExecutor {
  definitions(names?: string[]): ToolDefinition[];
  execute(name: string, input: unknown, ctx: ToolContext): Promise<unknown>;
}

export interface LlmTextBlock { type: "text"; text: string }
export interface LlmToolUseBlock { type: "tool_use"; id: string; name: string; input: unknown }
export type LlmBlock = LlmTextBlock | LlmToolUseBlock | { type: string; [k: string]: unknown };
export interface LlmResponse {
  content: LlmBlock[];
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "refusal" | "pause_turn" | "stop_sequence" | string;
  usage?: { input_tokens?: number; output_tokens?: number };
  model?: string;
}
export type LlmMessage =
  | { role: "user" | "assistant"; content: string | Array<Record<string, unknown>> };
export interface LlmRequest {
  purpose: "answer" | "phrase";
  system: string;
  messages: LlmMessage[];
  tools: ToolDefinition[];
  maxTokens: number;
}
export interface LlmClient { complete(req: LlmRequest): Promise<LlmResponse> }
