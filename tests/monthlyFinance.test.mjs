import test from 'node:test';import assert from 'node:assert/strict';
import {monthlyFinanceSummary} from '../src/lib/workLedger.js';
import {expenseMonths} from '../src/lib/expenseMonths.js';
import {statementInView} from '../src/lib/financeViews.js';
const clinics={c:{id:'c',name:'Example Clinic'}};
const sep={id:'s',clinicId:'c',month:'2026-09-01',total:30,status:'partial',kind:'work'};
const oct={...sep,id:'o',month:'2026-10-01',total:90,status:'unpaid'};
const work={id:'C-F',clinicId:'c',stageIndex:3,totalPrice:30,statementId:'s',invoiceStatus:'issued',history:[{action:'advance',toStage:3,at:'2026-09-02T10:00:00Z'}]};
test('monthly status uses payments against selected bills even when received later',()=>{
 const [a]=monthlyFinanceSummary([work],[sep,oct],[{statementId:'s',amount:10,receivedDate:'2026-10-10'}],clinics,null,'2026-09');
 assert.equal(a.work,30);assert.equal(a.paid,10);assert.equal(a.remaining,20);assert.equal(a.status,'Partially paid');assert.deepEqual(a.statementIds,['s']);
 const [b]=monthlyFinanceSummary([work],[{...sep,status:'paid'},oct],[],clinics,null,'2026-09');assert.equal(b.status,'Paid');assert.equal(b.remaining,0);assert.equal(b.paid,30);
 assert.equal(monthlyFinanceSummary([work],[sep,oct],[],clinics,null,'2026-11').length,0);
});
test('unbilled completed work is unpaid, and monthly old shared bills need review',()=>{
 const [a]=monthlyFinanceSummary([{...work,statementId:null}],[],[],clinics,null,'2026-09');assert.equal(a.remaining,30);assert.equal(a.status,'Unpaid');
 const [b]=monthlyFinanceSummary([work],[{...sep,month:'2026-10-01'}],[],clinics,null,'2026-09');assert.equal(b.status,'Review billing month');
});
test('old opening debt and unlinked receipts do not change selected month status',()=>{
 const [a]=monthlyFinanceSummary([work],[{...sep,status:'paid'},{...sep,id:'old',kind:'opening_balance',month:'2026-08-01',total:100}], [{amount:999,clinicId:'c'}],clinics,null,'2026-09');assert.equal(a.remaining,0);assert.equal(a.status,'Paid');
});
test('expense ledger uses one row per month and preserves category breakdown and baisa',()=>{
 const input=[{id:'a',expenseDate:'2026-09-01',category:'Salaries',amount:100},{id:'b',expenseDate:'2026-09-02',category:'Utilities',amount:.1},{id:'c',expenseDate:'2026-09-03',category:'Utilities',amount:.2},{id:'d',expenseDate:'2026-08-30',category:'Maintenance',amount:5}];
 const [sep,aug]=expenseMonths(input);assert.equal(sep.month,'2026-09');assert.equal(sep.total,100.3);assert.equal(sep.categories.Utilities,.3);assert.equal(sep.rows.length,3);assert.equal(aug.total,5);assert.equal(input.length,4);
});
test('combined billing archive contains both old and new records once',()=>{
 assert.ok(statementInView(sep,'archive','2026-09-01',[]));assert.ok(statementInView({...sep,month:'2018-01-01'},'archive','2026-09-01',[]));assert.ok(statementInView({...sep,openingHistory:true},'archive','2026-09-01',[]));
});
