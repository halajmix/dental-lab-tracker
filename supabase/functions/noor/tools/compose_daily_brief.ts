import type { ToolContext } from "../lib/types.ts";
import { composeBrief } from "../lib/brief.ts";
import { listCases } from "./list_cases.ts";

export async function composeDailyBrief(input: { lab_id: string; date: string }, ctx: ToolContext) {
  if (ctx.caller.kind === "system" && ctx.caller.jobLabId !== input.lab_id) throw new Error("job is not scoped to this lab");
  const open = await listCases({ stage: ["STILL_AT_CLINIC", "PICKED_UP_BY_LAB", "WORK_IN_PROGRESS", "WORK_COMPLETE"], limit: 50 }, ctx);
  const [esc, cancel] = await Promise.all([
    ctx.admin.from("escalations").select("case_id,category").eq("lab_id", input.lab_id).eq("status", "open"),
    ctx.admin.from("cases").select("id").eq("lab_id", input.lab_id).eq("cancel_status", "requested"),
  ]);
  return composeBrief({ today: input.date, openCases: open.items, openEscalations: esc.data ?? [], cancellationRequests: (cancel.data ?? []).map((c: { id: string }) => c.id) });
}
