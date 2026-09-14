import {createClient} from 'jsr:@supabase/supabase-js@2';
import {acceptsSecret} from '../registration-notify/email.ts';
import {platformEmail} from './email.ts';
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
Deno.serve(async req=>{
 if(req.method!=='POST')return json({error:'POST only'},405);
 if(!acceptsSecret(req.headers.get('x-webhook-secret'),Deno.env.get('CASE_NOTIFY_SECRET')))return json({error:'Unauthorized'},401);
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
 let run;
 try {
  const body=await req.json();const key=Deno.env.get('RESEND_API_KEY');if(!key)throw Error('Mail not configured');
  const {data,error}=await admin.rpc('claim_platform_digest',{p_preview:body.preview===true});if(error)throw error;
  run=data?.[0];if(!run)return json({skipped:'not due, disabled, leased or already sent'});
  const mail=platformEmail(run.id,run.payload);
  const r=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':`platform-digest-${run.id}`},body:JSON.stringify({from:'Dr-Crown <noreply@dr-crown.com>',to:[run.recipient],...mail})});
  if(!r.ok)throw Error('Provider did not accept');
  const {error:saveError}=await admin.from('platform_digest_runs').update({sent_at:new Date().toISOString(),last_error:null}).eq('id',run.id);if(saveError)throw saveError;
  return json({sent:true});
 }catch {
  if(run)await admin.from('platform_digest_runs').update({last_error:'Delivery failed; check scheduled retries and provider status.'}).eq('id',run.id);
  console.error('Platform digest failed');return json({error:'Digest failed'},500);
 }
});
