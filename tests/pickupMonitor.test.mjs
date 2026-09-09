import test from 'node:test';import assert from 'node:assert/strict';
import {pickupMonitor,pickupEmail} from '../supabase/functions/_shared/pickupMonitor.js';
const now=Date.parse('2026-09-09T14:00:00Z');
const c=(id,rest={})=>({id,clinic_id:'c',lab_id:'l',stage_index:0,created_at:'2026-09-09T10:00:00Z',history:[],...rest});
test('all labs, waiting, new submissions, recorded pickups and cancellation',()=>{
 const report=pickupMonitor([c('old',{created_at:'2026-09-07T10:00:00Z'}),c('new'),c('picked',{stage_index:2,history:[{action:'advance',toStage:1,at:'2026-09-09T11:00:00Z',by:'Example Technician'}]}),c('cancelled',{cancel_status:'cancelled'}),c('unassigned',{lab_id:null})],[],[],now);
 assert.equal(report.waiting.length,2);assert.equal(report.newCases.length,2);assert.equal(report.collected.length,1);assert.equal(report.waitingOver24h.length,1);assert.equal(report.collected[0].collectedBy,'Example Technician');
});
test('reverted cases remain waiting; missing pickup timestamps are not fabricated',()=>{
 const report=pickupMonitor([c('reverted',{history:[{action:'advance',toStage:1,at:'2026-09-09T11:00:00Z'}]}),c('missing',{stage_index:2})],[],[],now);
 assert.equal(report.waiting.length,1);assert.equal(report.collected.length,0);assert.equal(report.rows[1].collectedAt,null);
});
test('email escapes free text and never includes patient data',()=>{
 const report=pickupMonitor([c('<case>',{patient_name:'PRIVATE PATIENT'})],[{id:'c',name:'<img src=x>'}],[{id:'l',name:'A & B'}],now);
 const html=pickupEmail(report,'2026-09-09');assert.ok(!html.includes('PRIVATE PATIENT'));assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;img'));assert.ok(html.includes('A &amp; B'));
});
test('Oman day and rolling daily window include exact boundary',()=>{
 const report=pickupMonitor([c('boundary',{created_at:'2026-09-08T20:00:00Z'}),c('before',{created_at:'2026-09-08T19:59:59Z'})],[],[],now,Date.parse('2026-09-09T00:00:00+04:00'));
 assert.deepEqual(report.newCases.map(r=>r.id),['boundary']);
});
