-- Phase 57 test matrix: invitations, accept/peek RPCs, member removal,
-- and the stale-pointer regression. Apply stub.sql + phase 56 + phase 57
-- first, on a FRESH database (this file seeds its own fixture).
\set ON_ERROR_STOP on

-- ---------- fixture (as postgres, RLS bypassed) ----------
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000001', 'owner1@t.t'),
  ('10000000-0000-0000-0000-000000000002', 'recep1@t.t'),
  ('10000000-0000-0000-0000-000000000003', 'doc1@t.t'),
  ('10000000-0000-0000-0000-000000000004', 'newbie@t.t'),
  ('10000000-0000-0000-0000-000000000005', 'multi@t.t'),
  ('10000000-0000-0000-0000-000000000006', 'labguy@t.t'),
  ('10000000-0000-0000-0000-000000000007', 'stray@t.t');

insert into clinics (id, owner_id, name) values
  ('aaaaaaaa-1000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'Clinic A'),
  ('bbbbbbbb-1000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000005', 'Clinic B');

insert into labs (id, owner_id, name) values
  ('22222222-1000-0000-0000-00000000002a', '10000000-0000-0000-0000-000000000006', 'Lab L');

insert into profiles (id, role, clinic_id, lab_id, name) values
  ('10000000-0000-0000-0000-000000000001', 'dentist', 'aaaaaaaa-1000-0000-0000-00000000000a', null, 'Owner One'),
  ('10000000-0000-0000-0000-000000000002', 'dentist', 'aaaaaaaa-1000-0000-0000-00000000000a', null, 'Recep One'),
  ('10000000-0000-0000-0000-000000000003', 'dentist', 'aaaaaaaa-1000-0000-0000-00000000000a', null, 'Doc One'),
  ('10000000-0000-0000-0000-000000000005', 'dentist', 'bbbbbbbb-1000-0000-0000-00000000000b', null, 'Multi Clinic'),
  ('10000000-0000-0000-0000-000000000006', 'lab',     null, '22222222-1000-0000-0000-00000000002a', 'Lab Guy'),
  -- stray: dentist profile pointing at Clinic A with NO member row and no
  -- ownership — the stale-pointer shape the dropped legacy branch protected
  ('10000000-0000-0000-0000-000000000007', 'dentist', 'aaaaaaaa-1000-0000-0000-00000000000a', null, 'Stray Pointer');

insert into clinic_members (clinic_id, user_id, role, email) values
  ('aaaaaaaa-1000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000002', 'receptionist', 'recep1@t.t'),
  ('aaaaaaaa-1000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000003', 'doctor', 'doc1@t.t');

do $$ begin
  assert (select email from clinic_members
          where user_id = '10000000-0000-0000-0000-000000000001') = 'owner1@t.t',
    'owner email backfill missing';
  raise notice 'PASS 01 clinic_members.email backfilled for owners';
end $$;

-- ---------- invite creation rights ----------
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
set role authenticated;
insert into clinic_invitations (clinic_id, email, role, invited_by, token)
values ('aaaaaaaa-1000-0000-0000-00000000000a', 'newbie@t.t', 'doctor',
        '10000000-0000-0000-0000-000000000001', 'tok-newbie');
do $$ begin raise notice 'PASS 02 admin invites a doctor'; end $$;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', false);
insert into clinic_invitations (clinic_id, email, role, invited_by, token)
values ('aaaaaaaa-1000-0000-0000-00000000000a', 'multi@t.t', 'receptionist',
        '10000000-0000-0000-0000-000000000002', 'tok-multi');
do $$ begin raise notice 'PASS 03 receptionist invites a receptionist'; end $$;

do $$ begin
  begin
    insert into clinic_invitations (clinic_id, email, role, invited_by)
    values ('aaaaaaaa-1000-0000-0000-00000000000a', 'x@t.t', 'admin',
            '10000000-0000-0000-0000-000000000002');
    raise exception 'TEST-FAIL: receptionist invited an admin';
  exception when sqlstate '42501' then
    raise notice 'PASS 04 receptionist cannot invite admins';
  end;
end $$;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', false);
do $$ begin
  begin
    insert into clinic_invitations (clinic_id, email, role, invited_by)
    values ('aaaaaaaa-1000-0000-0000-00000000000a', 'y@t.t', 'doctor',
            '10000000-0000-0000-0000-000000000003');
    raise exception 'TEST-FAIL: doctor created an invite';
  exception when sqlstate '42501' then
    raise notice 'PASS 05 doctors cannot invite';
  end;
end $$;

-- duplicate pending invite for the same address
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
do $$ begin
  begin
    insert into clinic_invitations (clinic_id, email, role, invited_by)
    values ('aaaaaaaa-1000-0000-0000-00000000000a', 'NEWBIE@t.t', 'doctor',
            '10000000-0000-0000-0000-000000000001');
    raise exception 'TEST-FAIL: duplicate pending invite accepted';
  exception when sqlstate '23505' then
    raise notice 'PASS 06 one pending invite per address per clinic';
  end;
end $$;

-- ---------- peek ----------
do $$
declare v jsonb;
begin
  v := peek_clinic_invitation('tok-newbie');
  assert v->>'clinicName' = 'Clinic A' and v->>'role' = 'doctor'
     and v->>'email' = 'newbie@t.t' and v->>'status' = 'pending', 'peek wrong: ' || v::text;
  assert peek_clinic_invitation('tok-bogus') is null, 'bogus token not null';
  raise notice 'PASS 07 peek returns invite summary; bogus token -> null';
end $$;

-- ---------- accept: fresh signup ----------
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', false);
do $$
declare v jsonb;
begin
  v := accept_clinic_invitation('tok-newbie', '  New Bee  ');
  assert v->>'role' = 'doctor' and v->>'clinicName' = 'Clinic A', 'accept result wrong';
  raise notice 'PASS 08 fresh signup accepts invite';
end $$;
do $$ begin
  assert (select name from profiles where id = '10000000-0000-0000-0000-000000000004') = 'New Bee',
    'profile not created with name';
  assert (select clinic_id from profiles where id = '10000000-0000-0000-0000-000000000004')
         = 'aaaaaaaa-1000-0000-0000-00000000000a', 'primary pointer not set';
  assert my_clinic_role('aaaaaaaa-1000-0000-0000-00000000000a') = 'doctor', 'member role wrong';
  assert (select email from clinic_members where user_id = '10000000-0000-0000-0000-000000000004') = 'newbie@t.t',
    'member email missing';
  raise notice 'PASS 09 profile + membership + pointer + email all landed';
end $$;

-- idempotent re-accept by the same user
do $$
declare v jsonb;
begin
  v := accept_clinic_invitation('tok-newbie', null);
  assert (v->>'already')::boolean, 're-accept not quiet';
  raise notice 'PASS 10 re-opening an accepted link is a quiet no-op';
end $$;

-- newbie (doctor) creates a case — needed for the removal test later
insert into cases (id, clinic_id, lab_id, patient_name)
values ('C57', 'aaaaaaaa-1000-0000-0000-00000000000a', '22222222-1000-0000-0000-00000000002a', 'Px 57');
do $$ begin
  assert (select created_by from cases where id = 'C57') = '10000000-0000-0000-0000-000000000004',
    'created_by stamp missing';
  raise notice 'PASS 11 invited doctor can author cases';
end $$;

-- ---------- accept: guard rails ----------
-- wrong account (email mismatch)
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', false);
do $$ begin
  begin
    perform accept_clinic_invitation('tok-multi', null);
    raise exception 'TEST-FAIL: mismatched email accepted';
  exception when others then
    if sqlerrm not like 'This invitation was sent to %' then raise; end if;
    raise notice 'PASS 12 email mismatch rejected';
  end;
end $$;

-- lab account
reset role;
insert into clinic_invitations (clinic_id, email, role, invited_by, token)
values ('aaaaaaaa-1000-0000-0000-00000000000a', 'labguy@t.t', 'doctor',
        '10000000-0000-0000-0000-000000000001', 'tok-labguy');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000006', false);
set role authenticated;
do $$ begin
  begin
    perform accept_clinic_invitation('tok-labguy', null);
    raise exception 'TEST-FAIL: lab account joined a clinic';
  exception when others then
    if sqlerrm not like '%clinic invitations need a dentist account%' then raise; end if;
    raise notice 'PASS 13 lab accounts cannot accept clinic invites';
  end;
end $$;

-- expired
reset role;
insert into clinic_invitations (clinic_id, email, role, invited_by, token, expires_at)
values ('aaaaaaaa-1000-0000-0000-00000000000a', 'stray@t.t', 'doctor',
        '10000000-0000-0000-0000-000000000001', 'tok-old', now() - interval '1 day');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000007', false);
set role authenticated;
do $$ begin
  begin
    perform accept_clinic_invitation('tok-old', null);
    raise exception 'TEST-FAIL: expired invite accepted';
  exception when others then
    if sqlerrm not like 'This invitation has expired%' then raise; end if;
    raise notice 'PASS 14 expired invite rejected';
  end;
  assert peek_clinic_invitation('tok-old')->>'status' = 'expired', 'peek not expired';
end $$;

-- ---------- revoke + column freeze ----------
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', false);
update clinic_invitations set status = 'revoked' where token = 'tok-multi';
do $$ begin
  assert (select status from clinic_invitations where token = 'tok-multi') = 'revoked', 'revoke lost';
  raise notice 'PASS 15 receptionist revokes a pending invite';
end $$;

-- revoked invite can no longer be accepted
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000005', false);
do $$ begin
  begin
    perform accept_clinic_invitation('tok-multi', null);
    raise exception 'TEST-FAIL: revoked invite accepted';
  exception when others then
    if sqlerrm not like 'This invitation was withdrawn%' then raise; end if;
    raise notice 'PASS 16 revoked invite rejected';
  end;
end $$;

-- identifying columns are frozen; pending -> accepted is RPC-only
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
update clinic_invitations set email = 'hijack@t.t', role = 'admin' where token = 'tok-labguy';
do $$ begin
  assert (select email from clinic_invitations where token = 'tok-labguy') = 'labguy@t.t'
     and (select role from clinic_invitations where token = 'tok-labguy') = 'doctor',
    'invite columns not frozen';
  begin
    update clinic_invitations set status = 'accepted' where token = 'tok-labguy';
    raise exception 'TEST-FAIL: direct accept allowed';
  exception when others then
    if sqlerrm not like 'Only pending invitations can be revoked%' then raise; end if;
  end;
  raise notice 'PASS 17 invite columns frozen; direct status=accepted blocked';
end $$;

-- ---------- multi-clinic accept by an existing dentist ----------
reset role;
insert into clinic_invitations (clinic_id, email, role, invited_by, token)
values ('aaaaaaaa-1000-0000-0000-00000000000a', 'multi@t.t', 'receptionist',
        '10000000-0000-0000-0000-000000000001', 'tok-multi2');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000005', false);
set role authenticated;
do $$
declare v jsonb;
begin
  v := accept_clinic_invitation('tok-multi2', null);
  assert v->>'role' = 'receptionist', 'multi accept wrong role';
  assert (select clinic_id from profiles where id = '10000000-0000-0000-0000-000000000005')
         = 'bbbbbbbb-1000-0000-0000-00000000000b', 'primary pointer was stolen';
  assert my_clinic_role('aaaaaaaa-1000-0000-0000-00000000000a') = 'receptionist'
     and my_clinic_role('bbbbbbbb-1000-0000-0000-00000000000b') = 'admin', 'multi roles wrong';
  assert (select count(*) from cases) = 1, 'receptionist@A does not see clinic A cases';
  raise notice 'PASS 18 existing dentist joins a second clinic; pointer untouched';
end $$;

-- ---------- stale-pointer regression (legacy branch dropped) ----------
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000007', false);
do $$ begin
  assert coalesce(my_clinic_role('aaaaaaaa-1000-0000-0000-00000000000a'), '') = '',
    'pointer-only non-owner still has a role';
  assert (select count(*) from cases) = 0, 'stray pointer sees clinic cases';
  begin
    insert into cases (id, clinic_id, patient_name)
    values ('C58', 'aaaaaaaa-1000-0000-0000-00000000000a', 'x');
    raise exception 'TEST-FAIL: stray pointer created a case';
  exception when sqlstate '42501' then null;
  end;
  raise notice 'PASS 19 stale pointer grants nothing (legacy-admin branch gone)';
end $$;

-- ---------- removal ----------
-- non-admins cannot remove
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', false);
do $$ begin
  begin
    perform remove_clinic_member('aaaaaaaa-1000-0000-0000-00000000000a',
                                 '10000000-0000-0000-0000-000000000004');
    raise exception 'TEST-FAIL: receptionist removed a member';
  exception when others then
    if sqlerrm not like 'Only a clinic admin can remove%' then raise; end if;
    raise notice 'PASS 20 removal is admin-only';
  end;
end $$;

-- owner protection + self-removal
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
do $$ begin
  begin
    perform remove_clinic_member('aaaaaaaa-1000-0000-0000-00000000000a',
                                 '10000000-0000-0000-0000-000000000001');
    raise exception 'TEST-FAIL: owner removed';
  exception when others then
    if sqlerrm not like 'The clinic owner cannot be removed%' then raise; end if;
    raise notice 'PASS 21 owner cannot be removed';
  end;
end $$;

-- removing newbie clears their pointer AND their access (incl. own cases)
select remove_clinic_member('aaaaaaaa-1000-0000-0000-00000000000a',
                            '10000000-0000-0000-0000-000000000004');
do $$ begin
  assert not exists (select 1 from clinic_members
                     where user_id = '10000000-0000-0000-0000-000000000004'), 'member row survives';
  raise notice 'PASS 22 admin removes a member';
end $$;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', false);
do $$ begin
  assert (select clinic_id from profiles where id = '10000000-0000-0000-0000-000000000004') is null,
    'stale pointer survived removal';
  assert (select count(*) from cases) = 0, 'removed member still sees cases';
  raise notice 'PASS 23 removal clears the pointer — no residual access, even to own cases';
end $$;

-- removing the multi-clinic member from A repoints nothing (pointer is B)
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
select remove_clinic_member('aaaaaaaa-1000-0000-0000-00000000000a',
                            '10000000-0000-0000-0000-000000000005');
-- (verify as superuser: after removal the roster policy correctly hides
-- user 5's profile from user 1, so an RLS read would see nothing)
reset role;
do $$ begin
  assert (select clinic_id from profiles where id = '10000000-0000-0000-0000-000000000005')
         = 'bbbbbbbb-1000-0000-0000-00000000000b', 'unrelated pointer touched';
  raise notice 'PASS 24 removal leaves an unrelated primary pointer alone';
end $$;

select 'ALL PHASE 57 TESTS PASSED' as result;
