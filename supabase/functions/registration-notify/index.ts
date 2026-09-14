import {createClient} from 'jsr:@supabase/supabase-js@2';
import {registrationEmail,acceptsSecret} from './email.ts';
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
Deno.serve(async(req)=>{
 if(req.method!=='POST')return json({error:'POST only'},405);
 if(!acceptsSecret(req.headers.get('x-webhook-secret'),Deno.env.get('CASE_NOTIFY_SECRET')))return json({error:'Unauthorized'},401);
 try {
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const {data:s,error:se}=await admin.from('registration_review_settings').select('enabled,recipient').eq('id',true).single();
  if(se)throw se;if(!s.enabled)return json({skipped:'disabled'});
  const key=Deno.env.get('RESEND_API_KEY');if(!key)throw Error('Mail not configured');
  const {data:events,error}=await admin.rpc('claim_registration_reviews');if(error)throw error;
  let sent=0,failed=0;
  for(const e of events??[]) {
   try {
    const email=registrationEmail(e.kind,e.payload);
    const r=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':`registration-review-${e.id}`},body:JSON.stringify({from:'Dr-Crown <noreply@dr-crown.com>',to:[s.recipient],...email})});
    if(!r.ok)throw Error(`Provider HTTP ${r.status}`);
    const {error:saveError}=await admin.from('registration_review_events').update({sent_at:new Date().toISOString(),last_error:null}).eq('id',e.id);if(saveError)throw saveError;sent++;
   }catch {
    failed++;await admin.from('registration_review_events').update({last_error:'Delivery failed; retry scheduled. Inspect provider if retries exhausted.'}).eq('id',e.id);
   }
  }
  return json({sent,failed},failed?503:200);
 }catch {console.error('Registration notification worker failed');return json({error:'Worker failed'},500);}
});
