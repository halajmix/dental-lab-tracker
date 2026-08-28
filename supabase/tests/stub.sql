-- Minimal stand-in for the pre-Phase-56 production schema: just enough
-- tables, auth plumbing, and helper functions for phase56.sql to apply
-- and for role-based RLS tests to run. Semantics mirror prod helpers.
create schema if not exists auth;

create table auth.users (
  id uuid primary key,
  email text
);

create function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create function auth.jwt() returns jsonb
language sql stable as $$
  select jsonb_build_object('email',
    (select email from auth.users where id = auth.uid()))
$$;

create role authenticated nologin;
create role service_role nologin;

-- pg_net + webhook config stand-ins (the invite triggers call these; the
-- stub just swallows the POST)
create schema private;
create table private.webhook_config (key text primary key, value text);
insert into private.webhook_config values ('case_notify_secret', 'test-secret');
create schema net;
create function net.http_post(url text, headers jsonb default '{}'::jsonb, body jsonb default '{}'::jsonb)
returns bigint language sql as $$ select 1::bigint $$;

-- pg_cron stand-in (records the schedule; nothing fires in tests)
create schema cron;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(job_name text, schedule text, command text)
returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid
$$;

create table clinics (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id),
  name text not null,
  email text default '',
  status text not null default 'active'
);

create table labs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id),
  created_by_clinic_id uuid,
  name text not null,
  status text not null default 'active'
);

create table profiles (
  id uuid primary key references auth.users(id),
  role text not null,
  clinic_id uuid references clinics(id),
  lab_id uuid references labs(id),
  name text default ''
);

-- prod Phase 16 (referenced by the real my_lab_id body)
create table lab_members (
  id uuid primary key default gen_random_uuid(),
  lab_id uuid references labs(id),
  user_id uuid,
  email text default '',
  role text not null,
  status text not null default 'active'
);

create table cases (
  id text primary key,
  clinic_id uuid references clinics(id),
  lab_id uuid references labs(id),
  prescription jsonb default '{}'::jsonb,
  patient_name text default '',
  patient_id text default '',
  patient_phone text default '',
  appointment_date date,
  delivery_time text default '',
  cancel_status text default 'none',
  created_at timestamptz not null default now()
);

create table case_notes (
  id uuid primary key default gen_random_uuid(),
  case_id text references cases(id),
  author_id uuid,
  body text
);

create table case_rounds (
  id uuid primary key default gen_random_uuid(),
  parent_case_id text references cases(id),
  attachments jsonb default '[]'::jsonb
);

-- referenced by estimate_case_price (created but never called in tests)
create table clinic_price_rules (
  lab_id uuid, clinic_id uuid, price_schedule_id uuid, discount_pct numeric
);

alter table clinics enable row level security;
alter table labs enable row level security;
alter table profiles enable row level security;
alter table cases enable row level security;
alter table case_notes enable row level security;
alter table case_rounds enable row level security;

-- prod helper stand-ins (same observable behavior)
create function my_lab_id() returns uuid
language sql security definer stable as $$
  select lab_id from profiles where id = auth.uid()
$$;

create function lab_write_allowed() returns boolean
language sql stable as $$ select true $$;

create function is_admin() returns boolean
language sql security definer stable as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin')
$$;

create function my_clinic_id() returns uuid
language sql security definer stable as $$
  select p.clinic_id from profiles p
  join clinics c on c.id = p.clinic_id
  where p.id = auth.uid() and c.status = 'active'
$$;

create function my_owned_clinic_ids() returns setof uuid
language sql security definer stable as $$
  select id from clinics where owner_id = auth.uid() and status = 'active'
$$;

-- prod Phase 22 trigger binding: phase56.sql replaces the FUNCTION body;
-- the trigger itself already exists in production.
create function guard_prescription_edits() returns trigger
as $$ begin return new; end $$ language plpgsql;
create trigger cases_guard_prescription
  before update on cases
  for each row execute function guard_prescription_edits();

-- pre-Phase-56 policies that phase56.sql replaces (so the drops are real)
create policy "profiles_select_own" on profiles for select using (id = auth.uid());
create policy "clinics_select_admin" on clinics for select using (is_admin());
create policy "clinics_select" on clinics for select
  using (owner_id = auth.uid() or id = my_clinic_id()
         or id in (select clinic_id from cases where lab_id = my_lab_id()));
create policy "cases_select" on cases for select
  using (clinic_id = my_clinic_id() or clinic_id in (select my_owned_clinic_ids())
         or lab_id = my_lab_id());

grant usage on schema public, auth to authenticated, service_role;
grant all on all tables in schema public to authenticated, service_role;
grant select on auth.users to authenticated, service_role;
alter default privileges in schema public grant all on tables to authenticated, service_role;
