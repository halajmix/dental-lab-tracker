import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
create table auth.users(id uuid primary key);create table labs(id uuid primary key);
create table agent_runs(trace_id text primary key,started_at timestamptz default now(),model text,input_tokens integer default 0,output_tokens integer default 0);
create table noor_rate_limits(scope text,window_start timestamptz,count integer,primary key(scope,window_start));
create table escalations(id uuid default gen_random_uuid(),case_id text,category text,status text);`);
const migration=n=>readFileSync(new URL(`../supabase/migrations/${n}`,import.meta.url),'utf8');
await db.exec(migration('20261011_noor_pilot.sql'));
const labs=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'];
for(const lab of labs)await db.query('insert into labs(id) values($1);',[lab]);
for(const lab of labs)await db.query('insert into noor_pilot_settings(lab_id,daily_budget_usd) values($1,100)',[lab]);
await db.exec("insert into agent_runs(trace_id,model,input_tokens,output_tokens) values('legacy','claude-haiku-4-5-20251001',1000,100)");
await db.exec(migration('20261013_noor_platform_budget.sql'));await db.exec(migration('20261013_noor_platform_budget.sql'));
let status=(await db.query('select noor_platform_budget_status() as s')).rows[0].s;
assert.equal(Number(status.spent_usd)+Number(status.reserved_usd),0.5); // legacy accounted once, including cache uncertainty
await assert.rejects(db.exec('update noor_platform_budget set monthly_limit_usd=16'),/check constraint/);
await db.exec('update noor_monthly_usage set spent_usd=0,reserved_usd=0,legacy_hold_usd=0');
const reserve=async(lab,amount,day='2026-10-13')=>(await db.query('select noor_reserve_budget($1,$2,$3,$4) id',[lab,day,amount,'test'])).rows[0].id;
const a=await reserve(labs[0],10);assert.ok(a);
assert.equal(await reserve(labs[1],6),null); // different lab shares the cap
const b=await reserve(labs[1],5);assert.ok(b);
assert.equal(await reserve(labs[1],0.01,'1900-01-01'),null); // caller cannot choose another month
await db.query('select noor_settle_budget($1,1)',[a]);await db.query('select noor_settle_budget($1,1)',[a]);
status=(await db.query('select noor_platform_budget_status() as s')).rows[0].s;
assert.equal(Number(status.spent_usd),1);assert.equal(Number(status.reserved_usd),5);
const results=await Promise.all(Array.from({length:10},(_,i)=>reserve(labs[i%2],1)));
assert.equal(results.filter(Boolean).length,9); // two labs cannot race above remaining $9
status=(await db.query('select noor_platform_budget_status() as s')).rows[0].s;
assert.equal(Number(status.remaining_usd),0);
// Old month balances do not consume this month's allowance; late settlements
// must stay attached to the reservation's original month.
await db.exec("insert into noor_monthly_usage(month_start,spent_usd,reserved_usd) values('2000-01-01',14,1)");
const old=(await db.query("insert into noor_usage_reservations(lab_id,day,month_start,amount_usd,trace_id) values($1,'2000-01-01','2000-01-01',1,'old') returning id",[labs[0]])).rows[0].id;
await db.query('select noor_settle_budget($1,0.1)',[old]);
assert.equal(Number((await db.query('select noor_platform_budget_status() s')).rows[0].s.remaining_usd),0);
assert.equal(Number((await db.query("select spent_usd from noor_monthly_usage where month_start='2000-01-01'")).rows[0].spent_usd),14.1);
await db.exec('set role authenticated');
await assert.rejects(db.query('select noor_platform_budget_status()'),/permission denied/);
await assert.rejects(db.query('select * from noor_monthly_usage'),/permission denied/);
await db.close();console.log('PASS: shared $15 cap, cross-lab races, old-month isolation, settlement idempotency, legacy accounting, privilege boundary');
