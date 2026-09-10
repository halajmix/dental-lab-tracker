import test from 'node:test';
import assert from 'node:assert/strict';
import {statementPeriod, statementInView, expenseInView} from '../src/lib/financeViews.js';
const cutoff = '2026-08-19';
const bill = {id:'fictional', kind:'work', status:'unpaid', total:100, month:'2026-08-01', lineItems:[]};
test('cutoff includes 19 August in current billing', () => {
  for (const [date, expected] of [['2026-08-18','history'], ['2026-08-19','current'], ['2026-08-20','current']]) {
    assert.equal(statementPeriod({...bill,lineItems:[{date}]}, cutoff), expected);
  }
});
test('mixed statements stay intact in both date views', () => {
  const mixed = {...bill,lineItems:[{date:'2026-08-18'}, {date:'2026-08-20'}]};
  assert.equal(statementPeriod(mixed,cutoff), 'mixed');
  assert.ok(statementInView(mixed,'history',cutoff,[]));
  assert.ok(statementInView(mixed,'current',cutoff,[]));
  assert.equal(mixed.total,100);
});
test('unknown cutoff-month dates are never silently archived', () => {
  assert.equal(statementPeriod(bill,cutoff), 'mixed');
  assert.equal(statementPeriod({...bill,month:'2018-02-01'},cutoff),'history');
});
test('platform case dates respect Oman midnight', () => {
  assert.equal(statementPeriod(bill,cutoff,[{statementId:bill.id,stageIndex:3,createdAt:'2026-08-01T00:00:00Z',history:[{action:'advance',toStage:3,at:'2026-08-18T21:00:00Z'}]}]),'current');
});
test('pending includes opening balances and system bills but excludes settled bills', () => {
  assert.ok(statementInView({...bill,kind:'opening_balance'},'pending',cutoff,[]));
  assert.ok(statementInView(bill,'pending',cutoff,[]));
  assert.ok(!statementInView({...bill,status:'paid'},'pending',cutoff,[]));
  assert.ok(!statementInView(bill,'pending',cutoff,[],100));
  assert.ok(!statementInView({...bill,kind:'opening_balance'},'current',cutoff,[]));
});
test('expenses move by expense date; other labs retain their current view', () => {
  assert.ok(expenseInView({expenseDate:'2026-08-18'},'history',cutoff));
  assert.ok(!expenseInView({expenseDate:'2026-08-19'},'history',cutoff));
  assert.ok(expenseInView({expenseDate:'2018-01-01'},'current',null));
  assert.ok(statementInView({...bill,kind:'opening_balance'},'current',null,[]));
});

test('settled opening balances can be revisited to correct payment status', () => {
  assert.ok(statementInView({...bill,kind:'opening_balance',status:'paid'},'pending',cutoff,[],100,true));
});
