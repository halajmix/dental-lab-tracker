-- Phase 59 test matrix: per-user activate/deactivate. Apply stub.sql +
-- phases 56-59 on a FRESH database first.
\set ON_ERROR_STOP on

-- ---------- fixture ----------
insert into auth.users (id, email) values
  ('30000000-0000-0000-0000-000000000001', 'owner@t.t'),
  ('30000000-0000-0000-0000-000000000002', 'labtech@t.t'),
  ('30000000-0000-0000-0000-000000000003', 'super@t.t'),
  ('30000000-0000-0000-0000-000000000004', 'super2@t.t'),
  ('30000000-0000-0000-0000-000000000005', 'fresh@t.t');

insert into clinics (id, owner_id, name) values
  ('aaaaaaaa-3000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000001', 'Clinic A');
insert into labs (id, owner_id, name) values
  ('44444444-3000-0000-0000-00000000004a', '30000000-0000-0000-0000-000000000002', 'Lab L');

insert into profiles (id, role, clinic_id, lab_id, name) values
  ('30000000-0000-0000-0000-000000000001', 'dentist', 'aaaaaaaa-3000-0000-0000-00000000000a', null, 'Owner'),
  ('30000000-0000-0000-0000-000000000002', 'lab', null, '44444444-3000-0000-0000-00000000004a', 'Tech'),
  ('30000000-0000-0000-0000-000000000003', 'admin', null, null, 'Super'),
  ('30000000-0000-0000-0000-000000000004', 'admin', null, null, 'Super Two');

insert into cases (id, clinic_id, lab_id, created_by, patient_name) values
  ('U1', 'aaaaaaaa-3000-0000-0000-00000000000a', '44444444-3000-0000-0000-00000000004a',
   '30000000-0000-0000-0000-000000000001', 'Px U');

-- ---------- baseline ----------
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', false);
set role authenticated;
do $$ begin
  assert (select count(*) from cases) = 1, 'baseline owner cannot see case';
  raise notice 'PASS 01 active owner sees their case';
end $$;

-- ---------- deactivate the clinic owner ----------
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000003', false);
select admin_set_user_status('30000000-0000-0000-0000-000000000001', 'inactive');
do $$ begin raise notice 'PASS 02 admin deactivates a user via RPC'; end $$;

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', false);
do $$ begin
  assert (select count(*) from cases) = 0, 'deactivated owner still sees cases';
  assert (select count(*) from my_clinic_ids()) = 0, 'my_clinic_ids not gated';
  assert my_clinic_role('aaaaaaaa-3000-0000-0000-00000000000a') is null, 'role not gated';
  begin
    insert into cases (id, clinic_id, patient_name) values ('U2', 'aaaaaaaa-3000-0000-0000-00000000000a', 'x');
    raise exception 'TEST-FAIL: deactivated user created a case';
  exception when sqlstate '42501' then null;
  end;
  -- their own profile row stays readable (the "deactivated" screen needs it)
  assert (select status from profiles where id = auth.uid()) = 'inactive', 'cannot read own status';
  raise notice 'PASS 03 deactivated owner: zero access, own profile readable';
end $$;

-- self-reactivation attempt is silently frozen
do $$ begin
  update profiles set status = 'active' where id = auth.uid();
  assert (select status from profiles where id = auth.uid()) = 'inactive', 'self-reactivated!';
  raise notice 'PASS 04 self-reactivation blocked by column guard';
end $$;

-- ---------- reactivate ----------
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000003', false);
select admin_set_user_status('30000000-0000-0000-0000-000000000001', 'active');
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', false);
do $$ begin
  assert (select count(*) from cases) = 1, 'reactivated owner still dark';
  raise notice 'PASS 05 reactivation restores access';
end $$;

-- ---------- lab-side gate ----------
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000003', false);
select admin_set_user_status('30000000-0000-0000-0000-000000000002', 'inactive');
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000002', false);
do $$ begin
  assert (select count(*) from cases) = 0, 'deactivated lab user still sees assigned cases';
  assert my_lab_id() is null, 'my_lab_id not gated';
  raise notice 'PASS 06 deactivated lab user goes dark';
end $$;

-- ---------- RPC guard rails ----------
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', false);
do $$ begin
  begin
    perform admin_set_user_status('30000000-0000-0000-0000-000000000002', 'active');
    raise exception 'TEST-FAIL: non-admin flipped a user';
  exception when others then
    if sqlerrm not like 'Only the super admin%' then raise; end if;
  end;
  raise notice 'PASS 07 RPC refuses non-admins';
end $$;

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000003', false);
do $$ begin
  begin
    perform admin_set_user_status('30000000-0000-0000-0000-000000000003', 'inactive');
    raise exception 'TEST-FAIL: admin deactivated self';
  exception when others then
    if sqlerrm not like 'You cannot deactivate your own account%' then raise; end if;
  end;
  begin
    perform admin_set_user_status('30000000-0000-0000-0000-000000000004', 'inactive');
    raise exception 'TEST-FAIL: admin deactivated another admin';
  exception when others then
    if sqlerrm not like 'Admin accounts cannot be deactivated%' then raise; end if;
  end;
  begin
    perform admin_set_user_status('30000000-0000-0000-0000-000000000005', 'inactive');
    raise exception 'TEST-FAIL: status set for a user with no profile';
  exception when others then
    if sqlerrm not like 'No profile found%' then raise; end if;
  end;
  raise notice 'PASS 08 no self-lockout, no admin targets, no ghost profiles';
end $$;

-- ---------- onboarding users unaffected ----------
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000005', false);
do $$ begin
  assert is_active_user(), 'profile-less user counted inactive';
  raise notice 'PASS 09 users without a profile stay fully functional (onboarding)';
end $$;

select 'ALL PHASE 59 TESTS PASSED' as result;
