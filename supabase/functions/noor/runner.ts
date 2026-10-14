import type { Caller, LlmClient, LlmResponse, LlmToolUseBlock, ToolContext, ToolDefinition, ToolExecutor, Trigger } from "./lib/types.ts";
import type { AuditSink } from "./audit.ts";
import { usageCost } from './budget.ts';

/* The agent loop. Manual on purpose: the hard cap on tool calls, per-tool
   timeouts, fail-closed behaviour and per-call audit are all enforced here,
   in code, not delegated to the model or a helper. */

export interface RunLimits { maxToolCalls: number; toolTimeoutMs: number; maxTokens: number }
export interface RunOptions {
  trigger: Trigger; caller: Caller; systemPrompt: string; userMessage: string;
  toolNames?: string[]; executor: ToolExecutor; llm: LlmClient; ctx: ToolContext;
  audit?: AuditSink; limits: RunLimits; purpose: "answer" | "phrase";
}
export interface ToolCallRecord { name: string; input: unknown; output?: unknown; error?: string; durationMs: number }
export interface RunResult {
  text: string; outcome: "completed" | "refused" | "escalated" | "failed" | "killed";
  toolCalls: ToolCallRecord[]; inputTokens: number; outputTokens: number; model: string | null;
  cacheReadTokens?:number; cacheCreationTokens?:number; estimatedCostUsd?:number; error?:string;
}

export const FAIL_CLOSED_TEXT: Record<"en" | "ar", string> = {
  en: "I couldn't complete that request. Please try again or contact the lab manager.",
  ar: "تعذّر إكمال هذا الطلب. يرجى المحاولة مجددًا أو التواصل مع مسؤول المختبر.",
};

const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
  new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms); p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); }); });

const textOf = (r: LlmResponse): string => r.content.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text).join("").trim();

export async function runAgent(o: RunOptions): Promise<RunResult> {
  const defs: ToolDefinition[] = o.executor.definitions(o.toolNames);
  const messages: RunOptions extends never ? never : Array<{ role: "user" | "assistant"; content: string | Array<Record<string, unknown>> }> = [{ role: "user", content: o.userMessage }];
  const calls: ToolCallRecord[] = [];
  let inputTokens = 0, outputTokens = 0, model: string | null = null, escalated = false, capHit = false;
  let cacheReadTokens=0,cacheCreationTokens=0,estimatedCostUsd=0;
  const usage=()=>({inputTokens,outputTokens,model,cacheReadTokens,cacheCreationTokens,estimatedCostUsd});
  const lang = o.caller.language;

  for (let iter = 0; iter < o.limits.maxToolCalls + 2; iter++) {
    let res: LlmResponse;
    try {
      res = await o.llm.complete({ purpose: o.purpose, system: o.systemPrompt, messages, tools: capHit ? [] : defs, maxTokens: o.limits.maxTokens });
    } catch (e) {
      const detail=String((e as Error).message??'Model request failed').replace(/sk-[\w-]+/g,'[redacted]').slice(0,300);
      // Store errors on the run, but never echo provider response bodies to users.
      return { text: /daily AI budget|monthly AI budget/.test(detail)?(lang==='ar'?'نور غير متاح مؤقتًا للأسئلة. يمكنك متابعة العمل على الحالات.':'Noor is temporarily unavailable for questions. You can continue working on cases.'):/context is too large/.test(detail)?detail:FAIL_CLOSED_TEXT[lang], outcome: "failed", toolCalls: calls, ...usage(), error:detail };
    }
    inputTokens += res.usage?.input_tokens ?? 0; outputTokens += res.usage?.output_tokens ?? 0; model = res.model ?? model;
    cacheReadTokens+=res.usage?.cache_read_input_tokens??0;cacheCreationTokens+=res.usage?.cache_creation_input_tokens??0;estimatedCostUsd+=usageCost(res.usage??{});

    if (res.stop_reason === "refusal") return { text: FAIL_CLOSED_TEXT[lang], outcome: "refused", toolCalls: calls, ...usage(),error:'Provider refusal' };
    if (res.stop_reason === "max_tokens") return { text: FAIL_CLOSED_TEXT[lang], outcome: "failed", toolCalls: calls, ...usage(),error:'Output token limit reached' };
    if (res.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: res.content as Array<Record<string, unknown>> }); continue; }

    const uses = res.content.filter((b): b is LlmToolUseBlock => b.type === "tool_use");
    if (!uses.length) return { text: textOf(res), outcome: escalated ? "escalated" : "completed", toolCalls: calls, ...usage() };

    messages.push({ role: "assistant", content: res.content as Array<Record<string, unknown>> });
    const results: Array<Record<string, unknown>> = [];
    for (const u of uses) {
      const seq = calls.length + 1;
      if (calls.length >= o.limits.maxToolCalls) {
        capHit = true;
        results.push({ type: "tool_result", tool_use_id: u.id, content: "Tool call limit reached for this run. Escalate and stop.", is_error: true });
        continue;
      }
      const started = Date.now();
      let output: unknown, error: string | undefined;
      try {
        if(!defs.some(d=>d.name===u.name)||capHit) throw new Error('Tool is not enabled for this request');
        output = await withTimeout(o.executor.execute(u.name, u.input, o.ctx), o.limits.toolTimeoutMs, u.name);
      }
      catch (e) { error = (e as Error).message; }
      const durationMs = Date.now() - started;
      calls.push({ name: u.name, input: u.input, output, error, durationMs });
      if (o.audit) await o.audit.toolCall(seq, u.name, u.input, output, durationMs, error);
      if (u.name === "escalate_to_human" && !error) escalated = true;
      results.push(error
        ? { type: "tool_result", tool_use_id: u.id, content: `Tool error: ${error}`, is_error: true }
        : { type: "tool_result", tool_use_id: u.id, content: JSON.stringify(output ?? null) });
    }
    messages.push({ role: "user", content: results });
    if (capHit) { messages.push({ role: "user", content: "Compose your final reply now; no further tools are available." }); }
  }
  return { text: FAIL_CLOSED_TEXT[lang], outcome: "killed", toolCalls: calls, ...usage(),error:'Run tool limit reached' };
}
