import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pilotTat,isShadow,emailAllowed} from '../pilot.ts';
import {usageCost,budgetedLlm} from '../budget.ts';
import {runAgent} from '../runner.ts';
import {sendStatusUpdate} from '../tools/send_status_update.ts';
import {composeDailyBrief} from '../tools/compose_daily_brief.ts';
import {benchmark} from '../lib/benchmark.ts';
import {providerSchema,validateToolInput} from '../lib/tool-schema.ts';
import {toolDefinitions} from '../tools/index.ts';
const pilot={lab_id:'L',role_modes:{user_question:'live',scheduled_watch:'live'},emails_enabled:false,default_tat_days:6,clinic_tats:{health:13},daily_budget_usd:2};
test('provider schemas remove unsupported constraints while backend keeps bounds',()=>{
 const definition=toolDefinitions(['list_cases'])[0];
 const adapted=providerSchema(definition.input_schema);
 assert.equal(adapted.properties.limit.minimum,undefined);
 assert.equal(adapted.properties.limit.maximum,undefined);
 assert.match(adapted.properties.limit.description,/maximum: 50/);
 assert.throws(()=>validateToolInput(definition.input_schema,{limit:51}),/maximum/);
 assert.throws(()=>validateToolInput(definition.input_schema,{limit:0}),/minimum/);
 assert.doesNotThrow(()=>validateToolInput(definition.input_schema,{limit:50}));
});
test('pilot ignores an old five-day default but preserves later explicit dates',()=>{
 const row={id:'C-TEST0001',stage_index:2,created_date:'2026-10-01',prescription:{estReady:'2026-10-06'},appointment_date:null};
 const settings={row,minimumTatPromise:true,labTat:13,procedureTats:{},lastActivityAt:'2026-10-10T07:00:00Z',now:new Date('2026-10-11T07:00:00Z'),staleDays:5};
 assert.equal(benchmark(settings as never).promise_date,'2026-10-14');
 assert.equal(benchmark(settings as never).verdict,'on_track');
 assert.equal(benchmark({...settings,row:{...row,stage_index:1}} as never).verdict,'on_track');
 assert.equal(benchmark({...settings,row:{...row,prescription:{estReady:'2026-10-20'}}} as never).promise_date,'2026-10-20');
});
test('pilot timings and roles: 6 normal, 13 health; global shadow overrides live',()=>{
 assert.equal(pilotTat(pilot,'normal',5),6);assert.equal(pilotTat(pilot,'health',5),13);
 assert.equal(isShadow(false,pilot,'user_question'),false);assert.equal(isShadow(true,pilot,'user_question'),true);
 assert.equal(isShadow(false,pilot,'prescription_submitted'),true);assert.equal(isShadow(false,null,'user_question'),true);
 assert.equal(emailAllowed({emailsEnabled:false} as never),false);
});
test('stage emails never duplicate case-notify, including an enabled-email context',async()=>{
 const r=await sendStatusUpdate({case_id:'C-TEST0001',template_id:'work_complete' as never},{emailsEnabled:true} as never);
 assert.equal(r.sent,false);assert.match(r.skipped_reason,/case-notify/);
});
test('received case with open round is live work; completed case without round is done',()=>{
 const row={id:'C-TEST0001',stage_index:4,created_date:'2026-09-01',prescription:{},appointment_date:null};
 const settings={row,labTat:13,procedureTats:{},lastActivityAt:'2026-10-01T07:00:00Z',now:new Date('2026-10-11T07:00:00Z'),staleDays:5};
 assert.equal(benchmark({...settings,openRoundAt:'2026-10-01T07:00:00Z'} as never).promise_date,'2026-10-14');
 assert.equal(benchmark(settings as never).verdict,'done');
});
test('cache creation, cache reads, input and output all contribute to cost',()=>{
 assert.equal(usageCost({input_tokens:1000,output_tokens:100,cache_read_input_tokens:1000,cache_creation_input_tokens:1000}),0.00285);
});
test('budget denial prevents the provider call; provider failure retains its reservation',async()=>{
 let providerCalls=0,settlements=0;
 const req={system:'s',messages:[],tools:[],maxTokens:100,purpose:'answer'} as never;
 const denied=budgetedLlm({async complete(){providerCalls++;return {content:[],stop_reason:'end_turn'};}},{rpc:async()=>({data:null}),from:()=>null},'L','2026-10-11','t');
 await assert.rejects(denied.complete(req),/daily AI budget/);assert.equal(providerCalls,0);
 const failed=budgetedLlm({async complete(){throw Error('provider unavailable');}},{rpc:async(name:string)=>{if(name==='noor_settle_budget')settlements++;return {data:'reservation'};},from:()=>null},'L','2026-10-11','t');
 await assert.rejects(failed.complete(req),/provider unavailable/);assert.equal(settlements,0);
});
test('budget is reserved before AI and settled with all usage counters',async()=>{
 const order:string[]=[];
 const llm=budgetedLlm({async complete(){order.push('provider');return {content:[],stop_reason:'end_turn',usage:{input_tokens:1000,output_tokens:100,cache_creation_input_tokens:1000,cache_read_input_tokens:1000}};}},{from:()=>null,rpc:async(name:string,args:any)=>{order.push(name);if(name==='noor_settle_budget')assert.equal(args.p_actual,0.00285);return {data:'reservation'};}},'L','2026-10-11','t');
 await llm.complete({system:'s',messages:[],tools:[],maxTokens:100,purpose:'answer'});
 assert.deepEqual(order,['noor_reserve_budget','provider','noor_settle_budget']);
});
test('a lab cannot request another lab brief before any database reads',async()=>{
 const schema=toolDefinitions(['compose_daily_brief'])[0].input_schema;
 assert.doesNotThrow(()=>validateToolInput(schema,{date:'2026-10-11'}));
 assert.throws(()=>validateToolInput(schema,{date:'2026-10-11',lab_id:'OTHER'}),/unexpected lab_id/);
 await assert.rejects(composeDailyBrief({lab_id:'OTHER',date:'2026-10-11'},{caller:{kind:'user',labId:'L'}} as never),/not visible/);
});
test('runner records model errors and cache usage; it blocks a tool absent from the allowed definitions',async()=>{
 const base={trigger:'user_question',caller:{kind:'user',language:'en'},systemPrompt:'s',userMessage:'q',ctx:{},limits:{maxToolCalls:2,toolTimeoutMs:100,maxTokens:100},purpose:'answer'} as any;
 const failed=await runAgent({...base,llm:{complete:async()=>{throw Error('provider rejected input');}},executor:{definitions:()=>[],execute:async()=>{throw Error('must not execute');}}});
 assert.equal(failed.error,'provider rejected input');assert.doesNotMatch(failed.text,/notified/);
 let n=0,executed=0;
 const r=await runAgent({...base,llm:{complete:async()=>++n===1?{content:[{type:'tool_use',id:'x',name:'send_status_update',input:{}}],stop_reason:'tool_use',usage:{cache_read_input_tokens:1000}}:{content:[{type:'text',text:'Cannot send email.'}],stop_reason:'end_turn'}},executor:{definitions:()=>[],execute:async()=>{executed++;}}});
 assert.equal(executed,0);assert.match(r.toolCalls[0].error??'',/not enabled/);assert.equal(r.cacheReadTokens,1000);
});

test('shared monthly budget denies generation and confirmed authentication rejection releases funds',async()=>{
 const req={system:'s',messages:[],tools:[],maxTokens:100,purpose:'answer'} as never;
 let called=false;
 const blocked=budgetedLlm({async complete(){called=true;throw Error('must not run');}},{from:()=>null,rpc:async(name:string)=>({data:name==='noor_platform_budget_status'?{remaining_usd:0}:null})},'L','2026-10-13','t');
 await assert.rejects(blocked.complete(req),/shared \$15 monthly/);assert.equal(called,false);
 const settlements:any[]=[];
 const rejected=budgetedLlm({async complete(){throw Object.assign(Error('invalid x-api-key'),{status:401});}},{from:()=>null,rpc:async(name:string,args:any)=>{if(name==='noor_settle_budget')settlements.push(args);return {data:'R'};}},'L','2026-10-13','t');
 await assert.rejects(rejected.complete(req),/invalid x-api-key/);assert.deepEqual(settlements,[{p_reservation:'R',p_actual:0}]);
});
