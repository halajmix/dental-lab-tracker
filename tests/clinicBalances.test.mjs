import test from 'node:test';
import assert from 'node:assert/strict';
import {clinicBalances} from '../src/lib/clinicBalances.js';
const s=(id,rest={})=>({id,clinicName:'Example Clinic',status:'unpaid',kind:'work',total:100,...rest});
test('one clinic combines opening, paper and platform bills less allocated payments',()=>{
 const rows=clinicBalances([s('o',{kind:'opening_balance',total:200}),s('e'),s('p',{clinicId:'c',total:80})],[{statementId:'e',amount:30}],{c:{id:'c',name:'Example Clinic'}});
 assert.equal(rows.length,1);assert.deepEqual([rows[0].opening,rows[0].excel,rows[0].platform,rows[0].paid,rows[0].remaining],[200,100,80,30,350]);assert.ok(rows[0].needsReview);
});
test('settled bills and voided payments never inflate the pending balance',()=>{
 const [a]=clinicBalances([s('old',{status:'paid',total:999}),s('new')],[{statementId:'new',amount:100,voided_at:'2026-09-01'}]);assert.equal(a.remaining,100);
});
test('unallocated receipts are visible but not automatically deducted',()=>{
 const [a]=clinicBalances([s('e')],[{clinicName:'Example Clinic',amount:50}]);assert.equal(a.remaining,100);assert.equal(a.unallocated,50);
});
test('duplicate registered names and different spellings are not silently merged',()=>{
 const rows=clinicBalances([s('a',{clinicId:'a'}),s('b',{clinicId:'b'}),s('c'),s('d',{clinicName:'Example Dental Clinic'})],[],{a:{id:'a',name:'Example Clinic'},b:{id:'b',name:'Example Clinic'}});
 assert.equal(rows.length,4);assert.ok(rows.find(a=>a.key==='name:example clinic').ambiguous);
});
test('OMR arithmetic is exact to three decimals and overpayments do not create negative debt',()=>{
 const [a]=clinicBalances([s('a',{total:0.1}),s('b',{total:0.2}),s('c',{total:10})],[{statementId:'c',amount:20}]);assert.equal(a.remaining,0.3);assert.equal(a.excel-a.paid,a.remaining);
});
test('confirmed August paper snapshot replaces all earlier Excel debt, never digital debt',()=>{
 const rows=clinicBalances([s('old',{month:'2018-01-01',total:1000}),s('aug',{month:'2026-08-01',total:500}),s('opening',{kind:'opening_balance',month:'2026-08-01',total:200}),s('digital',{clinicId:'c',month:'2026-08-01',total:80}),s('sept',{month:'2026-09-01',total:50})],[],{c:{id:'c',name:'Example Clinic'}},'2026-08-31');
 assert.equal(rows.length,1);assert.equal(rows[0].remaining,330);assert.equal(rows[0].excel,50);assert.equal(rows[0].platform,80);assert.equal(rows[0].needsReview,false);
});
