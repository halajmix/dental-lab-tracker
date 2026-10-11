import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
create table auth.users(id uuid primary key);create table labs(id uuid primary key);
create table agent_runs(trace_id text primary key);create table noor_rate_limits(scope text,window_start timestamptz,count integer,primary key(scope,window_start));
create table escalations(id uuid default gen_random_uuid(),case_id text,category text,status text);`);
const sql=readFileSync(new URL('../supabase/migrations/20261011_noor_pilot.sql',import.meta.url),'utf8');
await db.exec(sql);await db.exec(sql); // additive and repeatable
const lab='00000000-0000-4000-8000-000000000001';
await db.exec(`insert into labs(id) values('${lab}');insert into noor_pilot_settings(lab_id,daily_budget_usd) values('${lab}',1);`);
const reserve=async(amount)=> (await db.query(`select noor_reserve_budget($1,'2026-10-11',$2,'synthetic') as id`,[lab,amount])).rows[0].id;
const reservation=await reserve(0.6);assert.ok(reservation);
assert.equal(await reserve(0.5),null);
assert.equal(await reserve(0.1),null); // paused for today, cannot race through cap
await db.query('select noor_settle_budget($1,0.2)',[reservation]);await db.query('select noor_settle_budget($1,0.2)',[reservation]);
const usage=(await db.query('select * from noor_daily_usage')).rows[0];
assert.equal(Number(usage.spent_usd),0.2);assert.equal(Number(usage.reserved_usd),0);
assert.ok((await db.query(`select noor_reserve_budget($1,'2026-10-12',0.1,'synthetic') as id`,[lab])).rows[0].id);
const rates=await Promise.all(Array.from({length:8},()=>db.query("select noor_take_rate('test','2026-10-11T00:00:00Z',3) as allowed")));
assert.equal(rates.filter(x=>x.rows[0].allowed).length,3);
await db.exec('set role authenticated');
await assert.rejects(db.query('select * from noor_pilot_settings'),/permission denied/);
await assert.rejects(db.query(`select noor_reserve_budget('${lab}','2026-10-11',0.1,'x')`),/permission denied/);
await db.exec('reset role');
await db.exec("insert into escalations(case_id,category,status) values('C-TEST0001','stale_case','open')");
await assert.rejects(db.exec("insert into escalations(case_id,category,status) values('C-TEST0001','stale_case','acknowledged')"),/duplicate key/);
await db.close();console.log('PASS: migration replay, budget pause/reset/settlement, atomic rate limit, privilege boundary and escalation deduplication');
