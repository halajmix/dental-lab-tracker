import type { Issue, ToolContext, CaseRow } from "../lib/types.ts";
import { validatePrescription } from "../lib/validate.ts";

export async function validatePrescriptionTool(input: { case_id: string }, ctx: ToolContext): Promise<{ issues: Issue[] }> {
  const { data, error } = await ctx.admin.from("cases").select("prescription,appointment_date,lab_shade").eq("id", input.case_id).maybeSingle();
  if (error) throw new Error(`validate_prescription: ${error.message}`);
  if (!data) return { issues: [] };
  return { issues: validatePrescription(data as Pick<CaseRow, "prescription" | "appointment_date" | "lab_shade">) };
}
