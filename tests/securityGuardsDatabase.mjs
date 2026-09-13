// Disposable fictional database only; never connects to Supabase.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const user='11111111-1111-4111-8111-111111111111';
await db.exec(`
create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select '${user}'::uuid$$;
create function my_lab_id() returns uuid language sql stable as $$select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid$$;
create function is_lab_admin() returns boolean language sql stable as $$select true$$;
create function is_admin() returns boolean language sql stable as $$select coalesce(current_setting('test.admin',true),'false')='true'$$;
create table cases(id int primary key,lab_id uuid,assigned_tech_id uuid,invoice_status text,base_fee numeric,adjustments jsonb,total_price numeric,discount numeric,billing_note text,statement_id uuid,invoice_number text,price_overridden boolean,lab_shade text);
create function guard_lab_financial_columns() returns trigger language plpgsql as $$begin return new;end$$;
create trigger guard_finance before update on cases for each row execute function guard_lab_financial_columns();
create table clinics(id int primary key,status text,is_exclusive boolean,owner_id uuid,name text);
create table labs(id int primary key,status text,is_public boolean,noor_enabled boolean,work_ledger_enabled boolean,auto_completed_billing boolean,finance_history_before date,paper_balance_as_of date,owner_id uuid,created_by_clinic_id uuid,name text);
create table lab_members(id int primary key,lab_id uuid,user_id uuid,status text);
alter table lab_members enable row level security;
create policy reads on lab_members for select using(true);
create policy lab_members_update_admin on lab_members for update using(lab_id=my_lab_id() and is_lab_admin());
create policy lab_members_claim_invite on lab_members for update using(user_id is null) with check(user_id=auth.uid());
grant usage on schema public,auth to authenticated,service_role;
grant all on all tables in schema public to authenticated,service_role;
insert into lab_members values(1,my_lab_id(),auth.uid(),'active'),(2,my_lab_id(),null,'invited');
insert into clinics values(1,'active',false,auth.uid(),'Example Clinic');
insert into labs values(1,'active',true,false,true,true,'2026-09-01','2026-08-31',auth.uid(),null,'Example Lab');
insert into cases values(1,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',null,'draft',10,'[]',10,0,'',null,'EXAMPLE-1',false,'');
insert into cases select 2,my_lab_id(),assigned_tech_id,invoice_status,base_fee,adjustments,total_price,discount,billing_note,statement_id,invoice_number,price_overridden,lab_shade from cases where id=1;
`);
async function actor(q,role='authenticated'){await db.exec('begin;set local role '+role);try{const r=await db.query(q);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
// Demonstrate why explicit WITH CHECK alone would not repair permissive policy composition.
await actor("update lab_members set lab_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' where id=1");
assert.equal((await db.query('select lab_id from lab_members where id=1')).rows[0].lab_id,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
await db.exec('update lab_members set lab_id=my_lab_id() where id=1');
const before=(await db.query('select * from cases order by id')).rows;
for(const name of ['guard_lab_financial_columns_restore','lab_members_no_relocation','tenant_platform_columns_guard']){
 await db.exec(await readFile(new URL('../supabase/migrations/20260914_'+name+'.sql',import.meta.url),'utf8'));
}
assert.deepEqual((await db.query('select * from cases order by id')).rows,before,'migration does not rewrite cases');
await assert.rejects(actor("update lab_members set lab_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' where id=1"),/cannot be moved/);
await assert.rejects(actor("update lab_members set user_id='22222222-2222-4222-8222-222222222222' where id=1"),/cannot be reassigned/);
await actor("update lab_members set status='suspended' where id=1");
await actor('update lab_members set user_id=auth.uid() where id=2');
assert.equal((await db.query('select user_id from lab_members where id=2')).rows[0].user_id,user);
await actor("update cases set invoice_number='SPOOF',price_overridden=true,lab_shade='A1',discount=9,billing_note='SPOOF',total_price=1 where id=1");
assert.deepEqual((await db.query('select * from cases where id=1')).rows[0],before[0]);
await actor("update cases set lab_shade='A2',discount=1,billing_note='Example note' where id=2");
assert.equal((await db.query('select lab_shade from cases where id=2')).rows[0].lab_shade,'A2');
await actor("update clinics set is_exclusive=true,status='pending',name='Example Clinic Updated' where id=1");
assert.deepEqual((await db.query('select is_exclusive,status,name from clinics')).rows[0],{is_exclusive:false,status:'active',name:'Example Clinic Updated'});
await actor("update labs set status='pending',noor_enabled=true,auto_completed_billing=false,name='Example Lab Updated' where id=1");
assert.deepEqual((await db.query('select status,noor_enabled,auto_completed_billing,name from labs')).rows[0],{status:'active',noor_enabled:false,auto_completed_billing:true,name:'Example Lab Updated'});
await db.exec("set test.admin='true'");
await actor('update clinics set is_exclusive=true where id=1');
assert.equal((await db.query('select is_exclusive from clinics')).rows[0].is_exclusive,true);
await db.exec("set test.admin='false'");
await actor("update cases set invoice_number='SERVICE-EXAMPLE' where id=1",'service_role');
assert.equal((await db.query('select invoice_number from cases where id=1')).rows[0].invoice_number,'SERVICE-EXAMPLE');
await db.close();
console.log('PASS: actual security migrations preserve rows; membership relocation/reassignment denied; invite claiming and same-lab edits preserved; financial/platform guards and service/admin paths verified.');
