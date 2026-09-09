import { createClient } from "jsr:@supabase/supabase-js@2";
import { pickupMonitor, pickupEmail } from "../_shared/pickupMonitor.js";

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
function allowed(req:Request) {
  const expected=Deno.env.get('CASE_NOTIFY_SECRET'),actual=req.headers.get('x-webhook-secret');
  if(!expected?.trim()||!actual||expected.length!==actual.length)return false;
  let diff=0;for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^actual.charCodeAt(i);
  return diff===0;
}
Deno.serve(async req=>{
  if(req.method!=='POST')return json({error:'POST only'},405);
  if(!allowed(req))return json({error:'Unauthorized'},401);
  try {
    const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const {data:settings,error:settingsError}=await admin.from('pickup_digest_settings').select('enabled,recipient').eq('id',true).single();
    if(settingsError)throw settingsError;
    if(!settings.enabled)return json({skipped:'disabled'});
    const now=Date.now(), day=new Date(now+4*3600000).toISOString().slice(0,10);
    const readRun=async()=>{const {data,error}=await admin.from('pickup_digest_runs').select('*').eq('day',day).maybeSingle();if(error)throw error;return data;};
    let run=await readRun();
    if(run?.sent_at)return json({skipped:'already sent'});
    if(!run){
      const readAll=async(table:string,columns:string)=>{
        const rows=[];for(let start=0;;start+=1000){const {data,error}=await admin.from(table).select(columns).order('id').range(start,start+999);if(error)throw error;rows.push(...data);if(data.length<1000)return rows;}
      };
      const [cases,clinics,labs]=await Promise.all([readAll('cases','id,clinic_id,lab_id,stage_index,created_at,history,cancel_status'),readAll('clinics','id,name'),readAll('labs','id,name')]);
      const report=pickupMonitor(cases,clinics,labs,now);
      if(!report.waiting.length&&!report.newCases.length&&!report.collected.length)return json({skipped:'nothing to report'});
      const payload={from:'Dr-Crown <noreply@dr-crown.com>',to:[settings.recipient],subject:`Dr-Crown pickup summary — ${day}`,html:pickupEmail(report,day)};
      const {error}=await admin.from('pickup_digest_runs').upsert({day,payload},{onConflict:'day',ignoreDuplicates:true});if(error)throw error;
      run=await readRun(); // Always use the first saved snapshot, even in parallel retries.
    }
    const resendKey=Deno.env.get('RESEND_API_KEY');if(!resendKey)throw Error('Email service is not configured');
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${resendKey}`,'Content-Type':'application/json','Idempotency-Key':`pickup-digest-${day}`},body:JSON.stringify(run.payload)});
    if(!response.ok)throw Error(`Email provider returned ${response.status}`);
    const {error}=await admin.from('pickup_digest_runs').update({sent_at:new Date().toISOString()}).eq('day',day);if(error)throw error;
    return json({sent:true,day});
  }catch {console.error('Pickup digest failed; inspect database or email provider status.');return json({error:'Digest failed'},500);}
});
