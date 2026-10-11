import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEvent,readEvent} from '../supabase/functions/attendance-webhook/normalize.mjs';
const event={eventType:'AccessControllerEvent',dateTime:'2026-10-11T09:03:00+04:00',AccessControllerEvent:{majorEventType:5,subEventType:38,employeeNoString:'2',name:'Yusef',serialNo:244,attendanceStatus:'undefined',cardNo:'PRIVATE',faceURL:'PRIVATE'}};
test('successful punch preserves Oman time and strips sensitive fields',()=>{
  const row=normalizeEvent(event,['1','2','3']);
  assert.equal(row.punched_at,'2026-10-11T05:03:00.000Z');
  assert.equal(row.employee_id,'2');
  assert.deepEqual(Object.keys(row).sort(),['employee_id','employee_name','event_identity','punch_state','punched_at'].sort());
});
test('rejects failed verification, unrelated events and employees outside the lab',()=>{
  for(const subEventType of [39,76,78,123,124,125,126,127]) assert.equal(normalizeEvent({...event,AccessControllerEvent:{...event.AccessControllerEvent,subEventType}},['2']),null);
  assert.equal(normalizeEvent(event,['3']),null);
  assert.equal(normalizeEvent({...event,eventType:'videoloss'},['2']),null);
  assert.equal(normalizeEvent({...event,AccessControllerEvent:{...event.AccessControllerEvent,currentVerifyMode:'invalid'}},['2']),null);
});
test('duplicate delivery has a stable identity; distinct punches remain distinct',()=>{
  assert.equal(normalizeEvent({...event,activePostCount:1},['2']).event_identity,normalizeEvent({...event,activePostCount:5},['2']).event_identity);
  assert.notEqual(normalizeEvent(event,['2']).event_identity,normalizeEvent({...event,dateTime:'2026-10-11T13:00:00+04:00'},['2']).event_identity);
});
test('uses Oman for missing offset and rejects missing or invalid times',()=>{
  assert.equal(normalizeEvent({...event,dateTime:'2026-10-11T09:03:00'},['2']).punched_at,'2026-10-11T05:03:00.000Z');
  for(const dateTime of ['', '2026-10-11','not a time','2026-02-30T09:00:00+04:00']) assert.throws(()=>normalizeEvent({...event,dateTime},['2']));
});
test('accepts JSON in multipart while ignoring image parts',async()=>{
  const form=new FormData();form.append('event',new Blob([JSON.stringify(event)],{type:'application/json'}),'event.json');
  form.append('picture',new Blob(['PRIVATE IMAGE'],{type:'image/jpeg'}),'face.jpg');
  const parsed=await readEvent(new Request('https://receiver.invalid',{method:'POST',body:form}));
  assert.deepEqual(parsed,event);
});
