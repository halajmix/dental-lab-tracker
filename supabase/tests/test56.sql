-- Role-based RLS test matrix for Phase 56. Runs as one psql session;
-- identity is simulated per scenario via request.jwt.claim.sub + role.
\set ON_ERROR_STOP on

-- ---------- fixture (as postgres, RLS bypassed) ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner1@t.t'),
  ('00000000-0000-0000-0000-000000000002', 'doc1@t.t'),
  ('00000000-0000-0000-0000-000000000003', 'recep1@t.t'),
  ('00000000-0000-0000-0000-000000000004', 'doc2@t.t'),
  ('00000000-0000-0000-0000-000000000005', 'labuser@t.t'),
  ('00000000-0000-0000-0000-000000000006', 'outsider@t.t'),
  ('00000000-0000-0000-0000-000000000007', 'super@t.t');

insert into clinics (id, owner_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'Clinic A'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000006', 'Clinic B');

insert into labs (id, owner_id, name) values
  ('11111111-0000-0000-0000-00000000001a', '00000000-0000-0000-0000-000000000005', 'Lab L');

insert into profiles (id, role, clinic_id, lab_id, name) values
  ('00000000-0000-0000-0000-000000000001', 'dentist', 'aaaaaaaa-0000-0000-0000-00000000000a', null, 'Owner One'),
  ('00000000-0000-0000-0000-000000000002', 'dentist', 'aaaaaaaa-0000-0000-0000-00000000000a', null, 'Doc One'),
  ('00000000-0000-0000-0000-000000000003', 'dentist', 'aaaaaaaa-0000-0000-0000-00000000000a', null, 'Recep One'),
  ('00000000-0000-0000-0000-000000000004', 'dentist', 'aaaaaaaa-0000-0000-0000-00000000000a', null, 'Doc Two'),
  ('00000000-0000-0000-0000-000000000005', 'lab',     null, '11111111-0000-0000-0000-00000000001a', 'Lab User'),
  ('00000000-0000-0000-0000-000000000006', 'dentist', 'bbbbbbbb-0000-0000-0000-00000000000b', null, 'Outsider'),
  ('00000000-0000-0000-0000-000000000007', 'admin',   null, null, 'Super');

-- staff memberships (owner rows were auto-created by the backfill in phase56)
insert into clinic_members (clinic_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000002', 'doctor'),
  ('aaaaaaaa-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000003', 'receptionist'),
  ('aaaaaaaa-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000004', 'doctor');

insert into cases (id, clinic_id, lab_id, created_by, patient_name) values
  ('CX', 'aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-00000000001a', '00000000-0000-0000-0000-000000000002', 'Px X'),
  ('CY', 'aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-00000000001a', '00000000-0000-0000-0000-000000000004', 'Px Y'),
  ('CZ', 'bbbbbbbb-0000-0000-0000-00000000000b', '11111111-0000-0000-0000-00000000001a', '00000000-0000-0000-0000-000000000006', 'Px Z');
insert into cases (id, clinic_id, lab_id, created_by, patient_name, created_at) values
  ('CO', 'aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-00000000001a', '00000000-0000-0000-0000-000000000002', 'Px Old', now() - interval '2 hours');

insert into case_notes (case_id, author_id, body) values
  ('CY', '00000000-0000-0000-0000-000000000004', 'note on CY');

-- verify the owner backfill ran (owner rows exist as admin)
do $$ begin
  assert (select count(*) from clinic_members where role = 'admin'
          and user_id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000006')) = 2,
    'owner backfill missing';
  raise notice 'PASS 01 owner backfill -> admin member rows';
end $$;

-- ---------- doc1: sees only own clinic-A cases ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
set role authenticated;
do $$ begin
  assert (select array_agg(id order by id) from cases) = array['CO', 'CX'], 'doc1 visibility wrong';
  raise notice 'PASS 02 doctor sees only own cases';
end $$;

-- doc1 cannot read the note on doc2's case
do $$ begin
  assert (select count(*) from case_notes) = 0, 'doc1 sees CY note';
  raise notice 'PASS 03 notes follow doctor case scope';
end $$;

-- doc1 insert: allowed for own clinic, created_by spoof overridden
insert into cases (id, clinic_id, lab_id, created_by, patient_name)
values ('CN1', 'aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-00000000001a',
        '00000000-0000-0000-0000-000000000001', 'Spoof Attempt');
do $$ begin
  assert (select created_by from cases where id = 'CN1') = '00000000-0000-0000-0000-000000000002',
    'created_by not stamped from JWT';
  raise notice 'PASS 04 insert stamps created_by from JWT (spoof ignored)';
end $$;

-- doc1 insert into clinic B: rejected by RLS
do $$ begin
  begin
    insert into cases (id, clinic_id, patient_name) values ('CN2', 'bbbbbbbb-0000-0000-0000-00000000000b', 'x');
    raise exception 'TEST-FAIL: doctor inserted into foreign clinic';
  exception when sqlstate '42501' then
    raise notice 'PASS 05 doctor cannot submit for a clinic they do not belong to';
  end;
end $$;

-- doc1 cannot update doc2's case (invisible -> 0 rows)
do $$
declare n int;
begin
  with d as (update cases set patient_phone = '123' where id = 'CY' returning 1)
  select count(*) into n from d;
  assert n = 0, 'doc1 updated CY';
  raise notice 'PASS 06 doctor cannot touch a colleague''s case';
end $$;

-- doc1 edits own fresh Rx: allowed
update cases set prescription = '{"category":"Crown"}' where id = 'CX';
do $$ begin
  assert (select prescription->>'category' from cases where id = 'CX') = 'Crown', 'fresh Rx edit lost';
  raise notice 'PASS 07 doctor edits own Rx inside 30 minutes';
end $$;

-- doc1 edits own OLD Rx: 30-minute guard raises
do $$ begin
  begin
    update cases set prescription = '{"category":"Late"}' where id = 'CO';
    raise exception 'TEST-FAIL: 30-minute guard did not fire';
  exception when others then
    if sqlerrm not like 'This prescription can no longer be edited%' then raise; end if;
    raise notice 'PASS 08 30-minute Rx window still enforced for doctors';
  end;
end $$;

-- ---------- recep1: sees all clinic-A cases, no clinical writes ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
do $$ begin
  assert (select array_agg(id order by id) from cases) = array['CN1', 'CO', 'CX', 'CY'],
    'receptionist visibility wrong';
  raise notice 'PASS 09 receptionist sees every clinic case';
end $$;

do $$ begin
  assert (select count(*) from case_notes) = 1, 'receptionist cannot see CY note';
  raise notice 'PASS 10 receptionist reads notes on any clinic case';
end $$;

-- receptionist front-desk write (non-clinical column): allowed
update cases set cancel_status = 'requested' where id = 'CY';
do $$ begin
  assert (select cancel_status from cases where id = 'CY') = 'requested', 'front-desk write failed';
  raise notice 'PASS 11 receptionist can perform front-desk case updates';
end $$;

-- receptionist touching clinical columns: raises
do $$ begin
  begin
    update cases set prescription = '{"category":"Hack"}' where id = 'CX';
    raise exception 'TEST-FAIL: receptionist edited Rx';
  exception when others then
    if sqlerrm not like 'Receptionists cannot change prescription%' then raise; end if;
    raise notice 'PASS 12 receptionist blocked from clinical parameters';
  end;
end $$;

-- receptionist creating a case: rejected
do $$ begin
  begin
    insert into cases (id, clinic_id, patient_name) values ('CN3', 'aaaaaaaa-0000-0000-0000-00000000000a', 'x');
    raise exception 'TEST-FAIL: receptionist created a case';
  exception when sqlstate '42501' then
    raise notice 'PASS 13 receptionist cannot author cases';
  end;
end $$;

-- ---------- owner1 (admin): full clinic scope ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
do $$ begin
  assert (select count(*) from cases) = 4, 'owner does not see all clinic cases';
  raise notice 'PASS 14 owner/admin sees every clinic case';
end $$;

-- admin edits any fresh clinic Rx (not their own case)
update cases set prescription = '{"category":"AdminFix"}' where id = 'CN1';
do $$ begin
  assert (select prescription->>'category' from cases where id = 'CN1') = 'AdminFix', 'admin Rx edit failed';
  raise notice 'PASS 15 admin can edit any fresh clinic Rx';
end $$;

-- ---------- roster & role management ----------
-- doc1 sees the roster and co-member profiles but cannot manage roles
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
do $$
declare n int;
begin
  assert (select count(*) from clinic_members where clinic_id = 'aaaaaaaa-0000-0000-0000-00000000000a') = 4,
    'doc1 cannot see full roster';
  assert (select count(*) from profiles where id = '00000000-0000-0000-0000-000000000003') = 1,
    'doc1 cannot see co-member profile';
  with d as (update clinic_members set role = 'admin'
             where user_id = '00000000-0000-0000-0000-000000000002' returning 1)
  select count(*) into n from d;
  assert n = 0, 'doctor self-promoted';
  raise notice 'PASS 16 members see roster + profiles; doctors cannot change roles';
end $$;

-- outsider sees nothing of clinic A
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', false);
do $$ begin
  assert (select count(*) from clinic_members where clinic_id = 'aaaaaaaa-0000-0000-0000-00000000000a') = 0,
    'outsider sees clinic A roster';
  assert (select count(*) from profiles where id = '00000000-0000-0000-0000-000000000002') = 0,
    'outsider sees clinic A profile';
  assert (select count(*) from cases where clinic_id = 'aaaaaaaa-0000-0000-0000-00000000000a') = 0,
    'outsider sees clinic A cases';
  raise notice 'PASS 17 cross-clinic isolation holds';
end $$;

-- owner1 manages roles, but the owner row itself is untouchable
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
do $$
declare n int;
begin
  with d as (update clinic_members set role = 'receptionist'
             where user_id = '00000000-0000-0000-0000-000000000004'
               and clinic_id = 'aaaaaaaa-0000-0000-0000-00000000000a' returning 1)
  select count(*) into n from d;
  assert n = 1, 'owner could not change a member role';
  with d as (update clinic_members set role = 'doctor'
             where user_id = '00000000-0000-0000-0000-000000000001' returning 1)
  select count(*) into n from d;
  assert n = 0, 'owner row was demoted';
  with d as (delete from clinic_members
             where user_id = '00000000-0000-0000-0000-000000000001' returning 1)
  select count(*) into n from d;
  assert n = 0, 'owner row was deleted';
  raise notice 'PASS 18 admin manages roles; owner row protected';
end $$;

-- doc2 became receptionist above -> can no longer author cases
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
do $$ begin
  begin
    insert into cases (id, clinic_id, patient_name) values ('CN4', 'aaaaaaaa-0000-0000-0000-00000000000a', 'x');
    raise exception 'TEST-FAIL: demoted doctor still creates cases';
  exception when sqlstate '42501' then
    raise notice 'PASS 19 role change takes effect immediately';
  end;
end $$;

-- ---------- lab side unchanged ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', false);
do $$ begin
  assert (select count(*) from cases) = 5, 'lab does not see its assigned cases';
  raise notice 'PASS 20 lab sees all assigned cases regardless of clinic roles';
end $$;

-- lab Rx write silently reverted, other columns kept (Phase 22 behavior)
update cases set prescription = '{"category":"LabHack"}', cancel_status = 'none' where id = 'CY';
do $$ begin
  assert (select prescription->>'category' from cases where id = 'CY') is distinct from 'LabHack',
    'lab rewrote a prescription';
  assert (select cancel_status from cases where id = 'CY') = 'none', 'lab non-Rx write lost';
  raise notice 'PASS 21 lab Rx writes still silently reverted';
end $$;

-- ---------- deletes ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
do $$
declare n int;
begin
  with d as (delete from cases where id = 'CY' returning 1) select count(*) into n from d;
  assert n = 0, 'doctor deleted a colleague''s case';
  with d as (delete from cases where id = 'CX' returning 1) select count(*) into n from d;
  assert n = 1, 'doctor could not delete own case';
  raise notice 'PASS 22 delete: doctors own-only';
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
do $$
declare n int;
begin
  with d as (delete from cases where id = 'CN1' returning 1) select count(*) into n from d;
  assert n = 1, 'admin could not delete a clinic case';
  raise notice 'PASS 23 delete: admins any clinic case';
end $$;

-- ---------- super admin + misc ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', false);
do $$ begin
  assert (select count(*) from clinic_members) >= 5, 'super admin cannot read memberships';
  raise notice 'PASS 24 super admin reads all memberships';
end $$;

-- can_join_clinic: member yes, outsider no
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
do $$ begin
  assert can_join_clinic('aaaaaaaa-0000-0000-0000-00000000000a'), 'member cannot join own clinic';
  assert not can_join_clinic('bbbbbbbb-0000-0000-0000-00000000000b'), 'member can join foreign clinic';
  raise notice 'PASS 25 can_join_clinic honors membership';
end $$;

-- pending clinic goes dark for members but stays visible to its owner
reset role;
update clinics set status = 'pending' where id = 'bbbbbbbb-0000-0000-0000-00000000000b';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', false);
set role authenticated;
do $$ begin
  assert (select count(*) from cases) = 0, 'pending clinic still shows cases';
  assert (select count(*) from clinics where id = 'bbbbbbbb-0000-0000-0000-00000000000b') = 1,
    'pending clinic owner lost the awaiting-activation row';
  raise notice 'PASS 26 activation gate still works through membership helpers';
end $$;

-- new clinic insert -> owner membership trigger
reset role;
insert into clinics (id, owner_id, name) values
  ('cccccccc-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000006', 'Clinic C');
do $$ begin
  assert (select role from clinic_members
          where clinic_id = 'cccccccc-0000-0000-0000-00000000000c'
            and user_id = '00000000-0000-0000-0000-000000000006') = 'admin',
    'owner membership trigger missing';
  raise notice 'PASS 27 new clinic owners auto-join as admin';
end $$;

select 'ALL PHASE 56 TESTS PASSED' as result;
