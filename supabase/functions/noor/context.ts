import type { CaseSummary, Issue } from "./lib/types.ts";
import { wrapData } from "./lib/redact.ts";

/* What the model is allowed to see, per trigger. Keep in step with the table
   in docs/agents/noor/02-architecture.md §Context assembly. */

export function intakeContext(summary: CaseSummary, issues: Issue[]): string {
  const r = summary.restorations.map((x, i) => `restoration[${i}]: ${[x.category, x.material, x.shade_guide, `shade: ${x.shade ?? "(empty)"}`, `teeth: ${x.teeth.join(", ") || x.arches || "—"}`].join(" · ")}`).join("\n");
  return wrapData("case", `case_id: ${summary.case_id}\nstage: ${summary.stage}\npromise_date: ${summary.promise_date ?? "—"}\nneed_by_date: ${summary.need_by_date ?? "—"}\n${r}`) + "\n" +
    wrapData("issues", issues) + "\nWrite ONE question for the dentist about the first blocking issue and call request_clarification. If issues is empty output PASS.";
}

export function questionContext(question: string, caseId?: string | null): string {
  // A question asked from inside a case drawer carries that case id so "where
  // is it?" needs no id in the text. The id is data, not instruction.
  const focus = caseId ? wrapData("case_in_view", caseId) + "\n" : "";
  return focus + wrapData("question", question.slice(0, 2000)) + "\nAnswer from tool results only." + (caseId ? " If the question is about the case in view, start with get_case for it." : "");
}

export function remakeContext(caseId: string, roundId: string | undefined, instructions: string): string {
  return wrapData("remake", { case_id: caseId, round_id: roundId ?? null, instructions: instructions.slice(0, 1500) }) +
    "\nMap the stated reason to reason_class and reason_code and call record_remake_reason. Use 'other' when nothing fits. Keep the text.";
}

export function escalationSummaryContext(summary: CaseSummary, reason: string, timeline: string[]): string {
  return wrapData("case", { case_id: summary.case_id, stage: summary.stage, promise_date: summary.promise_date, need_by_date: summary.need_by_date, timeline, reason }) +
    "\nWrite a two-sentence factual summary for the lab manager. Dates and case id exactly as given. No advice, no blame.";
}

export function patternsContext(observations: string[]): string {
  return wrapData("observations", observations) + "\nRestate these as neutral observations for the lab manager. Counts and periods only. No fault, no intent.";
}
