import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');const db=new PGlite();
const lab='00000000-0000-4000-8000-000000000001',clinic='00000000-0000-4000-8000-000000000002';
await db.exec(`
create role anon;create role authenticated;create role service_role;
create function my_lab_id() returns uuid language sql stable as $$select nullif(current_setting('test.lab',true),'')::uuid$$;
create table labs(id uuid primary key);
create table clinic_statements(id uuid primary key default gen_random_uuid(),lab_id uuid,clinic_id uuid,month date,total numeric default 0,status text default 'unpaid',unique(lab_id,clinic_id,month));
create table cases(id text primary key,lab_id uuid,clinic_id uuid,stage_index int,history jsonb default '[]',cancel_status text default 'none',cancellation_fee numeric,total_price numeric,invoice_status text default 'draft',statement_id uuid);
create table lab_payments(id uuid default gen_random_uuid(),statement_id uuid,amount numeric,voided_at timestamptz);
create function statement_recompute(sid uuid) returns void language plpgsql as $$declare t numeric;p numeric;begin select total into t from clinic_statements where id=sid;select coalesce(sum(amount),0) into p from lab_payments where statement_id=sid and voided_at is null;update clinic_statements set status=case when p>=t and t>0 then 'paid' when p>0 then 'partial' else 'unpaid' end where id=sid;update cases set invoice_status='paid' where statement_id=sid and invoice_status='issued' and p>=t and t>0;end$$;
create function finance_guard() returns trigger language plpgsql as $$begin if current_setting('role',true)<>'service_role' and new.lab_id is distinct from my_lab_id() then new.statement_id:=old.statement_id;new.invoice_status:=old.invoice_status;end if;return new;end$$;
create trigger finance_guard before update on cases for each row execute function finance_guard();
grant select on cases to service_role;
grant select,insert,update on cases,clinic_statements,lab_payments to authenticated;
insert into labs values('${lab}');
insert into cases(id,lab_id,clinic_id,stage_index,total_price,history) values
 ('C-BACKFILL','${lab}','${clinic}',3,10,'[{"action":"advance","toStage":3,"at":"2026-08-31T21:00:00Z"}]'),
 ('C-OLD','${lab}','${clinic}',3,100,'[{"action":"advance","toStage":3,"at":"2026-08-20T00:00:00Z"}]'),
 ('C-WAITING','${lab}','${clinic}',2,20,'[]');
`);
const sql=readFileSync(new URL('../supabase/migrations/20260910_auto_completed_billing.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
const scalar=async q=>Object.values((await db.query(q)).rows[0])[0];
assert.equal(await scalar('select count(*)::int from clinic_statements'),1);assert.equal(Number(await scalar('select total from clinic_statements')),10);assert.equal(await scalar("select statement_id is null from cases where id='C-OLD'"),true);
await db.exec(`select set_config('test.lab','${lab}',false);set role authenticated;update cases set stage_index=3,history='[{"action":"advance","toStage":3,"at":"2026-09-02T00:00:00Z"}]' where id='C-WAITING';`);
assert.equal(Number(await scalar('select total from clinic_statements')),30);assert.equal(await scalar("select invoice_status from cases where id='C-WAITING'"),'issued');
await db.exec("update cases set history=history where id='C-WAITING'");assert.equal(Number(await scalar('select total from clinic_statements')),30);
await db.exec('insert into lab_payments(statement_id,amount) select id,30 from clinic_statements;select statement_recompute(id) from clinic_statements;');assert.equal(await scalar('select status from clinic_statements'),'paid');
await db.exec(`insert into cases(id,lab_id,clinic_id,stage_index,total_price,history) values('C-NEXT','${lab}','${clinic}',3,5,'[{"action":"advance","toStage":3,"at":"2026-09-03T00:00:00Z"}]')`);
assert.equal(await scalar('select status from clinic_statements'),'partial');assert.equal(Number(await scalar('select total from clinic_statements')),35);assert.equal(Number(await scalar('select sum(amount) from lab_payments')),30);
await db.exec("update cases set total_price=8 where id='C-NEXT'");assert.equal(Number(await scalar('select total from clinic_statements')),38);
await db.exec(`insert into cases(id,lab_id,clinic_id,stage_index,total_price,history) values('C-NOPRICE','${lab}','${clinic}',3,null,'[{"action":"advance","toStage":3,"at":"2026-10-03T00:00:00Z"}]')`);assert.equal(await scalar("select statement_id is null from cases where id='C-NOPRICE'"),true);
const response=await db.query("update cases set total_price=6 where id='C-NOPRICE' returning statement_id,invoice_status");assert.ok(response.rows[0].statement_id);assert.equal(response.rows[0].invoice_status,'issued');assert.equal(await scalar('select count(*)::int from clinic_statements'),2);
await assert.rejects(db.exec("select bill_completed_case('C-OLD')"),/permission denied/);
await db.exec('reset role;set role anon');await assert.rejects(db.exec("select bill_completed_case('C-OLD')"),/permission denied/);
await db.close();console.log('Auto billing checks passed: Oman month, idempotent backfill, pre-period preservation, completion, repricing, receipt preservation, monthly separation and private helper.');
