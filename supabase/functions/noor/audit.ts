import type { Db } from "./lib/types.ts";
import { redactForAudit } from "./lib/redact.ts";

/* Start logging before any work; fail closed if the run cannot be recorded.
   Completion errors are reported without repeating an already executed action. */
export interface AuditSink { toolCall(seq: number, tool: string, input: unknown, output: unknown, durationMs: number, error?: string): Promise<void> }

export function makeAudit(admin: Db, traceId: string) {
  return {
    async start(meta: { trigger: string; labId?: string | null; clinicId?: string | null; userId?: string | null; caseId?: string | null; shadow: boolean }) {
      try { const {error}=await admin.from("agent_runs").insert({ trace_id: traceId, trigger: meta.trigger, lab_id: meta.labId ?? null, clinic_id: meta.clinicId ?? null, user_id: meta.userId ?? null, case_id: meta.caseId ?? null, shadow: meta.shadow });if(error) throw new Error("Audit could not be started"); }
      catch (e) { console.error("audit start failed", e); throw new Error("Noor activity logging is unavailable"); }
    },
    sink: {
      async toolCall(seq, tool, input, output, durationMs, error) {
        try { const {error:writeError}=await admin.from("agent_tool_calls").insert({ trace_id: traceId, seq, tool, input: redactForAudit(input), output: redactForAudit(output), duration_ms: durationMs, error: error ?? null });if(writeError) console.error('audit tool call failed',writeError.code); }
        catch (e) { console.error("audit tool call failed", e); }
      },
    } as AuditSink,
    async finish(r: { outcome: string; model?: string | null; inputTokens?: number; outputTokens?: number; error?: string | null; wouldHave?: unknown; cacheReadTokens?:number;cacheCreationTokens?:number;estimatedCostUsd?:number;fallbackReason?:string }) {
      try { const {error}=await admin.from("agent_runs").update({ finished_at: new Date().toISOString(), outcome: r.outcome, model: r.model ?? null, input_tokens: r.inputTokens ?? 0, output_tokens: r.outputTokens ?? 0, error: r.error ?? null, would_have: r.wouldHave ? redactForAudit(r.wouldHave) : null,
        cache_read_tokens:r.cacheReadTokens??0,cache_creation_tokens:r.cacheCreationTokens??0,estimated_cost_usd:r.estimatedCostUsd??0,fallback_reason:r.fallbackReason??null }).eq("trace_id", traceId);if(error) console.error('audit finish failed',error.code); }
      catch (e) { console.error("audit finish failed", e); }
    },
  };
}
