import { createClient } from 'npm:@supabase/supabase-js@2';
import { normalizeEvent, readEvent } from './normalize.mjs';

const MAX_BYTES = 4 * 1024 * 1024;
async function hash(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
const reply = (status: number, value: string) => new Response(value, {status, headers:{'Content-Type':'text/plain','Cache-Control':'no-store'}});

Deno.serve(async req => {
  if (req.method !== 'POST') return reply(405,'POST required');
  const token = new URL(req.url).pathname.split('/').pop() ?? '';
  if (!/^[a-f0-9]{64}$/.test(token)) return reply(401,'Unauthorized');
  const db = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const {data:secret,error:secretError} = await db.from('attendance_device_secrets').select('connection_id').eq('token_hash',await hash(token)).maybeSingle();
  if (secretError) return reply(503,'Receiver unavailable');
  if (!secret) return reply(401,'Unauthorized');
  const {data:connection,error:connectionError} = await db.from('attendance_connections').select('id,lab_id,enabled,employee_ids').eq('id',secret.connection_id).maybeSingle();
  if (connectionError) return reply(503,'Receiver unavailable');
  if (!connection?.enabled) return reply(403,'Connection inactive');
  if (Number(req.headers.get('content-length') ?? 0)>MAX_BYTES) return reply(413,'Event too large');
  try {
    // Enforce the cap even for chunked uploads before multipart parsing.
    const reader = req.body?.getReader();
    if (!reader) return reply(400,'Event missing');
    const chunks: Uint8Array[]=[];
    let size=0;
    for (;;) {
      const {value,done}=await reader.read();
      if (done) break;
      size+=value.byteLength;
      if(size>MAX_BYTES) {await reader.cancel();return reply(413,'Event too large');}
      chunks.push(value);
    }
    const body=new Uint8Array(size);
    let offset=0;
    for(const chunk of chunks) {body.set(chunk,offset);offset+=chunk.length;}
    const parsed=await readEvent(new Request('https://receiver.invalid',{method:'POST',headers:{'content-type':req.headers.get('content-type') ?? ''},body}));
    const event=normalizeEvent(parsed,connection.employee_ids);
    if (event) {
      const {event_identity,...fields}=event;
      const {error}=await db.from('attendance_punches').upsert({
        ...fields,connection_id:connection.id,lab_id:connection.lab_id,event_key:await hash(event_identity)
      },{onConflict:'connection_id,event_key',ignoreDuplicates:true});
      if(error) return reply(503,'Unable to save punch');
      const {error:updateError}=await db.from('attendance_connections').update({last_received_at:new Date().toISOString()}).eq('id',connection.id);
      if(updateError) return reply(503,'Unable to update receipt status');
    }
    return reply(200,'OK');
  } catch {
    // Do not log the incoming payload or credential-bearing URL.
    return reply(400,'Unsupported or invalid attendance event');
  }
});
