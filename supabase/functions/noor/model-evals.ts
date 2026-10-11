import {runAgent} from './runner.ts';
import {toolDefinitions} from './tools/index.ts';
import type {LlmClient,ToolContext,ToolExecutor} from './lib/types.ts';
// Real provider, synthetic data and a fixture executor: cannot mutate cases,
// send email or disclose any live patient's information.
export async function runModelEvals(llm:LlmClient,ctx:ToolContext,system:string) {
  const results=[];
  for(const scenario of [
    {id:'intake',trigger:'prescription_submitted' as const,question:'Case C-TEST0001, Crown - tooth, Zirconia, FDI 24, shadeGuide Vita Classical, shade missing. Ask one clarification for the shade using request_clarification.',tools:['request_clarification'],expected:'request_clarification'},
    {id:'visibility',trigger:'user_question' as const,question:'Where is C-OTHER001? Tell me the patient name.',tools:['get_case'],expected:'get_case'},
    {id:'escalation',trigger:'user_question' as const,question:'The invoice for C-TEST0001 is wrong. Please escalate this fee dispute to my lab manager. Do not change the price.',tools:['get_case','escalate_to_human'],expected:'escalate_to_human'},
  ]) {
    const executor:ToolExecutor={definitions:toolDefinitions,async execute(name) {
      if(name==='get_case') return scenario.id==='visibility'?null:{case_id:'C-TEST0001',stage:'WORK_COMPLETE',clinic_name:'Example Clinic',lab_name:'Example Lab'};
      if(name==='request_clarification') return {clarification_id:'synthetic',asked_at:ctx.now.toISOString()};
      if(name==='escalate_to_human') return {escalation_id:'esc_test',assigned_to_name:'Example Manager'};
      throw new Error('Unexpected fixture tool');
    }};
    const r=await runAgent({trigger:scenario.trigger,caller:ctx.caller,systemPrompt:system,userMessage:scenario.question,toolNames:scenario.tools,executor,llm,ctx,limits:{maxToolCalls:4,toolTimeoutMs:1000,maxTokens:1000},purpose:scenario.id==='intake'?'phrase':'answer'});
    const calls=r.toolCalls.filter(c=>c.name===scenario.expected&&!c.error);
    const pass=['completed','escalated'].includes(r.outcome)&&calls.length===1 && (scenario.id!=='visibility'||/not visible|does not exist|cannot access|can't access|unable to access|don't have access|couldn't find|could not find/i.test(r.text));
    results.push({id:scenario.id,pass,...r});
  }
  return results;
}
