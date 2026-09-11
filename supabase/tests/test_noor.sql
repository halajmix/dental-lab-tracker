-- Role-based RLS matrix for the Noor Phase 2 tables. Apply stub.sql + the
-- phase blocks + 20260911_noor_phase2_schema.sql first (fresh database).
\set ON_ERROR_STOP on
-- ---------- fixture (as postgres, RLS bypassed) ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner1@t.t'),
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
  ('00000000-0000-0000-0000-000000000005', 'lab',     null, '11111111-0000-0000-0000-00000000001a', 'Lab User'),
  ('00000000-0000-0000-0000-000000000006', 'dentist', 'bbbbbbbb-0000-0000-0000-00000000000b', null, 'Outsider'),
  ('00000000-0000-0000-0000-000000000007', 'admin',   null, null, 'Super');
insert into cases (id, clinic_id, lab_id, patient_name, patient_id, created_by, stage_index) values
  ('C-NOORTEST1', 'aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-00000000001a', 'P', 'PT-1',
   '00000000-0000-0000-0000-000000000001', 1);
insert into case_clarifications (case_id, issue, question) values
  ('C-NOORTEST1', '{"field":"shade","severity":"blocking","detail":"x"}', 'Which shade?');
insert into case_flags (case_id, kind, reason, visible_to) values
  ('C-NOORTEST1', 'at_risk', 'promise date near', 'lab'),
  ('C-NOORTEST1', 'overdue', 'need-by passed', 'both');
insert into escalations (case_id, lab_id, category, summary) values
  ('C-NOORTEST1', '11111111-0000-0000-0000-00000000001a', 'stale_case', 'stalled');
insert into agent_runs (trace_id, trigger) values ('tr-1', 'user_question');

-- ---------- helpers ----------
create or replace function t_as(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); set role authenticated; end $$;
create or replace function t_reset() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claim.sub', '', false); end $$;

-- ---------- clinic owner: sees own clarification, only clinic-visible flags, no escalations, no audit ----------
select t_as('00000000-0000-0000-0000-000000000001');
do $$ begin
  if (select count(*) from case_clarifications) <> 1 then raise exception 'clinic should see its clarification'; end if;
  if (select count(*) from case_flags) <> 1 then raise exception 'clinic must see only clinic-visible flags (got %)', (select count(*) from case_flags); end if;
  if (select count(*) from escalations) <> 0 then raise exception 'clinic must not see escalations'; end if;
  if (select count(*) from agent_runs) <> 0 then raise exception 'clinic must not see audit'; end if;
end $$;
update case_clarifications set answer = 'A2', answered_at = now(), status = 'answered' where case_id = 'C-NOORTEST1';
do $$ begin
  if (select status from case_clarifications where case_id = 'C-NOORTEST1') <> 'answered' then raise exception 'clinic should be able to answer'; end if;
end $$;
select t_reset();

-- ---------- outsider clinic: sees nothing ----------
select t_as('00000000-0000-0000-0000-000000000006');
do $$ begin
  if (select count(*) from case_clarifications) <> 0 then raise exception 'outsider saw a clarification'; end if;
  if (select count(*) from case_flags) <> 0 then raise exception 'outsider saw a flag'; end if;
  if (select count(*) from escalations) <> 0 then raise exception 'outsider saw an escalation'; end if;
end $$;
select t_reset();

-- ---------- lab owner: all flags for its case, its escalations; cannot answer clarification ----------
select t_as('00000000-0000-0000-0000-000000000005');
do $$ begin
  if (select count(*) from case_flags) <> 2 then raise exception 'lab should see both flags'; end if;
  if (select count(*) from escalations) <> 1 then raise exception 'lab should see its escalation'; end if;
  if (select count(*) from agent_runs) <> 0 then raise exception 'lab must not see audit'; end if;
end $$;
update case_clarifications set status = 'open' where case_id = 'C-NOORTEST1';
do $$ begin
  if (select status from case_clarifications where case_id = 'C-NOORTEST1') <> 'answered' then raise exception 'lab must not be able to change a clarification'; end if;
end $$;
select t_reset();

-- ---------- admin: audit visible ----------
select t_as('00000000-0000-0000-0000-000000000007');
do $$ begin
  if (select count(*) from agent_runs) <> 1 then raise exception 'admin should see audit'; end if;
end $$;
select t_reset();

-- ---------- service role: agent note allowed by the widened CHECK ----------
set role service_role;
insert into case_notes (case_id, author_name, author_role, body) values ('C-NOORTEST1', 'Noor', 'agent', 'Noor: test');
reset role;
do $$ begin
  if (select count(*) from case_notes where author_role = 'agent') <> 1 then raise exception 'agent note not stored'; end if;
end $$;

-- ---------- webhook trigger is inert while the flag is off ----------
do $$ begin
  if (select enabled from feature_flags where key = 'noor.global') then raise exception 'flag must default off'; end if;
end $$;
select 'noor RLS matrix: PASS' as result;
