import type { ToolContext } from "../lib/types.ts";
import { composeBrief } from "../lib/brief.ts";
import { listCases } from "./list_cases.ts";

export async function composeDailyBrief(input: { lab_id?: string; date: string }, ctx: ToolContext) {
  const labId=input.lab_id??(ctx.caller.kind==='user'?ctx.caller.labId:ctx.caller.jobLabId);
  if(!labId) throw new Error('Brief has no lab scope');
  if(ctx.caller.kind==="user" && ctx.caller.labId!==labId) throw new Error("Brief is not visible to this account");
  if (ctx.caller.kind === "system" && ctx.caller.jobLabId !== labId) throw new Error("job is not scoped to this lab");
  const items=[];let cursor:string|null=null;
  do { const page=await listCases({stage:["STILL_AT_CLINIC","PICKED_UP_BY_LAB","WORK_IN_PROGRESS","WORK_COMPLETE"],limit:50,...(cursor?{cursor}:{})},ctx);items.push(...page.items);cursor=page.next_cursor;}while(cursor);
  const [esc, cancel] = await Promise.all([
    ctx.admin.from("escalations").select("case_id,category").eq("lab_id", labId).eq("status", "open"),
    ctx.admin.from("cases").select("id").eq("lab_id", labId).eq("cancel_status", "requested"),
  ]);
  if(esc.error||cancel.error) throw new Error('Brief data could not be read');
  return composeBrief({ today: input.date, openCases: items, openEscalations: esc.data ?? [], cancellationRequests: (cancel.data ?? []).map((c: { id: string }) => c.id) });
}
