// Explicit production diagnostic: creates an ephemeral owner session without
// sending email. The backend executes real model calls against synthetic tools.
// No case mutations or patient data are used. Credentials never leave memory.
import {createClient} from '@supabase/supabase-js';
import {serviceKey} from './lib/serviceKey.mjs';
const labId=process.env.NOOR_EVAL_LAB_ID;
if(!labId) throw new Error('Set NOOR_EVAL_LAB_ID to the configured pilot lab');
const url=process.env.SUPABASE_URL||'https://mtxkushcxczjwypwoxdh.supabase.co';
const key=serviceKey();
const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const {data:lab,error:labError}=await admin.from('labs').select('owner_id').eq('id',labId).single();
if(labError) throw new Error('Pilot lab unavailable');
const {data:user,error:userError}=await admin.auth.admin.getUserById(lab.owner_id);
if(userError||!user.user.email) throw new Error('Pilot owner unavailable');
const {data:link,error:linkError}=await admin.auth.admin.generateLink({type:'magiclink',email:user.user.email});
if(linkError) throw new Error('Diagnostic session could not be created');
const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const {data:auth,error:authError}=await client.auth.verifyOtp({type:'magiclink',token_hash:link.properties.hashed_token});
if(authError) throw new Error('Diagnostic session could not be verified');
try {
  const response=await fetch(`${url}/functions/v1/noor`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${auth.session.access_token}`},body:JSON.stringify({action:'selftest'})});
  const result=await response.json();
  console.log(JSON.stringify(result,null,2));
  if(!response.ok||result.outcome!=='completed'||!result.results?.every(r=>r.pass)) process.exitCode=1;
} finally {await client.auth.signOut({scope:'local'});}
