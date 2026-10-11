import type { Language, ToolContext } from "../lib/types.ts";
import type { TemplateId } from "../lib/templates.ts";
/** The existing case-notify function owns all stage emails. */
export async function sendStatusUpdate(_input: {case_id:string;template_id:TemplateId;language?:Language;idempotency_key?:string},_ctx:ToolContext) {
  return {sent:false,skipped_reason:"Stage emails are handled by case-notify",resend_id:null};
}
