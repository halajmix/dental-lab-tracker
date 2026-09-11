import type { ToolContext, ToolDefinition, ToolExecutor } from "../lib/types.ts";
import schemas from "./schemas.json" with { type: "json" };
import { getCase } from "./get_case.ts";
import { listCases } from "./list_cases.ts";
import { validatePrescriptionTool } from "./validate_prescription.ts";
import { requestClarification } from "./request_clarification.ts";
import { getTurnaroundBenchmark } from "./get_turnaround_benchmark.ts";
import { flagCaseRisk } from "./flag_case_risk.ts";
import { sendStatusUpdate } from "./send_status_update.ts";
import { recordRemakeReason } from "./record_remake_reason.ts";
import { getRemakePatterns } from "./get_remake_patterns.ts";
import { composeDailyBrief } from "./compose_daily_brief.ts";
import { escalateToHuman } from "./escalate_to_human.ts";
import { addCaseNote } from "./add_case_note.ts";

type Impl = (input: any, ctx: ToolContext) => Promise<unknown>;

/* Registry. The model sees definitions from schemas.json (the committed copy
   of docs/agents/noor/03-tools.json — CI asserts they are identical) with
   strict:true, so tool inputs are schema-valid before they reach an impl. */
const IMPL: Record<string, Impl> = {
  get_case: getCase, list_cases: listCases, validate_prescription: validatePrescriptionTool,
  request_clarification: requestClarification, get_turnaround_benchmark: getTurnaroundBenchmark,
  flag_case_risk: flagCaseRisk, send_status_update: sendStatusUpdate, record_remake_reason: recordRemakeReason,
  get_remake_patterns: getRemakePatterns, compose_daily_brief: composeDailyBrief,
  escalate_to_human: escalateToHuman, add_case_note: addCaseNote,
};
export const WRITE_TOOLS = new Set(["request_clarification", "flag_case_risk", "send_status_update", "record_remake_reason", "escalate_to_human", "add_case_note"]);

/** Inline the $defs so each tool schema is self-contained (Anthropic tools
    take one input_schema each; $ref to a sibling document does not resolve). */
function inlineRefs(node: unknown, defs: Record<string, unknown>): unknown {
  if (Array.isArray(node)) return node.map((n) => inlineRefs(n, defs));
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (typeof o.$ref === "string" && o.$ref.startsWith("#/$defs/")) return inlineRefs(defs[o.$ref.slice(8)], defs);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) if (k !== "$comment") out[k] = inlineRefs(v, defs);
    return out;
  }
  return node;
}

export function toolDefinitions(names?: string[]): ToolDefinition[] {
  const defs = (schemas as { $defs: Record<string, unknown> }).$defs;
  return (schemas as { tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }> }).tools
    .filter((t) => !names || names.includes(t.name))
    .map((t) => ({ name: t.name, description: t.description, input_schema: inlineRefs(t.input_schema, defs) as Record<string, unknown> }));
}

export const liveExecutor: ToolExecutor = {
  definitions: toolDefinitions,
  async execute(name, input, ctx) {
    const impl = IMPL[name];
    if (!impl) throw new Error(`unknown tool ${name}`);
    return impl(input, ctx);
  },
};
