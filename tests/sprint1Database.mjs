import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const fn = (name) => {
  const start = schema.lastIndexOf(name === "clinic_case_visible" ? "create or replace function clinic_case_visible(p_clinic uuid, p_created_by uuid)" : `create or replace function ${name}(`);
  const tail = schema.slice(start);
  const match = tail.match(/^[\s\S]*?\$\$(?: language plpgsql)?;/);
  assert.ok(start >= 0 && match, name);
  return match[0];
};
const ids = Object.fromEntries(['owner','reception','doctor','invited','otherDoctor','foreignOwner','clinic','foreignClinic','lab'].map((n,i)=>[n,`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`]));
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key,email text);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql stable security definer as $$select jsonb_build_object('email',email) from auth.users where id=auth.uid()$$;
create table profiles(id uuid primary key,role text,name text,status text default 'active',clinic_id uuid);
create table clinics(id uuid primary key,owner_id uuid,dentist text,status text default 'active',name text);
create table clinic_members(id uuid primary key default gen_random_uuid(),clinic_id uuid,user_id uuid,role text,email text,unique(clinic_id,user_id));
create table clinic_invitations(id uuid primary key default gen_random_uuid(),clinic_id uuid,email text,role text,invited_by uuid,token text default gen_random_uuid()::text,status text default 'pending',expires_at timestamptz default now()+interval '7 days',created_at timestamptz default now());
create unique index clinic_invitations_pending_key on clinic_invitations(clinic_id,lower(email)) where status='pending';
create table cases(id text primary key,clinic_id uuid,lab_id uuid,created_by uuid,created_at timestamptz default now(),prescription jsonb default '{}',patient_name text default 'Fictional Patient',patient_id text,patient_phone text,appointment_date date,delivery_time text);
create table case_notes(id uuid default gen_random_uuid(),case_id text,body text);
create table case_rounds(id uuid default gen_random_uuid(),parent_case_id text,attachments jsonb);
create table case_clarifications(id uuid default gen_random_uuid(),case_id text,status text);
create table case_flags(id uuid default gen_random_uuid(),case_id text,visible_to text);
create function is_admin() returns boolean language sql stable as $$select false$$;
create function my_lab_id() returns uuid language sql stable as $$select nullif(current_setting('test.lab',true),'')::uuid$$;
create function lab_write_allowed() returns boolean language sql stable as $$select true$$;
create function clinic_can_use_lab(c uuid,l uuid) returns boolean language sql stable as $$select c='${ids.clinic}' and l='${ids.lab}'$$;
${fn('is_active_user')}
${fn('my_clinic_ids')}
${fn('my_clinic_role')}
${fn('has_clinic_role')}
${fn('clinic_owner')}
${fn('clinic_case_visible')}
${fn('stamp_case_creator')}
${fn('guard_prescription_edits')}
${fn('guard_clinic_invitation')}
${fn('accept_clinic_invitation')}
create trigger cases_stamp_creator before insert on cases for each row execute function stamp_case_creator();
create trigger cases_guard_prescription before update on cases for each row execute function guard_prescription_edits();
create trigger clinic_invitations_guard before update on clinic_invitations for each row execute function guard_clinic_invitation();
alter table cases enable row level security;
alter table case_notes enable row level security;
alter table case_rounds enable row level security;
alter table case_clarifications enable row level security;
alter table case_flags enable row level security;
alter table clinic_invitations enable row level security;
grant usage on schema auth to authenticated,anon;
grant select,insert,update,delete on all tables in schema public to authenticated;
create policy clinic_invitations_select on clinic_invitations for select using(has_clinic_role(clinic_id,array['admin','receptionist']));
create policy clinic_invitations_insert on clinic_invitations for insert with check(invited_by=auth.uid() and (has_clinic_role(clinic_id,array['admin']) or (has_clinic_role(clinic_id,array['receptionist']) and role<>'admin')));
create policy clinic_invitations_update on clinic_invitations for update using(has_clinic_role(clinic_id,array['admin','receptionist']));
`);
for (const who of ['owner','reception','doctor','invited','otherDoctor','foreignOwner']) {
  await db.query('insert into auth.users values($1,$2)',[ids[who],`${who}@example.test`]);
  await db.query('insert into profiles(id,role,name) values($1,\'dentist\',$2)',[ids[who],`Example ${who}`]);
}
await db.exec(`insert into clinics values('${ids.clinic}','${ids.owner}','Example Owner','active','Example Clinic'),('${ids.foreignClinic}','${ids.foreignOwner}','Example Foreign','active','Other Clinic');`);
for (const [who,role] of [['owner','admin'],['reception','receptionist'],['doctor','doctor'],['otherDoctor','doctor']]) {
  await db.query('insert into clinic_members(clinic_id,user_id,role,email) values($1,$2,$3,$4)',[ids.clinic,ids[who],role,`${who}@example.test`]);
}
await db.query('insert into clinic_members(clinic_id,user_id,role,email) values($1,$2,\'admin\',$3)',[ids.foreignClinic,ids.foreignOwner,'foreignOwner@example.test']);
const migration = readFileSync(new URL('../supabase/migrations/20260912_clinic_dentist_delegation.sql',import.meta.url),'utf8');
await db.exec(migration); await db.exec(migration);
const actor = async (who, lab='') => {
  await db.exec('reset role');
  await db.query("select set_config('test.uid',$1,false),set_config('test.lab',$2,false)",[ids[who] ?? '',lab]);
  await db.exec('set role authenticated');
};
const count = async (table) => Number((await db.query(`select count(*) as n from ${table}`)).rows[0].n);
const insert = (id, dentist, clinic=ids.clinic) => db.query('insert into cases(id,clinic_id,lab_id,treating_dentist_id,created_by,treating_dentist_name) values($1,$2,$3,$4,$5,\'Spoofed name\') returning *',[id,clinic,ids.lab,dentist,ids.foreignOwner]);
await actor('reception');
assert.equal(await count('clinic_dentists'),3,'doctor roster and existing owner backfilled, no receptionists');
const dentist = (await db.query('select id from clinic_dentists where user_id=$1',[ids.doctor])).rows[0].id;
const own = (await db.query('select id from clinic_dentists where user_id=$1',[ids.owner])).rows[0].id;
const saved=(await insert('C-DELEGATED',dentist)).rows[0];
assert.equal(saved.created_by,ids.reception,'actual submitter stamped despite spoof');
assert.equal(saved.treating_dentist_name,'Example doctor','server snapshots dentist name');
await assert.rejects(insert('C-NO-DENTIST',null),/Select a treating dentist/);
await assert.rejects(insert('C-CROSS-TENANT',dentist,ids.foreignClinic),/sending clinic/);
await assert.rejects(db.query('update cases set treating_dentist_id=$1 where id=\'C-DELEGATED\'',[own]),/cannot be changed/);
await assert.rejects(db.exec("update cases set prescription='{\"notes\":\"changed\"}' where id='C-DELEGATED'"),/Receptionists cannot change/);
await assert.rejects(db.exec("insert into clinic_dentists(clinic_id,name,email) values(null,'Spoof','spoof@example.test')"),/permission denied/);
const invitation = async(email,name='Example Invited',role='doctor',clinic=ids.clinic)=>db.query('insert into clinic_invitations(clinic_id,email,dentist_name,role,invited_by) values($1,$2,$3,$4,auth.uid()) returning *',[clinic,email,name,role]);
await assert.rejects(invitation('invalid','Example'),/valid dentist email/);
await assert.rejects(invitation('empty@example.test',''),/dentist name/);
await assert.rejects(invitation('admin@example.test','Example','admin'),/row-level security/);
await assert.rejects(invitation('outsider@example.test','Example','doctor',ids.foreignClinic),/row-level security/);
await assert.rejects(invitation('doctor@example.test'),/already belongs/);
const inv=(await invitation('invited@example.test')).rows[0];
const pending=(await db.query('select * from clinic_dentists where invitation_id=$1',[inv.id])).rows[0];
assert.equal(pending.user_id,null);
await insert('C-PENDING',pending.id);
await assert.rejects(invitation('INVITED@example.test'),/duplicate key/);
await db.exec("insert into case_notes(case_id,body) values('C-PENDING','Fictional note'); insert into case_rounds(parent_case_id,attachments) values('C-PENDING','[]');");
await db.exec('reset role');
await db.exec("insert into case_clarifications(case_id,status) values('C-PENDING','open'); insert into case_flags(case_id,visible_to) values('C-PENDING','clinic'),('C-PENDING','lab');");
await actor('invited');
assert.equal(await count('cases'),0,'invitation alone grants no access');
await db.query('select accept_clinic_invitation($1,$2)',[inv.token,'Example Invited']);
assert.equal(await count('cases'),1,'accepted dentist sees earlier delegated case');
assert.equal(await count('case_notes'),1); assert.equal(await count('case_rounds'),1);
assert.equal(await count('case_clarifications'),1); assert.equal(await count('case_flags'),1,'lab-only flag remains hidden');
await db.exec("update cases set prescription='{\"notes\":\"Doctor edit\",\"files\":[{\"url\":\"https://example.test/fictional-photo.jpg\"}]}' where id='C-PENDING'");
assert.equal((await db.query("select can_read_case_photo('fictional-photo.jpg') as ok")).rows[0].ok,true);
await assert.rejects(insert('C-SPOOF-DOCTOR',dentist),/only submit their own/);
await assert.rejects(invitation('doctor-invite@example.test'),/row-level security/);
await actor('otherDoctor');
assert.equal(await count('cases'),0); assert.equal(await count('case_notes'),0); assert.equal(await count('case_rounds'),0);
assert.equal((await db.query("select can_read_case_photo('fictional-photo.jpg') as ok")).rows[0].ok,false);
await actor('doctor');
assert.equal(await count('cases'),1);
const legacy=(await insert('C-SELF',null)).rows[0]; assert.equal(legacy.treating_dentist_id,dentist,'old doctor client gets self attribution');
await actor('foreignOwner'); assert.equal(await count('cases'),0);
await actor('owner');
const revoke=(await invitation('revoked@example.test')).rows[0];
const revokedDentist=(await db.query('select id from clinic_dentists where invitation_id=$1',[revoke.id])).rows[0].id;
await db.query("update clinic_invitations set status='revoked' where id=$1",[revoke.id]);
await assert.rejects(insert('C-REVOKED',revokedDentist),/active dentist/);
await invitation('revoked@example.test');
assert.equal((await db.query('select active from clinic_dentists where id=$1',[revokedDentist])).rows[0].active,true,'re-invitation reuses stable identity');
await db.query('delete from clinic_members where clinic_id=$1 and user_id=$2',[ids.clinic,ids.invited]);
await assert.rejects(insert('C-REMOVED',pending.id),/active dentist/);
await actor('invited'); assert.equal(await count('cases'),0,'removal revokes delegated access');
await actor('owner');
const reinvited=(await invitation('invited@example.test')).rows[0];
const relinked=(await db.query('select * from clinic_dentists where invitation_id=$1',[reinvited.id])).rows[0];
assert.equal(relinked.id,pending.id); assert.equal(relinked.active,true); assert.equal(relinked.user_id,null);
await insert('C-REINVITED',pending.id);
await actor('invited'); await db.query('select accept_clinic_invitation($1,$2)',[reinvited.token,'Example Invited']);
assert.equal(await count('cases'),2,'reinvitation preserves earlier attribution');
await actor('owner');
await db.exec('reset role');
await db.query("update profiles set status='inactive' where id=$1",[ids.doctor]);
await actor('owner'); await assert.rejects(insert('C-INACTIVE',dentist),/inactive/);
await actor('doctor'); assert.equal(await count('cases'),0,'inactive account has no access');
await actor(null,ids.lab); assert.ok(await count('cases')>=3,'assigned lab retains visibility');
await db.exec('reset role; set role anon');
await assert.rejects(db.exec('select * from clinic_dentists'),/permission denied/);

// Regression: an invitation created before named dentist rosters existed.
await db.exec('reset role; alter table clinic_invitations disable trigger clinic_invitations_sync_dentist');
const legacyInvite=(await db.query("insert into clinic_invitations(clinic_id,email,role,invited_by,expires_at) values($1,'legacy@example.test','doctor',$2,now()-interval '1 day') returning *",[ids.clinic,ids.owner])).rows[0];
await db.exec('alter table clinic_invitations enable trigger clinic_invitations_sync_dentist');
const repair=readFileSync(new URL('../supabase/migrations/20260912_reuse_pending_dentist_invites.sql',import.meta.url),'utf8');
await db.exec(repair); await db.exec(repair);
const addDentist=(name,email,clinic=ids.clinic)=>db.query('select add_clinic_dentist($1,$2,$3) as result',[clinic,name,email]);
await actor('reception');
const before=await count('clinic_invitations');
const repaired=(await addDentist('Example Legacy Dentist',' LEGACY@example.test ')).rows[0].result;
assert.equal(repaired.id,legacyInvite.id); assert.equal(repaired.reused,true);
assert.equal(await count('clinic_invitations'),before,'reusing an invite does not send a duplicate invitation');
const unchanged=(await db.query('select token,expires_at,dentist_name from clinic_invitations where id=$1',[legacyInvite.id])).rows[0];
assert.equal(unchanged.token,legacyInvite.token); assert.deepEqual(unchanged.expires_at,legacyInvite.expires_at);
assert.equal(unchanged.dentist_name,'','legacy invitation stays unchanged');
await insert('C-LEGACY-PENDING',repaired.dentist_id);
const repeated=(await addDentist('Example Legacy Dentist','legacy@example.test')).rows[0].result;
assert.equal(repeated.dentist_id,repaired.dentist_id,'repeated Add is idempotent');
const newDentist=(await addDentist('Example Brand New','brandnew@example.test')).rows[0].result;
assert.equal(newDentist.reused,false); assert.ok(newDentist.dentist_id);
await insert('C-BRAND-NEW-PENDING',newDentist.dentist_id);
assert.equal(await count('clinic_invitations'),before+1);
const member=(await addDentist('Example Owner','owner@example.test')).rows[0].result;
assert.equal(member.dentist_id,own,'existing clinic dentist reused');
await assert.rejects(addDentist('Example','other@example.test',ids.foreignClinic),/Only this clinic/);
await assert.rejects(addDentist(' ','blank@example.test'),/dentist name/);
await assert.rejects(addDentist('Example','bad-email'),/valid dentist email/);
await invitation('frontdesk@example.test','Example','receptionist');
await assert.rejects(addDentist('Example','frontdesk@example.test'),/another clinic role/);
await actor('otherDoctor');
await assert.rejects(addDentist('Example','no@example.test'),/Only this clinic/);
await db.exec('reset role; set role anon');
await assert.rejects(addDentist('Example','no@example.test'),/permission denied/);

// Sprint 1 runs against the prior delegation fixture, preserving all old rows.
await db.exec('reset role');
const incomplete='00000000-0000-4000-8000-000000000098';
await db.query("insert into auth.users values($1,'incomplete@example.test')",[incomplete]);
const tables=['cases','profiles','clinic_members','clinic_invitations','clinic_dentists','auth.users','case_notes','case_rounds','case_flags','case_clarifications'];
const baseline={};
for(const table of tables) baseline[table]=(await db.query(`select * from ${table} order by 1`)).rows;
const sprint=readFileSync(new URL('../supabase/migrations/20260912_sprint1_safe_onboarding.sql',import.meta.url),'utf8');
await db.exec(sprint);
for(const table of tables) {
 const rows=(await db.query(`select * from ${table} order by 1`)).rows;
 if(table==='cases') for(const row of rows) {assert.equal(row.submitted_by_name,null);delete row.submitted_by_name;}
 assert.deepEqual(rows,baseline[table],`${table} historical data unchanged`);
}
assert.equal(await count('sprint1_onboarding'),0,'no existing accounts enrolled');
await db.exec('update sprint1_onboarding_settings set enabled=true');
await db.query("select set_config('test.uid',$1,false)",[incomplete]);
await db.exec('set role authenticated');
assert.equal((await db.query('select sprint1_onboarding_pending() as pending')).rows[0].pending,false,'old account without profile/cases is excluded');
await actor('owner');
assert.equal((await db.query('select sprint1_onboarding_pending() as pending')).rows[0].pending,false);
await assert.rejects(db.exec('insert into sprint1_onboarding(user_id) values(auth.uid())'),/permission denied/);
await assert.rejects(db.exec('update sprint1_onboarding_settings set enabled=true'),/permission denied/);
// Legacy invitation API remains usable with omitted name and unchanged token.
const legacyClientInvite=(await db.query("insert into clinic_invitations(clinic_id,email,role,invited_by) values($1,'oldclient@example.test','doctor',auth.uid()) returning *",[ids.clinic])).rows[0];
assert.equal(legacyClientInvite.dentist_name,'');
assert.equal((await db.query('select count(*)::int as n from clinic_dentists where invitation_id=$1',[legacyClientInvite.id])).rows[0].n,0);
await actor('reception');
const fresh=(await insert('C-SPRINT1',own)).rows[0];
assert.equal(fresh.submitted_by_name,'Example reception');
assert.equal(fresh.created_by,ids.reception);
const spoof=(await db.query("insert into cases(id,clinic_id,lab_id,treating_dentist_id,submitted_by_name) values('C-SPRINT1-SPOOF',$1,$2,$3,'Forged') returning submitted_by_name",[ids.clinic,ids.lab,own])).rows[0];
assert.equal(spoof.submitted_by_name,'Example reception');
await assert.rejects(db.exec("update cases set submitted_by_name='Forged' where id='C-SPRINT1'"),/immutable/);
await db.exec('reset role');
const newcomer='00000000-0000-4000-8000-000000000099';
await db.query("insert into auth.users values($1,'new-user@example.test')",[newcomer]);
assert.equal(await count('sprint1_onboarding'),1);
await db.query("select set_config('test.uid',$1,false)",[newcomer]);
await db.exec('set role authenticated');
assert.equal((await db.query('select sprint1_onboarding_pending() as pending')).rows[0].pending,true);
await db.exec('select sprint1_dismiss_onboarding(); select sprint1_dismiss_onboarding();');
assert.equal((await db.query('select sprint1_onboarding_pending() as pending')).rows[0].pending,false);
await db.exec('reset role');
await db.exec("update sprint1_onboarding_settings set enabled=false");
await db.exec('set role anon');
await assert.rejects(db.exec('select sprint1_dismiss_onboarding()'),/permission denied/);
await db.exec('reset role');
await assert.rejects(db.exec(sprint),/already exists/);
await db.exec('rollback');
assert.equal((await db.query("select submitted_by_name from cases where id='C-SPRINT1'")).rows[0].submitted_by_name,'Example reception','rerun abort retains new data');
console.log('Sprint 1: historical rows preserved; identities, old invitations, new-account-only guidance and permissions passed.');
await db.close();
console.log('PASS: dentist invitations, immediate selection, acceptance linking, attribution, role and tenant isolation, notes/photos/Noor visibility, removal, inactive accounts, legacy submission and migration rerun.');
