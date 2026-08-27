-- Phase 58 test matrix: exclusive clinics, private labs, the access map,
-- and per-sending-clinic case enforcement. Apply stub.sql + phases 56-58
-- on a FRESH database first.
\set ON_ERROR_STOP on

-- ---------- fixture (as postgres, RLS bypassed) ----------
insert into auth.users (id, email) values
  ('20000000-0000-0000-0000-000000000001', 'stdowner@t.t'),
  ('20000000-0000-0000-0000-000000000002', 'excowner@t.t'),
  ('20000000-0000-0000-0000-000000000003', 'multidoc@t.t'),
  ('20000000-0000-0000-0000-000000000004', 'privlab@t.t'),
  ('20000000-0000-0000-0000-000000000005', 'publab@t.t'),
  ('20000000-0000-0000-0000-000000000007', 'super@t.t');

insert into clinics (id, owner_id, name) values
  ('aaaaaaaa-2000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001', 'Standard Clinic'),
  ('bbbbbbbb-2000-0000-0000-00000000000b', '20000000-0000-0000-0000-000000000002', 'Exclusive Clinic');

insert into labs (id, owner_id, name) values
  ('33333333-2000-0000-0000-00000000003a', '20000000-0000-0000-0000-000000000005', 'Public Lab'),
  ('33333333-2000-0000-0000-00000000003b', '20000000-0000-0000-0000-000000000004', 'Private Lab'),
  ('33333333-2000-0000-0000-00000000003c', null, 'Orphan Lab');

insert into profiles (id, role, clinic_id, lab_id, name) values
  ('20000000-0000-0000-0000-000000000001', 'dentist', 'aaaaaaaa-2000-0000-0000-00000000000a', null, 'Std Owner'),
  ('20000000-0000-0000-0000-000000000002', 'dentist', 'bbbbbbbb-2000-0000-0000-00000000000b', null, 'Exc Owner'),
  ('20000000-0000-0000-0000-000000000003', 'dentist', 'bbbbbbbb-2000-0000-0000-00000000000b', null, 'Multi Doc'),
  ('20000000-0000-0000-0000-000000000004', 'lab', null, '33333333-2000-0000-0000-00000000003b', 'Priv Lab User'),
  ('20000000-0000-0000-0000-000000000005', 'lab', null, '33333333-2000-0000-0000-00000000003a', 'Pub Lab User'),
  ('20000000-0000-0000-0000-000000000007', 'admin', null, null, 'Super');

-- multidoc: doctor at BOTH clinics
insert into clinic_members (clinic_id, user_id, role, email) values
  ('aaaaaaaa-2000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000003', 'doctor', 'multidoc@t.t'),
  ('bbbbbbbb-2000-0000-0000-00000000000b', '20000000-0000-0000-0000-000000000003', 'doctor', 'multidoc@t.t');

-- flags + map: Exclusive Clinic is exclusive and mapped ONLY to Private Lab
update clinics set is_exclusive = true where id = 'bbbbbbbb-2000-0000-0000-00000000000b';
update labs set is_public = false where id = '33333333-2000-0000-0000-00000000003b';
insert into clinic_lab_access (clinic_id, lab_id) values
  ('bbbbbbbb-2000-0000-0000-00000000000b', '33333333-2000-0000-0000-00000000003b');

-- historical case: Standard Clinic once used Private Lab (never mapped)
insert into cases (id, clinic_id, lab_id, created_by, patient_name) values
  ('H1', 'aaaaaaaa-2000-0000-0000-00000000000a', '33333333-2000-0000-0000-00000000003b',
   '20000000-0000-0000-0000-000000000001', 'History Px');

-- ---------- standard clinic ----------
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', false);
set role authenticated;
do $$
declare names text;
begin
  select string_agg(name, ',' order by name) into names from labs;
  -- public yes, orphan yes (claim flow), private yes ONLY via the H1 case
  assert names = 'Orphan Lab,Private Lab,Public Lab', 'std sees: ' || coalesce(names, '(none)');
  raise notice 'PASS 01 standard clinic: public + orphan + case-history labs';
end $$;

-- delete the historical case (as postgres) and the private lab vanishes
reset role;
delete from cases where id = 'H1';
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', false);
set role authenticated;
do $$
declare names text;
begin
  select string_agg(name, ',' order by name) into names from labs;
  assert names = 'Orphan Lab,Public Lab', 'std sees: ' || coalesce(names, '(none)');
  raise notice 'PASS 02 private lab hidden from unmapped standard clinic';
end $$;

-- standard clinic can send to the public lab, not the private one
insert into cases (id, clinic_id, lab_id, patient_name)
values ('C1', 'aaaaaaaa-2000-0000-0000-00000000000a', '33333333-2000-0000-0000-00000000003a', 'Std Px');
do $$ begin
  begin
    insert into cases (id, clinic_id, lab_id, patient_name)
    values ('C2', 'aaaaaaaa-2000-0000-0000-00000000000a', '33333333-2000-0000-0000-00000000003b', 'x');
    raise exception 'TEST-FAIL: standard clinic sent to a private unmapped lab';
  exception when sqlstate '42501' then
    raise notice 'PASS 03 sends: public lab ok, private unmapped lab blocked';
  end;
end $$;

-- ---------- exclusive clinic ----------
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', false);
do $$
declare names text;
begin
  select string_agg(name, ',' order by name) into names from labs;
  -- mapped private lab yes; PUBLIC lab hidden (exclusive!); orphan stays (claim flow)
  assert names = 'Orphan Lab,Private Lab', 'exc sees: ' || coalesce(names, '(none)');
  raise notice 'PASS 04 exclusive clinic sees only its contracted lab (+ claimable orphans)';
end $$;

insert into cases (id, clinic_id, lab_id, patient_name)
values ('C3', 'bbbbbbbb-2000-0000-0000-00000000000b', '33333333-2000-0000-0000-00000000003b', 'Exc Px');
do $$ begin
  begin
    insert into cases (id, clinic_id, lab_id, patient_name)
    values ('C4', 'bbbbbbbb-2000-0000-0000-00000000000b', '33333333-2000-0000-0000-00000000003a', 'x');
    raise exception 'TEST-FAIL: exclusive clinic sent to a public lab';
  exception when sqlstate '42501' then
    raise notice 'PASS 05 exclusive clinic can send only to mapped labs';
  end;
end $$;

-- ---------- multi-clinic doctor: check is per SENDING clinic ----------
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000003', false);
do $$ begin
  -- sees the union of both clinics' labs
  assert (select count(*) from labs where name = 'Public Lab') = 1, 'multidoc lost std labs';
  assert (select count(*) from labs where name = 'Private Lab') = 1, 'multidoc lost exc labs';
  begin
    insert into cases (id, clinic_id, lab_id, patient_name)
    values ('C5', 'bbbbbbbb-2000-0000-0000-00000000000b', '33333333-2000-0000-0000-00000000003a', 'x');
    raise exception 'TEST-FAIL: sent FROM exclusive clinic to a lab only its OTHER clinic may use';
  exception when sqlstate '42501' then null;
  end;
  -- same lab is fine from the standard clinic
  insert into cases (id, clinic_id, lab_id, patient_name)
  values ('C6', 'aaaaaaaa-2000-0000-0000-00000000000a', '33333333-2000-0000-0000-00000000003a', 'Multi Px');
  raise notice 'PASS 06 lab check follows the sending clinic, not the doctor''s union';
end $$;

-- ---------- labs still see themselves; access map is admin-only ----------
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000004', false);
do $$ begin
  assert (select count(*) from labs where id = '33333333-2000-0000-0000-00000000003b') = 1,
    'private lab cannot see itself';
  assert (select count(*) from clinic_lab_access) = 0, 'lab reads the access map';
  begin
    insert into clinic_lab_access (clinic_id, lab_id)
    values ('aaaaaaaa-2000-0000-0000-00000000000a', '33333333-2000-0000-0000-00000000003b');
    raise exception 'TEST-FAIL: lab granted itself access';
  exception when sqlstate '42501' then null;
  end;
  raise notice 'PASS 07 lab sees itself; cannot read or write the access map';
end $$;

-- clinic members can read their own mappings (LabPicker filtering)
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', false);
do $$ begin
  assert (select count(*) from clinic_lab_access) = 1, 'clinic cannot read own mapping';
  begin
    delete from clinic_lab_access where clinic_id = 'bbbbbbbb-2000-0000-0000-00000000000b';
    if not found then null; end if;
  end;
  assert (select count(*) from clinic_lab_access) = 1, 'clinic deleted its own mapping restriction';
  raise notice 'PASS 08 clinic reads its mappings; cannot modify them';
end $$;

-- ---------- super admin ----------
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000007', false);
do $$
declare n int;
begin
  assert (select count(*) from labs) = 3, 'admin does not see all labs';
  -- grant + revoke
  insert into clinic_lab_access (clinic_id, lab_id)
  values ('aaaaaaaa-2000-0000-0000-00000000000a', '33333333-2000-0000-0000-00000000003b');
  with d as (delete from clinic_lab_access
             where clinic_id = 'aaaaaaaa-2000-0000-0000-00000000000a' returning 1)
  select count(*) into n from d;
  assert n = 1, 'admin revoke failed';
  -- flag toggles through clinics_update_admin / labs_update_admin
  update clinics set is_exclusive = false where id = 'bbbbbbbb-2000-0000-0000-00000000000b';
  assert (select is_exclusive from clinics where id = 'bbbbbbbb-2000-0000-0000-00000000000b') = false,
    'exclusive toggle failed';
  update clinics set is_exclusive = true where id = 'bbbbbbbb-2000-0000-0000-00000000000b';
  update labs set is_public = true where id = '33333333-2000-0000-0000-00000000003b';
  assert (select is_public from labs where id = '33333333-2000-0000-0000-00000000003b') = true,
    'is_public toggle failed';
  update labs set is_public = false where id = '33333333-2000-0000-0000-00000000003b';
  raise notice 'PASS 09 super admin: full directory, map writes, flag toggles';
end $$;

-- non-admin cannot toggle another clinic's exclusivity (0-row no-op)
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', false);
do $$
declare n int;
begin
  with d as (update clinics set is_exclusive = false
             where id = 'bbbbbbbb-2000-0000-0000-00000000000b' returning 1)
  select count(*) into n from d;
  assert n = 0, 'std owner flipped a foreign clinic exclusive flag';
  raise notice 'PASS 10 flag toggles are admin-only';
end $$;

-- ---------- lab binding freeze ----------
do $$ begin
  update cases set lab_id = '33333333-2000-0000-0000-00000000003b' where id = 'C1';
  assert (select lab_id from cases where id = 'C1') = '33333333-2000-0000-0000-00000000003a',
    'case was re-pointed to another lab';
  raise notice 'PASS 11 case→lab binding frozen for client writers';
end $$;

-- ---------- revoked mapping keeps history readable ----------
reset role;
insert into cases (id, clinic_id, lab_id, created_by, patient_name) values
  ('H2', 'bbbbbbbb-2000-0000-0000-00000000000b', '33333333-2000-0000-0000-00000000003b',
   '20000000-0000-0000-0000-000000000002', 'Hist2');
delete from clinic_lab_access where clinic_id = 'bbbbbbbb-2000-0000-0000-00000000000b';
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', false);
set role authenticated;
do $$ begin
  assert (select count(*) from labs where id = '33333333-2000-0000-0000-00000000003b') = 1,
    'revoked lab vanished from history';
  begin
    insert into cases (id, clinic_id, lab_id, patient_name)
    values ('C7', 'bbbbbbbb-2000-0000-0000-00000000000b', '33333333-2000-0000-0000-00000000003b', 'x');
    raise exception 'TEST-FAIL: sent to a revoked lab';
  exception when sqlstate '42501' then null;
  end;
  raise notice 'PASS 12 revoked mapping: history stays visible, new sends blocked';
end $$;

select 'ALL PHASE 58 TESTS PASSED' as result;
