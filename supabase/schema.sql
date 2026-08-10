-- DentaTrack Phase 5 schema — multi-user backend on Supabase
-- Run this once in the Supabase Dashboard: Project -> SQL Editor -> New query -> paste -> Run.
-- Safe to re-run: uses "if not exists" / "or replace" throughout.

create extension if not exists pgcrypto;

/* ------------------------------------------------------------------ */
/*  Clinics (dentist side)                                             */
/* ------------------------------------------------------------------ */

create table if not exists clinics (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  address text default '',
  contact text default '',
  license text default '',
  dentist text default '',
  dentist_license text default '',
  created_at timestamptz not null default now()
);

/* ------------------------------------------------------------------ */
/*  Labs                                                               */
/* ------------------------------------------------------------------ */

create table if not exists labs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,       -- set once a real lab account claims/owns this row
  created_by_clinic_id uuid references clinics(id) on delete set null, -- set when a dentist manually added this lab
  name text not null,
  contact text default '',
  email text default '',
  address text default '',
  tat integer not null default 5,
  express_pct integer not null default 0,
  created_at timestamptz not null default now()
);

/* ------------------------------------------------------------------ */
/*  Profiles — one row per auth user, carries role + which org they're in */
/* ------------------------------------------------------------------ */

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('dentist', 'lab')),
  name text default '',
  clinic_id uuid references clinics(id) on delete set null,
  lab_id uuid references labs(id) on delete set null,
  created_at timestamptz not null default now()
);

/* ------------------------------------------------------------------ */
/*  Cases                                                               */
/* ------------------------------------------------------------------ */

create table if not exists cases (
  id text primary key,                 -- app-generated "C-xxxx" id, kept for continuity with existing UI/print/CSV
  clinic_id uuid not null references clinics(id) on delete cascade,
  lab_id uuid references labs(id) on delete set null,
  patient_name text not null,
  patient_id text not null,
  patient_phone text default '',
  appointment_date date,
  delivery_time text default 'Anytime',
  created_date date not null default current_date,
  stage_index integer not null default 0,
  handover jsonb,
  remake jsonb,
  prescription jsonb not null default '{}'::jsonb,
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cases_clinic_id_idx on cases (clinic_id);
create index if not exists cases_lab_id_idx on cases (lab_id);

-- keep updated_at fresh on every write, used by the realtime/UI ordering
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists cases_set_updated_at on cases;
create trigger cases_set_updated_at
  before update on cases
  for each row execute function set_updated_at();

/* ------------------------------------------------------------------ */
/*  Row Level Security                                                 */
/* ------------------------------------------------------------------ */

alter table clinics enable row level security;
alter table labs enable row level security;
alter table profiles enable row level security;
alter table cases enable row level security;

-- Helper: read the caller's own profile fields without recursive RLS issues.
-- (SECURITY DEFINER lets this bypass RLS internally; it only ever returns
-- data scoped to auth.uid(), so it can't leak other users' rows.)
create or replace function my_clinic_id()
returns uuid
language sql security definer stable
set search_path = public
as $$
  select clinic_id from profiles where id = auth.uid();
$$;

create or replace function my_lab_id()
returns uuid
language sql security definer stable
set search_path = public
as $$
  select lab_id from profiles where id = auth.uid();
$$;

-- profiles: a user can see and manage only their own profile row.
drop policy if exists "profiles_select_own" on profiles;
create policy "profiles_select_own" on profiles for select
  using (id = auth.uid());

drop policy if exists "profiles_insert_own" on profiles;
create policy "profiles_insert_own" on profiles for insert
  with check (id = auth.uid());

drop policy if exists "profiles_update_own" on profiles;
create policy "profiles_update_own" on profiles for update
  using (id = auth.uid());

-- clinics: the owning dentist manages their clinic. Labs assigned a case
-- from that clinic can read the clinic's letterhead-level info (name/contact).
drop policy if exists "clinics_select" on clinics;
create policy "clinics_select" on clinics for select
  using (
    owner_id = auth.uid()
    or id = my_clinic_id()
    or id in (select clinic_id from cases where lab_id = my_lab_id())
  );

drop policy if exists "clinics_insert_own" on clinics;
create policy "clinics_insert_own" on clinics for insert
  with check (owner_id = auth.uid());

drop policy if exists "clinics_update_own" on clinics;
create policy "clinics_update_own" on clinics for update
  using (owner_id = auth.uid());

-- labs: kept as a readable directory (needed so a dentist can pick a lab in
-- the Rx form, and so a lab can find/claim the placeholder row a dentist
-- created for them). Only the owner (once claimed) or the creating clinic
-- can edit.
drop policy if exists "labs_select_all" on labs;
create policy "labs_select_all" on labs for select
  using (auth.uid() is not null);

drop policy if exists "labs_insert_authenticated" on labs;
create policy "labs_insert_authenticated" on labs for insert
  with check (auth.uid() is not null);

drop policy if exists "labs_update_owner_or_creator" on labs;
create policy "labs_update_owner_or_creator" on labs for update
  using (owner_id = auth.uid() or created_by_clinic_id = my_clinic_id());

-- cases: strict isolation — a clinic sees only its own cases, a lab sees
-- only cases assigned to it. Both sides can update (advance/revert stage,
-- log handover/remake); only the owning clinic can insert/delete.
drop policy if exists "cases_select" on cases;
create policy "cases_select" on cases for select
  using (clinic_id = my_clinic_id() or lab_id = my_lab_id());

drop policy if exists "cases_insert_own_clinic" on cases;
create policy "cases_insert_own_clinic" on cases for insert
  with check (clinic_id = my_clinic_id());

drop policy if exists "cases_update" on cases;
create policy "cases_update" on cases for update
  using (clinic_id = my_clinic_id() or lab_id = my_lab_id());

drop policy if exists "cases_delete_own_clinic" on cases;
create policy "cases_delete_own_clinic" on cases for delete
  using (clinic_id = my_clinic_id());

/* ------------------------------------------------------------------ */
/*  Realtime — broadcast row changes on cases so both sides sync live  */
/* ------------------------------------------------------------------ */

-- Unlike everything else in this file, "alter publication ... add table"
-- has no "if not exists" form, so a plain re-run errors once it's already
-- been added once (and, worse, that error rolls back the ENTIRE script as
-- one transaction — so nothing after this point would apply either).
-- Guard it explicitly so the whole file stays safe to re-run top to bottom.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cases'
  ) then
    alter publication supabase_realtime add table cases;
  end if;
end $$;

/* ------------------------------------------------------------------ */
/*  Phase 6 — Super Admin (read-only, platform-wide)                   */
/*  A third profile role with no clinic_id/lab_id of its own. Never    */
/*  self-serve — the Onboarding role-picker still only offers          */
/*  dentist/lab; an admin profile is only ever created by hand (see    */
/*  the app README / operator notes for the exact steps). Grants       */
/*  read-only SELECT across every clinic/case (labs are already        */
/*  readable by any authenticated user via labs_select_all, so no      */
/*  extra policy is needed there) — no insert/update/delete, so a      */
/*  compromised or mistaken admin session can't mutate tenant data.    */
/* ------------------------------------------------------------------ */

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('dentist', 'lab', 'admin'));

create or replace function is_admin()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

drop policy if exists "clinics_select_admin" on clinics;
create policy "clinics_select_admin" on clinics for select
  using (is_admin());

drop policy if exists "cases_select_admin" on cases;
create policy "cases_select_admin" on cases for select
  using (is_admin());

drop policy if exists "profiles_select_admin" on profiles;
create policy "profiles_select_admin" on profiles for select
  using (is_admin());
