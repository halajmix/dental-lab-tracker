import test from 'node:test';
import assert from 'node:assert/strict';
import {enqueue,getOps,flush} from '../src/lib/outbox.js';
test('offline submission is never acknowledged when device storage fails',()=>{
 globalThis.localStorage={getItem:()=>null,setItem:()=>{throw Error('quota');}};
 assert.throws(()=>enqueue({kind:'insert',caseId:'C-EXAMPLE'}),/storage unavailable/);
});
test('retry retains one queued insert and replay remains durable',async()=>{
 const store=new Map();globalThis.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
 const op={kind:'insert',caseId:'C-EXAMPLE',data:{patientName:'Fictional Patient'}};
 enqueue(op);enqueue(op);assert.equal(getOps().length,1);
 const disconnected=await flush(async()=>{throw {isNetwork:true};});
 assert.equal(disconnected.offline,true);assert.equal(getOps().length,1);
 let applied=0;await flush(async()=>{applied++;return {id:op.caseId};});
 assert.equal(applied,1);assert.equal(getOps().length,0);
});
test('an unreadable existing queue is not overwritten by a new submission',()=>{
 let writes=0;globalThis.localStorage={getItem:()=>'{broken',setItem:()=>writes++};
 assert.throws(()=>enqueue({kind:'insert',caseId:'C-EXAMPLE'}),/storage unavailable/);
 assert.equal(writes,0);
});
