import { test } from "node:test";
import assert from "node:assert/strict";
import { runAgent, FAIL_CLOSED_TEXT } from "../runner.ts";
import { toolDefinitions } from "../tools/index.ts";
import type { LlmClient, LlmResponse, ToolContext, ToolExecutor } from "../lib/types.ts";

/* Integration flows: the real runner + real tool definitions, with the tool
   layer replaced by fixtures and the model replaced by a scripted stub. */
const ctx = (): ToolContext => ({ caller: { kind: "user", userId: "u", role: "lab", labId: "L", language: "en", timezone: "Asia/Muscat" }, db: {} as never, admin: {} as never, shadow: true, now: new Date("2026-09-11T06:00:00Z"), traceId: "t", wouldHave: [] });
const stub = (script: LlmResponse[]): LlmClient => { let i = 0; return { async complete() { return script[Math.min(i++, script.length - 1)]; } }; };
const fixtures = (map: Record<string, (input: unknown) => unknown>): ToolExecutor => ({ definitions: toolDefinitions, async execute(name, input) { if (!(name in map)) throw new Error(`unexpected tool ${name}`); return map[name](input); } });
const limits = { maxToolCalls: 8, toolTimeoutMs: 1000, maxTokens: 4000 };
const tu = (id: string, name: string, input: unknown): LlmResponse => ({ content: [{ type: "tool_use", id, name, input }], stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 }, model: "stub" });
const txt = (t: string): LlmResponse => ({ content: [{ type: "text", text: t }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 }, model: "stub" });

test("Ex1 intake: model asks one question via request_clarification", async () => {
  const calls: unknown[] = [];
  const r = await runAgent({ trigger: "prescription_submitted", caller: ctx().caller, systemPrompt: "s", userMessage: "issues", toolNames: ["request_clarification"], executor: fixtures({ request_clarification: (i) => { calls.push(i); return { clarification_id: "clr", asked_at: "x" }; } }),
    llm: stub([tu("1", "request_clarification", { case_id: "C-MTZ4Q7K2AA", issue: { field: "shade", severity: "blocking", detail: "d" }, question: "الحالة C-MTZ4Q7K2AA: يرجى تحديد درجة اللون للسن 24.", language: "ar" }), txt("تم طلب توضيح واحد.")]), ctx: ctx(), limits, purpose: "phrase" });
  assert.equal(r.outcome, "completed"); assert.equal(calls.length, 1); assert.equal(r.toolCalls[0].name, "request_clarification");
});
test("4.4 cross-tenant: tool returns null, answer must not confirm existence", async () => {
  const r = await runAgent({ trigger: "user_question", caller: ctx().caller, systemPrompt: "s", userMessage: "q", executor: fixtures({ get_case: () => null }),
    llm: stub([tu("1", "get_case", { case_id: "C-OTHER" }), txt("Case C-OTHER is not visible to this account or does not exist.")]), ctx: ctx(), limits, purpose: "answer" });
  assert.equal(r.outcome, "completed"); assert.equal(r.toolCalls[0].output, null); assert.match(r.text, /not visible to this account or does not exist/);
});
test("7.2 fee dispute escalates and reports the reference", async () => {
  const r = await runAgent({ trigger: "user_question", caller: ctx().caller, systemPrompt: "s", userMessage: "This invoice is wrong", executor: fixtures({ escalate_to_human: () => ({ escalation_id: "esc_2b7e", assigned_to_name: "Tony" }) }),
    llm: stub([tu("1", "escalate_to_human", { category: "fee_dispute", summary: "Invoice disputed by the clinic user.", context: { stage: "WORK_COMPLETE", timeline: [], parties: ["clinic"], attempted: [], stop_reason: "fee dispute" } }), txt("Escalated to Tony. Reference esc_2b7e.")]), ctx: ctx(), limits, purpose: "answer" });
  assert.equal(r.outcome, "escalated"); assert.match(r.text, /esc_2b7e/);
});
test("7.7 tool-call cap is enforced in code, then the run ends", async () => {
  let n = 0;
  const r = await runAgent({ trigger: "user_question", caller: ctx().caller, systemPrompt: "s", userMessage: "q", executor: fixtures({ get_case: () => ({ ok: ++n }) }),
    llm: { async complete(req) { return req.tools.length ? tu(`i${n}`, "get_case", { case_id: "C-1" }) : txt("Stopped at the limit."); } }, ctx: ctx(), limits: { ...limits, maxToolCalls: 3 }, purpose: "answer" });
  assert.equal(r.toolCalls.length, 3); assert.equal(r.outcome, "completed"); assert.match(r.text, /Stopped/);
});
test("4.8 tool error is reported, never fabricated; refusal fails closed", async () => {
  const r1 = await runAgent({ trigger: "user_question", caller: ctx().caller, systemPrompt: "s", userMessage: "q", executor: fixtures({ get_case: () => { throw new Error("timeout"); } }),
    llm: stub([tu("1", "get_case", { case_id: "C-1" }), txt("I couldn't complete that request.")]), ctx: ctx(), limits, purpose: "answer" });
  assert.equal(r1.toolCalls[0].error, "timeout");
  const r2 = await runAgent({ trigger: "user_question", caller: ctx().caller, systemPrompt: "s", userMessage: "q", executor: fixtures({}), llm: stub([{ content: [], stop_reason: "refusal" }]), ctx: ctx(), limits, purpose: "answer" });
  assert.equal(r2.outcome, "refused"); assert.equal(r2.text, FAIL_CLOSED_TEXT.en);
});
test("4.12 the runner exposes exactly the requested tools to the model", async () => {
  let seen: string[] = [];
  await runAgent({ trigger: "user_question", caller: ctx().caller, systemPrompt: "s", userMessage: "q", toolNames: ["get_case", "list_cases"], executor: fixtures({}), llm: { async complete(req) { seen = req.tools.map((t) => t.name); return txt("ok"); } }, ctx: ctx(), limits, purpose: "answer" });
  assert.deepEqual(seen, ["get_case", "list_cases"]);
});
