import type { Caller, LlmClient, LlmResponse, LlmToolUseBlock, ToolContext, ToolDefinition, ToolExecutor, Trigger } from "./lib/types.ts";
import type { AuditSink } from "./audit.ts";

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
}

export const FAIL_CLOSED_TEXT: Record<"en" | "ar", string> = {
  en: "I couldn't complete that request safely. Nothing has been changed. A person has been notified.",
  ar: "تعذّر عليّ إتمام هذا الطلب بأمان. لم يُغيَّر شيء، وقد أُبلغ أحد المسؤولين.",
};

const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
  new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms); p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); }); });

const textOf = (r: LlmResponse): string => r.content.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text).join("").trim();

export async function runAgent(o: RunOptions): Promise<RunResult> {
  const defs: ToolDefinition[] = o.executor.definitions(o.toolNames);
  const messages: RunOptions extends never ? never : Array<{ role: "user" | "assistant"; content: string | Array<Record<string, unknown>> }> = [{ role: "user", content: o.userMessage }];
  const calls: ToolCallRecord[] = [];
  let inputTokens = 0, outputTokens = 0, model: string | null = null, escalated = false, capHit = false;
  const lang = o.caller.language;

  for (let iter = 0; iter < o.limits.maxToolCalls + 2; iter++) {
    let res: LlmResponse;
    try {
      res = await o.llm.complete({ purpose: o.purpose, system: o.systemPrompt, messages, tools: capHit ? [] : defs, maxTokens: o.limits.maxTokens });
    } catch (e) {
      return { text: FAIL_CLOSED_TEXT[lang], outcome: "failed", toolCalls: calls, inputTokens, outputTokens, model, };
    }
    inputTokens += res.usage?.input_tokens ?? 0; outputTokens += res.usage?.output_tokens ?? 0; model = res.model ?? model;

    if (res.stop_reason === "refusal") return { text: FAIL_CLOSED_TEXT[lang], outcome: "refused", toolCalls: calls, inputTokens, outputTokens, model };
    if (res.stop_reason === "max_tokens") return { text: FAIL_CLOSED_TEXT[lang], outcome: "failed", toolCalls: calls, inputTokens, outputTokens, model };
    if (res.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: res.content as Array<Record<string, unknown>> }); continue; }

    const uses = res.content.filter((b): b is LlmToolUseBlock => b.type === "tool_use");
    if (!uses.length) return { text: textOf(res), outcome: escalated ? "escalated" : "completed", toolCalls: calls, inputTokens, outputTokens, model };

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
      try { output = await withTimeout(o.executor.execute(u.name, u.input, o.ctx), o.limits.toolTimeoutMs, u.name); }
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
  return { text: FAIL_CLOSED_TEXT[lang], outcome: "killed", toolCalls: calls, inputTokens, outputTokens, model };
}
