import test from 'node:test';
import assert from 'node:assert/strict';
import {workLedger,financeSummary,workCompletedDate} from '../src/lib/workLedger.js';
import {statementPeriod,statementInView} from '../src/lib/financeViews.js';
const clinics={c:{id:'c',name:'Example Clinic',dentist:'Example Doctor'}};
const complete={id:'C-TEST',clinicId:'c',stageIndex:3,cancelStatus:'none',invoiceStatus:'draft',totalPrice:10,createdAt:'2026-08-01T00:00:00Z',history:[{action:'advance',toStage:3,at:'2026-08-31T20:15:00Z'}],prescription:{category:'Crown',teeth:[11,12]}};
const paper={id:'s',clinicName:'Example Clinic',clinicId:null,kind:'work',month:'2026-09-01',total:20,status:'unpaid',lineItems:[{date:'2026-09-02',invoice:'P-1',amount:20,units:1,price:20}]};
test('completion date, not submission, chooses the period in Oman',()=>{
 assert.equal(workCompletedDate(complete),'2026-09-01');
 assert.equal(workLedger([complete],[],clinics).length,1);
 assert.equal(workLedger([complete],[],clinics,undefined,true).length,0);
 assert.equal(workLedger([{...complete,stageIndex:2}],[],clinics).length,0);
 assert.equal(workLedger([{...complete,history:[]}],[],clinics).length,0);
 assert.equal(workLedger([{...complete,cancelStatus:'cancelled'}],[],clinics).length,0);
 assert.equal(workLedger([{...complete,stageIndex:4}],[],clinics).length,1);
});
test('one clinic row combines paper and digital; paid status never removes work',()=>{
 const groups=workLedger([complete],[paper],clinics);assert.equal(groups.length,1);assert.equal(groups[0].total,30);assert.equal(groups[0].rows.length,2);
 assert.equal(workLedger([{...complete,invoiceStatus:'paid'}],[{...paper,status:'paid'}],clinics)[0].total,30);
 assert.equal(workLedger([complete],[{...paper,clinicId:'c'}],clinics)[0].rows.length,1,'digital statement detail is never a second copy of its case');
});
test('summary reconciles billed debt without adding production twice or deducting unlinked cash',()=>{
 const opening={...paper,id:'old',kind:'opening_balance',month:'2026-08-01',total:100,lineItems:[]};
 const covered={...paper,id:'covered',month:'2026-08-01',total:100,lineItems:[]};
 const pay=[{statementId:'old',amount:30,receivedDate:'2026-09-01'},{clinicName:'Example Clinic',amount:99,receivedDate:'2026-09-01'}];
 const [a]=financeSummary([complete],[opening,covered,paper],pay,clinics,'2026-08-31');
 assert.equal(a.remaining,90);assert.equal(a.work,30);assert.equal(a.unbilled,10);assert.equal(a.unallocated,99);assert.equal(a.status,'Partially paid');
 assert.deepEqual(a.statementIds,['old','s']);
 const [settled]=financeSummary([{...complete,statementId:'s',invoiceStatus:'paid'}],[{...paper,status:'paid'}],[],clinics,null);
 assert.equal(settled.status,'Paid');assert.equal(settled.work,30);
});
test('summary includes unbilled and zero-price cases, excludes inactive paid historical clinics',()=>{
 const [a]=financeSummary([{...complete,totalPrice:null}],[],[],clinics,null);assert.equal(a.status,'Needs billing');assert.equal(a.unpriced,1);
 assert.deepEqual(financeSummary([],[{...paper,status:'paid',month:'2018-01-01',lineItems:[]}],[],clinics,null),[]);
});
test('September boundary retains opening debt in history and outstanding',()=>{
 const old={...paper,month:'2026-08-01',kind:'opening_balance',lineItems:[]};
 assert.equal(statementPeriod(old,'2026-09-01'),'history');
 assert.ok(statementInView(old,'pending','2026-09-01',[]));
 assert.equal(statementPeriod({...paper,lineItems:[]},'2026-09-01'),'current');
});
