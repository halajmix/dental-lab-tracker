import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),dir=mkdtempSync(join(tmpdir(),'registration-test-'));
await build({entryPoints:['supabase/functions/registration-notify/index.ts'],outfile:join(dir,'worker.mjs'),bundle:true,platform:'node',format:'esm',plugins:[{name:'local-client',setup(b){b.onResolve({filter:/^jsr:@supabase\/supabase-js/},()=>({path:require.resolve('@supabase/supabase-js')}));}}]});
let handler;globalThis.Deno={serve:h=>{handler=h},env:{get:k=>({CASE_NOTIFY_SECRET:'fictional-secret',SUPABASE_URL:'http://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fictional-key',RESEND_API_KEY:'fictional-mail'}[k])}};
const realFetch=globalThis.fetch;let enabled=true,providerOK=true;const calls=[];
globalThis.fetch=async(input,init={})=>{const url=String(input);calls.push({url,...init});
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
if(url.includes('/registration_review_settings'))return response({enabled,recipient:'reviewer@example.invalid'});
if(url.includes('/rpc/claim_registration_reviews'))return response([{id:'fictional-event',kind:'signup',payload:{email:'person@example.invalid'}}]);
if(url==='https://api.resend.com/emails')return response({id:'fictional-mail'},providerOK?200:503);
if(url.includes('/registration_review_events'))return response(null);
throw Error('Unexpected outbound request blocked');};
try{
 await import(join(dir,'worker.mjs'));
 assert.equal((await handler(new Request('http://fixture.invalid'))).status,405);
 assert.equal((await handler(new Request('http://fixture.invalid',{method:'POST'}))).status,401);
 const req=()=>new Request('http://fixture.invalid',{method:'POST',headers:{'x-webhook-secret':'fictional-secret'}});
 enabled=false;assert.deepEqual(await (await handler(req())).json(),{skipped:'disabled'});enabled=true;
 assert.deepEqual(await (await handler(req())).json(),{sent:1,failed:0});
 const mail=calls.find(c=>c.url==='https://api.resend.com/emails');assert.deepEqual(JSON.parse(mail.body).to,['reviewer@example.invalid']);assert.equal(mail.headers['Idempotency-Key'],'registration-review-fictional-event');
 providerOK=false;assert.equal((await handler(req())).status,503);assert(calls.some(c=>c.body?.includes('Delivery failed')));
 console.log('PASS: real worker method/secret gates, disabled switch, sole configured recipient, provider acceptance, idempotency key and failed-delivery recording');
}finally{globalThis.fetch=realFetch;delete globalThis.Deno;rmSync(dir,{recursive:true,force:true});}
