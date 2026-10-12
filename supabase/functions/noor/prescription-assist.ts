import {RX_DRAFT_PROMPT,normalizeRxDraft} from '../_shared/rxDraft.ts';
import {createLlm} from './llm.ts';
import {budgetedLlm,usageCost} from './budget.ts';
import {makeAudit} from './audit.ts';
import {withinRateLimit} from './gate.ts';
import {localParts} from './lib/brief.ts';
import type {NoorEnv} from './env.ts';
import type {Caller,Db} from './lib/types.ts';
export async function prescriptionAssist(body:any,caller:Caller,db:Db,admin:Db,env:NoorEnv,now:Date,traceId:string) {
  const response=(data:unknown,status=200)=>({data,status});
  if(caller.kind!=='user'||caller.role!=='dentist')return response({error:'Prescription assistance is for active clinic accounts.'},403);
  if(!/^[0-9a-f-]{36}$/i.test(body.clinic_id??'')||!/^[0-9a-f-]{36}$/i.test(body.lab_id??''))return response({error:'Select a clinic and lab first.'},400);
  if(!db.rpc)return response({error:'Prescription access could not be checked.'},503);
  const [role,access,flags,lab,budget,pilot]=await Promise.all([
    db.rpc('my_clinic_role',{target:body.clinic_id}),db.rpc('clinic_can_use_lab',{p_clinic:body.clinic_id,p_lab:body.lab_id}),
    admin.from('feature_flags').select('key,enabled').in('key',['noor.global','noor.prescription_assist']),
    admin.from('labs').select('status').eq('id',body.lab_id).maybeSingle(),admin.rpc!('noor_platform_budget_status'),admin.from('noor_pilot_settings').select('lab_id').eq('lab_id',body.lab_id).maybeSingle(),
  ]);
  if(role.error||access.error)return response({error:'Prescription access could not be checked.'},503);
  if(!['doctor','admin'].includes(role.data)||access.data!==true||lab.data?.status!=='active')return response({error:'You cannot prepare a prescription for this clinic and lab.'},403);
  if(flags.error||budget.error||pilot.error||!budget.data)return response({error:'Noor budget or availability could not be checked.'},503);
  const enabled=!!pilot.data&&['noor.global','noor.prescription_assist'].every(key=>flags.data?.some((f:any)=>f.key===key&&f.enabled));
  if(body.action==='prescription_status')return response({enabled,platform_budget:budget.data});
  if(!enabled)return response({error:'Noor prescription assistance is paused. You can still fill the form manually.'},503);
  if(typeof body.text!=='string'||!body.text.trim()||body.text.length>4000||!['FDI','Universal'].includes(body.notation))return response({error:'Enter up to 4,000 characters of treatment instructions and select the tooth notation.'},400);
  if(!env.anthropicKey)return response({error:'Noor is temporarily unavailable.'},503);
  if(!await withinRateLimit(admin,`user:${caller.userId}`,env.userPerHour,3600000,now))return response({error:'Please wait before asking Noor again (20 requests per hour).'},429);
  if(!await withinRateLimit(admin,`rx-clinic:${body.clinic_id}`,200,86400000,now))return response({error:'This clinic has reached its daily request limit.'},429);
  const audit=makeAudit(admin,traceId);
  await audit.start({trigger:'prescription_draft',labId:body.lab_id,clinicId:body.clinic_id,userId:caller.userId,shadow:false});
  let usage:any=null,model:string|null=null;
  try {
    const llm=budgetedLlm(createLlm({apiKey:env.anthropicKey,modelAnswer:env.modelAnswer,modelPhrase:env.modelPhrase,effort:env.effort,timeoutMs:env.runTimeoutMs}),admin,body.lab_id,localParts(now,'Asia/Muscat').date,traceId);
    const r=await llm.complete({purpose:'answer',system:RX_DRAFT_PROMPT+` Current Oman date: ${localParts(now,'Asia/Muscat').date}.`,messages:[{role:'user',content:JSON.stringify({notation:body.notation,instructions:body.text})}],tools:[],maxTokens:2200});
    usage=r.usage;model=r.model??null;
    if(r.stop_reason!=='end_turn')throw Error('Noor could not complete the draft. Try a shorter instruction.');
    const text=r.content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('').trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
    const draft=normalizeRxDraft(JSON.parse(text));
    await audit.finish({outcome:'completed',model,inputTokens:usage?.input_tokens,outputTokens:usage?.output_tokens,cacheReadTokens:usage?.cache_read_input_tokens,cacheCreationTokens:usage?.cache_creation_input_tokens,estimatedCostUsd:usageCost(usage??{})});
    // No prescription contents in audit logs, no patient fields, no case writes.
    return response({ok:true,trace_id:traceId,draft,platform_budget:(await admin.rpc!('noor_platform_budget_status')).data});
  }catch(e){
    const detail=String((e as Error).message).slice(0,300);
    const safeReason=(e as any).status===401?`Provider authentication failed: ${/invalid.*(?:api.key|token)/i.test(detail)?'invalid API credential':/expir/i.test(detail)?'expired API credential':'credential rejected'}`:/monthly AI budget|daily AI budget|AI budget could not|AI usage could not|Budget service unavailable/.test(detail)?detail:`Prescription draft failed: ${(e as Error).name}${(e as any).status?` (HTTP ${(e as any).status})`:''}`;
    await audit.finish({outcome:'failed',model,inputTokens:usage?.input_tokens,outputTokens:usage?.output_tokens,cacheReadTokens:usage?.cache_read_input_tokens,cacheCreationTokens:usage?.cache_creation_input_tokens,estimatedCostUsd:usageCost(usage??{}),error:safeReason});
    return response({error:/monthly AI budget|daily AI budget/.test(detail)?detail:'Noor could not prepare that draft. Try again, or fill the form manually.'},503);
  }
}
