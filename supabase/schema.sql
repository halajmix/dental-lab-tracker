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

-- "id = my_lab_id()" lets a claimed lab's own staff update their lab row
-- (settings, per-procedure TATs). Without it, the original claim flow's
-- owner_id update was a silent 0-row no-op: at claim time owner_id was
-- still null and the lab user has no clinic, so neither branch matched.
drop policy if exists "labs_update_owner_or_creator" on labs;
create policy "labs_update_owner_or_creator" on labs for update
  using (owner_id = auth.uid() or created_by_clinic_id = my_clinic_id() or id = my_lab_id());

-- Backfill owner_id for labs claimed before the policy fix above existed.
update labs set owner_id = p.id
from profiles p
where p.lab_id = labs.id and labs.owner_id is null and p.role = 'lab';

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

/* ------------------------------------------------------------------ */
/*  Phase 7 — Lab invoice number                                       */
/*  A lab's own internal billing/job reference for a case — distinct   */
/*  from the system-generated case id and never set by the dentist.    */
/*  No new RLS policy needed: the existing "cases_update" policy       */
/*  already lets a case's assigned lab (lab_id = my_lab_id()) update   */
/*  any column on its own cases, invoice_number included.              */
/* ------------------------------------------------------------------ */

alter table cases add column if not exists invoice_number text default '';

-- Once an invoice number is set (pushed to the clinic) it is LOCKED —
-- enforced here at the DB level so no client can change or clear it,
-- not just hidden in the UI. Setting it the first time (from empty/null)
-- is allowed; any later change raises.
create or replace function lock_invoice_number()
returns trigger as $$
begin
  if coalesce(old.invoice_number, '') <> ''
     and new.invoice_number is distinct from old.invoice_number then
    raise exception 'Invoice number is locked once set';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists cases_lock_invoice_number on cases;
create trigger cases_lock_invoice_number
  before update on cases
  for each row execute function lock_invoice_number();

/* ------------------------------------------------------------------ */
/*  Phase 8 — Profile settings (avatar, phone) + per-case notes        */
/*  Name/phone/avatar are self-service (profiles_update_own already    */
/*  covers writes — id = auth.uid()); email is intentionally never     */
/*  editable here since it's the auth.users login identity, not a      */
/*  profile field. Case notes are a small shared thread visible to     */
/*  both sides of a case (the clinic that owns it and the lab it's     */
/*  assigned to), for back-and-forth that doesn't belong in the        */
/*  lifecycle audit history.                                           */
/* ------------------------------------------------------------------ */

alter table profiles add column if not exists avatar_url text default '';
alter table profiles add column if not exists phone text default '';

-- Avatar storage: one public bucket, each user can only write inside
-- their own "<user id>/…" folder (checked via the path's first segment).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "avatars_owner_write" on storage.objects;
create policy "avatars_owner_write" on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update" on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_owner_delete" on storage.objects;
create policy "avatars_owner_delete" on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Per-procedure turnaround times, keyed by the Rx form's restoration
-- category names (e.g. {"Crown - tooth": 4, "Veneer": 6}). Empty object =
-- every procedure falls back to the lab's standard `tat`. Writable by the
-- lab owner via the existing labs_update_owner_or_creator policy.
alter table labs add column if not exists procedure_tats jsonb not null default '{}'::jsonb;

create table if not exists case_notes (
  id uuid primary key default gen_random_uuid(),
  case_id text not null references cases(id) on delete cascade,
  author_role text not null check (author_role in ('dentist', 'lab')),
  author_name text not null default '',
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists case_notes_case_id_idx on case_notes (case_id);

alter table case_notes enable row level security;

-- Same visibility rule as the case itself: either side of the case can
-- read and post — the clinic that owns it, or the lab it's assigned to.
drop policy if exists "case_notes_select" on case_notes;
create policy "case_notes_select" on case_notes for select
  using (
    exists (
      select 1 from cases c
      where c.id = case_notes.case_id
        and (c.clinic_id = my_clinic_id() or c.lab_id = my_lab_id())
    )
  );

drop policy if exists "case_notes_insert" on case_notes;
create policy "case_notes_insert" on case_notes for insert
  with check (
    exists (
      select 1 from cases c
      where c.id = case_notes.case_id
        and (c.clinic_id = my_clinic_id() or c.lab_id = my_lab_id())
    )
  );

/* ------------------------------------------------------------------ */
/*  Phase 9 — Lab Station device sessions, IP auditing, anomaly OTP    */
/*                                                                     */
/*  Written for this app's actual stack: plain Postgres + RLS in the   */
/*  existing Supabase project, driven by an Edge Function (Deno) that  */
/*  can see real request headers. There is no Prisma/Express layer     */
/*  here to hang an ORM schema off.                                    */
/*                                                                     */
/*  Client IP is captured server-side ONLY (Edge Function reads        */
/*  cf-connecting-ip / x-forwarded-for). It is never accepted from the */
/*  browser, which could trivially forge it.                           */
/* ------------------------------------------------------------------ */

create table if not exists lab_device_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Org the device belongs to. Exactly one is set, mirroring profiles.
  clinic_id uuid references clinics(id) on delete cascade,
  lab_id uuid references labs(id) on delete cascade,

  session_name text not null default 'New device',      -- "Main Bench iPad"
  device_fingerprint text not null,                     -- stable per browser profile
  user_agent text default '',
  device_label text default '',                         -- "iPadOS 17 / Safari"

  current_ip inet,
  last_ip inet,
  ip_subnet text,                                       -- /24 (v4) or /64 (v6)

  is_trusted boolean not null default false,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'CHALLENGE_REQUIRED', 'REVOKED')),

  last_active_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '365 days'),
  created_at timestamptz not null default now(),

  -- One row per (user, device) — heartbeats upsert onto this.
  unique (user_id, device_fingerprint)
);

create index if not exists lab_device_sessions_user_idx on lab_device_sessions (user_id);
create index if not exists lab_device_sessions_org_idx on lab_device_sessions (clinic_id, lab_id);

create table if not exists lab_trusted_ips (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references clinics(id) on delete cascade,
  lab_id uuid references labs(id) on delete cascade,
  ip_address inet not null,
  cidr_subnet text not null,
  label text default '',                                -- "Lab Wi-Fi (Muscat)"
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists lab_trusted_ips_org_idx on lab_trusted_ips (clinic_id, lab_id);

-- Step-up challenges. Codes are stored hashed — a DB leak must not hand
-- an attacker a working OTP.
create table if not exists device_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references lab_device_sessions(id) on delete cascade,
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists device_otp_challenges_session_idx on device_otp_challenges (session_id);

alter table lab_device_sessions enable row level security;
alter table lab_trusted_ips enable row level security;
alter table device_otp_challenges enable row level security;

-- Users see their own devices; an org's members see the org's devices so a
-- lab owner can audit and revoke benches from Settings.
drop policy if exists "device_sessions_select" on lab_device_sessions;
create policy "device_sessions_select" on lab_device_sessions for select
  using (
    user_id = auth.uid()
    or (clinic_id is not null and clinic_id = my_clinic_id())
    or (lab_id is not null and lab_id = my_lab_id())
    or is_admin()
  );

-- Rename / revoke only. Every security-relevant column (ip, status,
-- is_trusted) is written by the Edge Function under the service role, so a
-- client cannot mark its own device trusted or clear a challenge.
drop policy if exists "device_sessions_update" on lab_device_sessions;
create policy "device_sessions_update" on lab_device_sessions for update
  using (
    user_id = auth.uid()
    or (clinic_id is not null and clinic_id = my_clinic_id())
    or (lab_id is not null and lab_id = my_lab_id())
  );

drop policy if exists "trusted_ips_select" on lab_trusted_ips;
create policy "trusted_ips_select" on lab_trusted_ips for select
  using (
    (clinic_id is not null and clinic_id = my_clinic_id())
    or (lab_id is not null and lab_id = my_lab_id())
    or is_admin()
  );

-- device_otp_challenges intentionally has NO client policy: only the Edge
-- Function (service role, which bypasses RLS) ever reads or writes codes.

-- Guard rail: a client UPDATE must not be able to escalate trust or status.
-- RLS alone can't restrict *which columns* change, so enforce it in a trigger.
create or replace function guard_device_session_columns()
returns trigger as $$
begin
  if current_setting('role', true) = 'service_role' then
    return new;  -- Edge Function: full control
  end if;
  if new.is_trusted is distinct from old.is_trusted
     or new.current_ip is distinct from old.current_ip
     or new.ip_subnet is distinct from old.ip_subnet
     or (new.status is distinct from old.status and new.status <> 'REVOKED') then
    raise exception 'Only session_name changes and revocation are allowed from a client';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists lab_device_sessions_guard on lab_device_sessions;
create trigger lab_device_sessions_guard
  before update on lab_device_sessions
  for each row execute function guard_device_session_columns();
