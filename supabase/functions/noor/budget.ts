import type { Db,LlmClient,LlmRequest } from './lib/types.ts';
export function usageCost(u: {input_tokens?:number;output_tokens?:number;cache_read_input_tokens?:number;cache_creation_input_tokens?:number}): number {
  return ((u.input_tokens??0)+(u.output_tokens??0)*5+(u.cache_read_input_tokens??0)*0.1+(u.cache_creation_input_tokens??0)*1.25)/1e6;
}
// Both pilot purposes use Haiku 4.5. Byte count is a conservative input token
// upper bound, plus template overhead; reserve maximum output before each call.
export function reserveCost(req:LlmRequest):number {
  const bytes=new TextEncoder().encode(JSON.stringify({system:req.system,messages:req.messages,tools:req.tools})).length;
  if(bytes>120000) throw new Error('Question context is too large; ask about fewer cases.');
  return ((bytes+4096)*2+req.maxTokens*5)/1e6;
}
export function budgetedLlm(llm:LlmClient,db:Db,labId:string,day:string,trace:string):LlmClient {
  return {async complete(req) {
    if(!db.rpc) throw new Error("Budget service unavailable");
    const amount=reserveCost(req);
    const {data,error}=await db.rpc('noor_reserve_budget',{p_lab:labId,p_day:day,p_amount:amount,p_trace:trace});
    if(error) throw new Error('AI budget could not be checked.');
    if(!data) throw new Error('Noor has reached its daily AI budget. Questions resume tomorrow; case monitoring remains active.');
    // An unknown provider failure retains the reservation: never assume a failed
    // response was free. This makes budget enforcement conservative.
    const response=await llm.complete(req);
    const {error:settleError}=await db.rpc('noor_settle_budget',{p_reservation:data,p_actual:usageCost(response.usage??{})});
    if(settleError) throw new Error('AI usage could not be recorded.');
    return response;
  }};
}
