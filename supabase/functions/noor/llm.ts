import Anthropic from "npm:@anthropic-ai/sdk";
import type { LlmClient, LlmRequest, LlmResponse } from "./lib/types.ts";

/* Anthropic Messages API adapter. The runner never sees the SDK: it works
   with the small LlmResponse shape so the Node tests can stub it.
   - strict tools: inputs are schema-valid before an impl runs
   - answering model: adaptive thinking (default on Opus 5) with effort as a
     cost lever; server-side refusal fallbacks enabled per current guidance
   - phrasing model: cheap tier, no tools needed beyond the one it must call
   - system prompt cached (stable prefix); volatile context goes in messages */
export function createLlm(opts: { apiKey: string; modelAnswer: string; modelPhrase: string; effort: "low" | "medium" | "high"; timeoutMs: number }): LlmClient {
  const client = new Anthropic({ apiKey: opts.apiKey, timeout: opts.timeoutMs, maxRetries: 1 });
  return {
    async complete(req: LlmRequest): Promise<LlmResponse> {
      const tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as Anthropic.Tool["input_schema"], strict: true }));
      const system: Anthropic.TextBlockParam[] = [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }];
      const messages = req.messages as Anthropic.MessageParam[];
      const common = { max_tokens: req.maxTokens, system, messages, ...(tools.length ? { tools, tool_choice: { type: "auto" as const } } : {}) };
      const res = req.purpose === "answer"
        ? await client.beta.messages.create({ model: opts.modelAnswer, ...common, output_config: { effort: opts.effort }, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
        : await client.messages.create({ model: opts.modelPhrase, ...common });
      return {
        content: res.content as unknown as LlmResponse["content"],
        stop_reason: (res.stop_reason ?? "end_turn") as LlmResponse["stop_reason"],
        usage: { input_tokens: res.usage?.input_tokens, output_tokens: res.usage?.output_tokens },
        model: res.model,
      };
    },
  };
}
