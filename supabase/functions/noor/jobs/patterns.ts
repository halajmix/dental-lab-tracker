import type { Db, ToolContext } from "../lib/types.ts";
import { getRemakePatterns } from "../tools/get_remake_patterns.ts";
import { observationText } from "../lib/patterns.ts";
import { escalateToHuman } from "../tools/escalate_to_human.ts";
import { claimIdempotency } from "../gate.ts";

/* Remake Spotter, weekly. Observations go to the lab manager only. */
export async function runPatterns(admin: Db, makeCtx: (labId: string) => ToolContext, periodDays: 30 | 90 | 180 = 90): Promise<{ labs: number; observations: number }> {
  const { data: labs } = await admin.from("labs").select("id,name,language").eq("noor_enabled", true);
  let observations = 0;
  for (const lab of (labs ?? []) as Array<{ id: string; name: string; language: "en" | "ar" }>) {
    const ctx = makeCtx(lab.id);
    const { patterns } = await getRemakePatterns({ lab_id: lab.id, period_days: periodDays }, ctx);
    for (const p of patterns) {
      const key = `pattern:${lab.id}:${p.clinic_name}:${p.reason_code}:${ctx.now.toISOString().slice(0, 7)}`;
      if (!ctx.shadow && !(await claimIdempotency(admin, key))) continue;
      await escalateToHuman({
        category: "pattern_observation", language: lab.language ?? "en",
        summary: observationText(p, periodDays, lab.language ?? "en"),
        context: { stage: "WORK_IN_PROGRESS", timeline: [`${periodDays}-day window ending ${ctx.now.toISOString().slice(0, 10)}`], parties: ["lab"], attempted: ["get_remake_patterns"], stop_reason: "Pattern above threshold; for the lab manager's judgement only." },
      }, ctx);
      observations++;
    }
  }
  return { labs: (labs ?? []).length, observations };
}
