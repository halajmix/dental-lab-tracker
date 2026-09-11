import type { Db } from "./lib/types.ts";
import { redactForAudit } from "./lib/redact.ts";

/* Every run and every tool call. Audit failures are logged, never thrown —
   an agent run must not abort because the log could not be written. */
export interface AuditSink { toolCall(seq: number, tool: string, input: unknown, output: unknown, durationMs: number, error?: string): Promise<void> }

export function makeAudit(admin: Db, traceId: string) {
  return {
    async start(meta: { trigger: string; labId?: string | null; clinicId?: string | null; userId?: string | null; caseId?: string | null; shadow: boolean }) {
      try { await admin.from("agent_runs").insert({ trace_id: traceId, trigger: meta.trigger, lab_id: meta.labId ?? null, clinic_id: meta.clinicId ?? null, user_id: meta.userId ?? null, case_id: meta.caseId ?? null, shadow: meta.shadow }); }
      catch (e) { console.error("audit start failed", e); }
    },
    sink: {
      async toolCall(seq, tool, input, output, durationMs, error) {
        try { await admin.from("agent_tool_calls").insert({ trace_id: traceId, seq, tool, input: redactForAudit(input), output: redactForAudit(output), duration_ms: durationMs, error: error ?? null }); }
        catch (e) { console.error("audit tool call failed", e); }
      },
    } as AuditSink,
    async finish(r: { outcome: string; model?: string | null; inputTokens?: number; outputTokens?: number; error?: string | null; wouldHave?: unknown }) {
      try { await admin.from("agent_runs").update({ finished_at: new Date().toISOString(), outcome: r.outcome, model: r.model ?? null, input_tokens: r.inputTokens ?? 0, output_tokens: r.outputTokens ?? 0, error: r.error ?? null, would_have: r.wouldHave ? redactForAudit(r.wouldHave) : null }).eq("trace_id", traceId); }
      catch (e) { console.error("audit finish failed", e); }
    },
  };
}
