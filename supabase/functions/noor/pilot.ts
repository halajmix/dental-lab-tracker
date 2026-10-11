import type { Db, Trigger, ToolContext,CaseRow,CaseSummary } from './lib/types.ts';
import {benchmark} from './lib/benchmark.ts';
export type PilotSettings = { lab_id: string; role_modes: Record<string,string>; emails_enabled: boolean; default_tat_days: number; clinic_tats: Record<string,number>; daily_budget_usd: number };
export async function pilotSettings(db: Db, labId?: string|null): Promise<PilotSettings|null> {
  if (!labId) return null;
  const {data,error}=await db.from('noor_pilot_settings').select('*').eq('lab_id',labId).maybeSingle();
  if(error) throw new Error('Noor pilot settings could not be read');
  return data;
}
export function isShadow(globalShadow: boolean, settings: PilotSettings|null, trigger: Trigger): boolean {
  return globalShadow || settings?.role_modes[trigger] !== 'live';
}
export function pilotTat(settings: PilotSettings|null, clinicId: string, fallback: number): number {
  return settings ? Number(settings.clinic_tats[clinicId] ?? settings.default_tat_days) : fallback;
}
export const emailAllowed = (ctx: ToolContext) => ctx.emailsEnabled === true;
export function pilotSummary(row:CaseRow,summary:CaseSummary,settings:PilotSettings|null|undefined,now:Date):CaseSummary {
  if(!settings) return summary;
  const openRoundAt=summary.open_rounds.map(r=>r.created_at).sort().at(-1)??null;
  const b=benchmark({row,procedureTats:{},labTat:pilotTat(settings,row.clinic_id,6),lastActivityAt:null,openRoundAt,now,staleDays:5,minimumTatPromise:true});
  return {...summary,promise_date:b.promise_date};
}
