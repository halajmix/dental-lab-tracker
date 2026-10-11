import Anthropic from "npm:@anthropic-ai/sdk";
import type { LlmClient, LlmRequest, LlmResponse } from "./lib/types.ts";
import {providerSchema} from './lib/tool-schema.ts';

/* Anthropic Messages API adapter. The runner never sees the SDK: it works
   with the small LlmResponse shape so the Node tests can stub it.
   - backend validates every input before an implementation runs
   - single-tool phrasing uses strict generation; conversational tool sets
     use regular generation to avoid cold grammar-compilation timeouts
   - both pilot purposes use Haiku 4.5 for predictable usage accounting
   - no SDK retries: each billable attempt must have a budget reservation
   - system prompt cached (stable prefix); volatile context goes in messages */
export function createLlm(opts: { apiKey: string; modelAnswer: string; modelPhrase: string; effort: "low" | "medium" | "high"; timeoutMs: number }): LlmClient {
  if (![opts.modelAnswer,opts.modelPhrase].every(m=>/^claude-haiku-4-5(?:-20251001)?$/.test(m))) throw new Error('Pilot cost accounting requires Haiku 4.5');
  const client = new Anthropic({ apiKey: opts.apiKey, timeout: opts.timeoutMs, maxRetries: 0 });
  return {
    async complete(req: LlmRequest): Promise<LlmResponse> {
      const tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: providerSchema(t.input_schema) as Anthropic.Tool["input_schema"], strict: req.purpose==='phrase' }));
      const system: Anthropic.TextBlockParam[] = [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }];
      const messages = req.messages as Anthropic.MessageParam[];
      const common = { max_tokens: req.maxTokens, system, messages, ...(tools.length ? { tools, tool_choice: { type: "auto" as const } } : {}) };
      const res = await client.messages.create({ model: req.purpose==='answer'?opts.modelAnswer:opts.modelPhrase, ...common });
      return {
        content: res.content as unknown as LlmResponse["content"],
        stop_reason: (res.stop_reason ?? "end_turn") as LlmResponse["stop_reason"],
        usage: { input_tokens: res.usage?.input_tokens, output_tokens: res.usage?.output_tokens,
          cache_read_input_tokens: res.usage?.cache_read_input_tokens??0, cache_creation_input_tokens: res.usage?.cache_creation_input_tokens??0 },
        model: res.model,
      };
    },
  };
}
