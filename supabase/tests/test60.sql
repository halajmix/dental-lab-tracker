-- Phase 60 test matrix: persisted Rx drafts, 1-day RLS lifetime, janitor.
-- Apply stub.sql + phases 56-60 on a FRESH database first.
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('40000000-0000-0000-0000-000000000001', 'doca@t.t'),
  ('40000000-0000-0000-0000-000000000002', 'docb@t.t');

-- ---------- save + read own draft ----------
select set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000001', false);
set role authenticated;
insert into rx_drafts (user_id, patient_name, payload)
values ('40000000-0000-0000-0000-000000000001', 'Px Draft', '{"notes":"half done"}');
do $$ begin
  assert (select payload->>'notes' from rx_drafts) = 'half done', 'cannot read own draft';
  raise notice 'PASS 01 user saves and reads their own draft';
end $$;

-- server stamps updated_at even if the client lies
do $$ begin
  update rx_drafts set updated_at = now() - interval '10 days'
   where user_id = '40000000-0000-0000-0000-000000000001';
  assert (select updated_at > now() - interval '1 minute' from rx_drafts), 'client set updated_at';
  raise notice 'PASS 02 updated_at is server-stamped (client clock ignored)';
end $$;

-- ---------- isolation ----------
select set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000002', false);
do $$
declare n int;
begin
  assert (select count(*) from rx_drafts) = 0, 'user B sees user A''s draft';
  begin
    insert into rx_drafts (user_id, payload)
    values ('40000000-0000-0000-0000-000000000001', '{}');
    raise exception 'TEST-FAIL: saved a draft for another user';
  exception when sqlstate '42501' then null;
  end;
  with d as (delete from rx_drafts where user_id = '40000000-0000-0000-0000-000000000001' returning 1)
  select count(*) into n from d;
  assert n = 0, 'user B deleted user A''s draft';
  raise notice 'PASS 03 drafts are private: no cross-user read/write/delete';
end $$;

-- ---------- save replaces (definer RPC — a plain upsert/delete bounces
-- off EXPIRED rows because RLS applies SELECT visibility to them) ----------
select set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000001', false);
select save_rx_draft(null, 'Px Draft v2', '{"notes":"newer"}');
do $$ begin
  assert (select count(*) from rx_drafts) = 1
     and (select payload->>'notes' from rx_drafts) = 'newer', 'replace failed';
  raise notice 'PASS 04 one draft per user — save replaces';
end $$;

-- ---------- expiry: read-invisible after 24h, upsert still lands ----------
reset role;
update rx_drafts set updated_at = now() - interval '25 hours'
 where user_id = '40000000-0000-0000-0000-000000000001';
alter table rx_drafts disable trigger rx_drafts_touch;
update rx_drafts set updated_at = now() - interval '25 hours'
 where user_id = '40000000-0000-0000-0000-000000000001';
alter table rx_drafts enable trigger rx_drafts_touch;
select set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000001', false);
set role authenticated;
do $$ begin
  assert (select count(*) from rx_drafts) = 0, 'expired draft still readable';
  raise notice 'PASS 05 expired draft invisible at read time (RLS, pre-janitor)';
end $$;
select save_rx_draft(null, 'Px Fresh', '{"notes":"fresh"}');
do $$ begin
  assert (select payload->>'notes' from rx_drafts) = 'fresh', 'save over expired draft failed';
  raise notice 'PASS 06 a new draft saves cleanly over an expired one';
end $$;

-- ---------- janitor ----------
reset role;
insert into auth.users (id, email) values ('40000000-0000-0000-0000-000000000003', 'docc@t.t');
insert into rx_drafts (user_id, patient_name, payload)
values ('40000000-0000-0000-0000-000000000003', 'Px Old', '{}');
alter table rx_drafts disable trigger rx_drafts_touch;
update rx_drafts set updated_at = now() - interval '30 hours'
 where user_id = '40000000-0000-0000-0000-000000000003';
alter table rx_drafts enable trigger rx_drafts_touch;
-- run exactly what the cron job runs
delete from rx_drafts where updated_at < now() - interval '1 day';
do $$ begin
  assert (select count(*) from rx_drafts) = 1
     and (select patient_name from rx_drafts) = 'Px Fresh', 'janitor wrong rows';
  assert (select count(*) from cron.job where jobname = 'rx-drafts-cleanup') = 1,
    'cleanup job not scheduled';
  raise notice 'PASS 07 janitor deletes only stale drafts; cron job registered';
end $$;

-- delete own draft
select set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000001', false);
set role authenticated;
delete from rx_drafts where user_id = '40000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select count(*) from rx_drafts) = 0, 'own delete failed';
  raise notice 'PASS 08 discard deletes the draft';
end $$;

select 'ALL PHASE 60 TESTS PASSED' as result;
