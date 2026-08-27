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

-- Multi-clinic (Phase 13): every clinic the caller owns. SECURITY DEFINER is
-- what matters here, not just style — an inline "select id from clinics
-- where owner_id = auth.uid()" directly inside a cases RLS policy runs
-- under the caller's own RLS-restricted context, which re-triggers
-- clinics_select (it queries cases right back for the lab-visibility
-- branch) -> infinite recursion. A security definer function's internal
-- query bypasses RLS instead of re-entering it, same reason my_clinic_id()/
-- my_lab_id() above are written this way rather than inlined.
create or replace function my_owned_clinic_ids()
returns setof uuid
language sql security definer stable
set search_path = public
as $$
  select id from clinics where owner_id = auth.uid();
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

/* --------------------------------------------------------------------- */
/*  Phase 10 — onboarding collects clinic email                          */
/* --------------------------------------------------------------------- */
alter table clinics add column if not exists email text default '';

/* --------------------------------------------------------------------- */
/*  Phase 11 — real Rx photo attachments (clinical / shade photos)       */
/*  Same pattern as the avatars bucket: one public bucket, each user can */
/*  only write inside their own "<user id>/…" folder. The dentist        */
/*  uploads while filling out the Rx form (before the case row exists),  */
/*  so the path is "<uid>/<client-side temp id>/<filename>" rather than  */
/*  keyed by case id; the resulting public URLs are then stored in the   */
/*  case's prescription.files jsonb, so no additional table is needed —  */
/*  read access for the lab side comes from the bucket being public.     */
/* --------------------------------------------------------------------- */
insert into storage.buckets (id, name, public)
values ('case-photos', 'case-photos', true)
on conflict (id) do nothing;

drop policy if exists "case_photos_public_read" on storage.objects;
create policy "case_photos_public_read" on storage.objects for select
  using (bucket_id = 'case-photos');

drop policy if exists "case_photos_owner_write" on storage.objects;
create policy "case_photos_owner_write" on storage.objects for insert
  with check (bucket_id = 'case-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "case_photos_owner_delete" on storage.objects;
create policy "case_photos_owner_delete" on storage.objects for delete
  using (bucket_id = 'case-photos' and (storage.foldername(name))[1] = auth.uid()::text);

/* --------------------------------------------------------------------- */
/*  Phase 12 — case email notifications (new case -> lab, complete ->    */
/*  clinic), fired by a plain trigger + pg_net rather than the dashboard */
/*  "Database Webhooks" UI, because that UI depends on an internal       */
/*  "supabase_functions" schema this project doesn't have (errors with   */
/*  "schema supabase_functions does not exist"). pg_net directly is the  */
/*  same underlying mechanism without that dependency.                   */
/*                                                                       */
/*  The anon key below is NOT a secret — it's already public in the      */
/*  deployed app's JS bundle (VITE_SUPABASE_ANON_KEY); RLS is what       */
/*  actually protects data, not this key's secrecy. NEVER put the        */
/*  service role key here instead.                                       */
/* --------------------------------------------------------------------- */

create extension if not exists pg_net;

create or replace function notify_case_webhook()
returns trigger as $$
begin
  perform net.http_post(
    url := 'https://mtxkushcxczjwypwoxdh.supabase.co/functions/v1/case-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10eGt1c2hjeGN6and5cHdveGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxODI5MjEsImV4cCI6MjEwMTc1ODkyMX0.veuhpvYV93Vv9BhFkUMMkTtz6hG3f_5tEeHu8_nxRz8'
    ),
    body := jsonb_build_object(
      'type', TG_OP,
      'table', TG_TABLE_NAME,
      'schema', TG_TABLE_SCHEMA,
      'record', to_jsonb(NEW),
      'old_record', case when TG_OP = 'UPDATE' then to_jsonb(OLD) else null end
    )
  );
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists cases_notify_webhook on cases;
create trigger cases_notify_webhook
  after insert or update on cases
  for each row execute function notify_case_webhook();

/* --------------------------------------------------------------------- */
/*  Phase 13 — multi-clinic support + Oman governorate/wilayat fields    */
/*                                                                       */
/*  clinics.owner_id was never unique — nothing stopped a dentist owning */
/*  several clinic rows, but cases_select/insert/update/delete only ever */
/*  matched a case against the profile's single default clinic_id, so a  */
/*  dentist could never see or submit a case under a second clinic they  */
/*  own. Broadened to also match any clinic owned by the caller.         */
/*  clinics_select already covered "owner_id = auth.uid()", so the       */
/*  Settings "My Clinics" list needs no policy change — only the cases   */
/*  policies were the actual gap.                                        */
/* --------------------------------------------------------------------- */

alter table clinics add column if not exists governorate text default '';
alter table clinics add column if not exists wilayat text default '';
alter table labs add column if not exists governorate text default '';
alter table labs add column if not exists wilayat text default '';

drop policy if exists "cases_select" on cases;
create policy "cases_select" on cases for select
  using (
    clinic_id = my_clinic_id()
    or clinic_id in (select my_owned_clinic_ids())
    or lab_id = my_lab_id()
  );

drop policy if exists "cases_insert_own_clinic" on cases;
create policy "cases_insert_own_clinic" on cases for insert
  with check (
    clinic_id = my_clinic_id()
    or clinic_id in (select my_owned_clinic_ids())
  );

drop policy if exists "cases_update" on cases;
create policy "cases_update" on cases for update
  using (
    clinic_id = my_clinic_id()
    or clinic_id in (select my_owned_clinic_ids())
    or lab_id = my_lab_id()
  );

drop policy if exists "cases_delete_own_clinic" on cases;
create policy "cases_delete_own_clinic" on cases for delete
  using (
    clinic_id = my_clinic_id()
    or clinic_id in (select my_owned_clinic_ids())
  );

/* --------------------------------------------------------------------- */
/*  Phase 14 — shared secret for the case-notify webhook                 */
/*                                                                       */
/*  case-notify runs with "Verify JWT" OFF (the pg_net trigger can't     */
/*  mint a platform-accepted JWT on this project's JWT signing keys), so */
/*  the endpoint is publicly reachable. The trigger now sends a shared   */
/*  secret header the function checks against its CASE_NOTIFY_SECRET     */
/*  secret. The value lives in a private schema table with no API grants */
/*  — deliberately NOT in this file, which is in a public GitHub repo.   */
/*  Setup (one time, done in the dashboard):                             */
/*    1. insert the secret:                                              */
/*       insert into private.webhook_config (key, value)                 */
/*         values ('case_notify_secret', '<random value>')               */
/*         on conflict (key) do update set value = excluded.value;       */
/*    2. add the same value as Edge Function secret CASE_NOTIFY_SECRET.  */
/* --------------------------------------------------------------------- */

create schema if not exists private;

create table if not exists private.webhook_config (
  key text primary key,
  value text not null
);

-- No grants to anon/authenticated: only definer functions can read it.
revoke all on private.webhook_config from anon, authenticated;

create or replace function notify_case_webhook()
returns trigger
security definer
set search_path = public, private
as $$
declare
  secret text;
begin
  select value into secret from private.webhook_config where key = 'case_notify_secret';
  perform net.http_post(
    url := 'https://mtxkushcxczjwypwoxdh.supabase.co/functions/v1/case-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', coalesce(secret, '')
    ),
    body := jsonb_build_object(
      'type', TG_OP,
      'table', TG_TABLE_NAME,
      'schema', TG_TABLE_SCHEMA,
      'record', to_jsonb(NEW),
      'old_record', case when TG_OP = 'UPDATE' then to_jsonb(OLD) else null end
    )
  );
  return NEW;
end;
$$ language plpgsql;

/* --------------------------------------------------------------------- */
/*  Phase 15 — case_notes catches up with multi-clinic (Phase 13)        */
/*                                                                       */
/*  Phase 13 broadened the cases policies so a dentist who owns several  */
/*  clinics can see cases sent under any of them, but case_notes kept    */
/*  matching only the profile's single default clinic. On a case from a  */
/*  secondary clinic the notes thread read as empty (lab messages        */
/*  invisible) and posting failed the insert policy. Same fix: also      */
/*  accept any clinic the caller owns.                                   */
/* --------------------------------------------------------------------- */

drop policy if exists "case_notes_select" on case_notes;
create policy "case_notes_select" on case_notes for select
  using (
    exists (
      select 1 from cases c
      where c.id = case_notes.case_id
        and (
          c.clinic_id = my_clinic_id()
          or c.clinic_id in (select my_owned_clinic_ids())
          or c.lab_id = my_lab_id()
        )
    )
  );

drop policy if exists "case_notes_insert" on case_notes;
create policy "case_notes_insert" on case_notes for insert
  with check (
    exists (
      select 1 from cases c
      where c.id = case_notes.case_id
        and (
          c.clinic_id = my_clinic_id()
          or c.clinic_id in (select my_owned_clinic_ids())
          or c.lab_id = my_lab_id()
        )
    )
  );

/* --------------------------------------------------------------------- */
/*  Phase 16 — lab staff RBAC: lab_admin / lab_tech roles + dual-role    */
/*                                                                       */
/*  A lab is no longer a single account. lab_members is a junction of    */
/*  (lab, user, role); a dual-role user (owner who both manages and      */
/*  benches) simply has two rows. Visibility still flows through         */
/*  profiles.lab_id / my_lab_id() exactly as before — a joining tech     */
/*  gets profiles.lab_id set like any lab user — so no existing SELECT   */
/*  policy changes. What this phase adds on top:                         */
/*    - my_lab_id() returns null for suspended members (kills access);   */
/*    - lab_write_allowed() gates write policies for read-only members;  */
/*    - is_lab_admin() gates lab-settings writes to admins.              */
/*  Users with NO membership rows (legacy owners, mid-claim users) keep  */
/*  full access — the backfill + labs trigger below make that rare.     */
/* --------------------------------------------------------------------- */

create table if not exists lab_members (
  id uuid primary key default gen_random_uuid(),
  lab_id uuid not null references labs(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,  -- null until an invite is claimed (Phase 19)
  email text not null default '',                            -- invite email, matched at signup
  role text not null check (role in ('lab_admin', 'lab_tech')),
  status text not null default 'invited'
    check (status in ('invited', 'active', 'suspended', 'read_only')),
  created_at timestamptz not null default now()
);

create unique index if not exists lab_members_user_role_key
  on lab_members (lab_id, user_id, role) where user_id is not null;
create unique index if not exists lab_members_invite_key
  on lab_members (lab_id, lower(email), role) where user_id is null;
create index if not exists lab_members_user_idx on lab_members (user_id);
create index if not exists lab_members_email_idx on lab_members (lower(email));

alter table lab_members enable row level security;

-- Suspension wins over everything: any suspended membership row for the
-- caller's lab nulls out my_lab_id(), which every lab-side policy keys on.
create or replace function my_lab_id()
returns uuid
language sql security definer stable
set search_path = public
as $$
  select p.lab_id from profiles p
  where p.id = auth.uid()
    and not exists (
      select 1 from lab_members m
      where m.user_id = auth.uid()
        and m.lab_id = p.lab_id
        and m.status = 'suspended'
    );
$$;

-- Write gate: legacy users with no membership rows keep writing; otherwise
-- at least one 'active' row is required (a read_only-only member reads but
-- never writes).
create or replace function lab_write_allowed()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select
    not exists (
      select 1 from lab_members m
      where m.user_id = auth.uid()
        and m.lab_id = (select lab_id from profiles where id = auth.uid())
    )
    or exists (
      select 1 from lab_members m
      where m.user_id = auth.uid()
        and m.lab_id = (select lab_id from profiles where id = auth.uid())
        and m.status = 'active'
    );
$$;

-- Admin gate for lab-settings / roster / pricing writes. The no-rows
-- fallback keeps the original claim flow working: at claim time the new
-- owner has a profile but no membership rows yet (the labs trigger below
-- creates them the moment owner_id lands).
create or replace function is_lab_admin()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select
    not exists (
      select 1 from lab_members m
      where m.user_id = auth.uid()
        and m.lab_id = (select lab_id from profiles where id = auth.uid())
    )
    or exists (
      select 1 from lab_members m
      where m.user_id = auth.uid()
        and m.lab_id = (select lab_id from profiles where id = auth.uid())
        and m.role = 'lab_admin' and m.status = 'active'
    );
$$;

-- Members read their lab's roster (and always their own rows, even while
-- suspended, so the client can explain the suspension); a signing-up user
-- reads invites addressed to their email; platform admin inspects all.
drop policy if exists "lab_members_select" on lab_members;
create policy "lab_members_select" on lab_members for select
  using (
    user_id = auth.uid()
    or lab_id = my_lab_id()
    or (user_id is null and lower(email) = lower(coalesce(auth.jwt()->>'email', '')))
    or is_admin()
  );

drop policy if exists "lab_members_insert_admin" on lab_members;
create policy "lab_members_insert_admin" on lab_members for insert
  with check (lab_id = my_lab_id() and is_lab_admin());

drop policy if exists "lab_members_update_admin" on lab_members;
create policy "lab_members_update_admin" on lab_members for update
  using (lab_id = my_lab_id() and is_lab_admin());

drop policy if exists "lab_members_delete_admin" on lab_members;
create policy "lab_members_delete_admin" on lab_members for delete
  using (lab_id = my_lab_id() and is_lab_admin());

-- Whenever a lab gains an owner (registration or the claim flow), that
-- owner becomes a dual-role active member. SECURITY DEFINER because the
-- claiming user isn't a lab_admin yet — chicken and egg otherwise.
create or replace function backfill_owner_membership()
returns trigger
security definer
set search_path = public
as $$
begin
  -- OLD is unassigned on INSERT — TG_OP must be checked first.
  if new.owner_id is not null
     and (TG_OP = 'INSERT' or new.owner_id is distinct from old.owner_id) then
    insert into lab_members (lab_id, user_id, email, role, status)
    select new.id, new.owner_id,
           coalesce((select email from auth.users where id = new.owner_id), ''),
           r.role, 'active'
    from (values ('lab_admin'), ('lab_tech')) as r(role)
    on conflict (lab_id, user_id, role) where user_id is not null do nothing;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists labs_owner_membership on labs;
create trigger labs_owner_membership
  after insert or update of owner_id on labs
  for each row execute function backfill_owner_membership();

-- One-time backfill: every existing lab owner becomes dual-role active.
insert into lab_members (lab_id, user_id, email, role, status)
select l.id, l.owner_id, coalesce(u.email, ''), r.role, 'active'
from labs l
join auth.users u on u.id = l.owner_id
cross join (values ('lab_admin'), ('lab_tech')) as r(role)
where l.owner_id is not null
on conflict (lab_id, user_id, role) where user_id is not null do nothing;

-- Cases: technician assignment + financial breakdown (populated by the
-- Phase 17 pricing engine; columns land now so the app can ship reads).
alter table cases add column if not exists assigned_tech_id uuid references auth.users(id) on delete set null;
alter table cases add column if not exists base_fee numeric;
alter table cases add column if not exists adjustments jsonb not null default '[]'::jsonb;
alter table cases add column if not exists total_price numeric;
alter table cases add column if not exists invoice_status text not null default 'draft'
  check (invoice_status in ('draft', 'issued', 'paid'));
create index if not exists cases_assigned_tech_idx on cases (assigned_tech_id);

-- Lab-side writes now respect read_only status (suspended is already dead
-- via my_lab_id() returning null).
drop policy if exists "cases_update" on cases;
create policy "cases_update" on cases for update
  using (
    clinic_id = my_clinic_id()
    or clinic_id in (select my_owned_clinic_ids())
    or (lab_id = my_lab_id() and lab_write_allowed())
  );

drop policy if exists "case_notes_insert" on case_notes;
create policy "case_notes_insert" on case_notes for insert
  with check (
    exists (
      select 1 from cases c
      where c.id = case_notes.case_id
        and (
          c.clinic_id = my_clinic_id()
          or c.clinic_id in (select my_owned_clinic_ids())
          or (c.lab_id = my_lab_id() and lab_write_allowed())
        )
    )
  );

-- Lab settings (name, TATs, pricing to come) are admin-only now. The
-- owner_id and creator-clinic branches are unchanged; the staff branch
-- tightens from "any member" to "active lab_admin".
drop policy if exists "labs_update_owner_or_creator" on labs;
create policy "labs_update_owner_or_creator" on labs for update
  using (
    owner_id = auth.uid()
    or created_by_clinic_id = my_clinic_id()
    or (id = my_lab_id() and is_lab_admin())
  );

/* --------------------------------------------------------------------- */
/*  Phase 17 — price schedules + automatic case pricing                  */
/*                                                                       */
/*  A lab keeps one or more price lists (one flagged default) of         */
/*  per-restoration-category prices, optionally mapped per clinic with   */
/*  a discount ("VIP rate"). A BEFORE trigger prices each case from      */
/*  those tables server-side — the client never computes or submits      */
/*  money. The trigger FAILS OPEN: any error, missing schedule, or       */
/*  unknown category leaves the fee columns untouched and never blocks   */
/*  a case write (there are live users; billing must not gate clinical   */
/*  workflow). Fee columns on already-issued/paid cases are frozen.      */
/* --------------------------------------------------------------------- */

create table if not exists price_schedules (
  id uuid primary key default gen_random_uuid(),
  lab_id uuid not null references labs(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

-- at most one default list per lab
create unique index if not exists price_schedules_default_key
  on price_schedules (lab_id) where is_default;
create index if not exists price_schedules_lab_idx on price_schedules (lab_id);

create table if not exists price_schedule_items (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references price_schedules(id) on delete cascade,
  category text not null,          -- Rx form category name (CATEGORY_NAMES)
  code text not null default '',   -- lab's internal billing code
  base_price numeric not null check (base_price >= 0),
  unique (schedule_id, category)
);

create table if not exists clinic_price_rules (
  id uuid primary key default gen_random_uuid(),
  lab_id uuid not null references labs(id) on delete cascade,
  clinic_id uuid not null references clinics(id) on delete cascade,
  price_schedule_id uuid references price_schedules(id) on delete set null,
  discount_pct numeric not null default 0 check (discount_pct between -100 and 100),
  unique (lab_id, clinic_id)
);

alter table price_schedules enable row level security;
alter table price_schedule_items enable row level security;
alter table clinic_price_rules enable row level security;

-- Lab members read their lab's pricing; only active lab_admins write it;
-- platform admin gets read-only inspection. Clinics never see lab price
-- lists — they only ever see the priced totals on their own cases.
drop policy if exists "price_schedules_select" on price_schedules;
create policy "price_schedules_select" on price_schedules for select
  using (lab_id = my_lab_id() or is_admin());

drop policy if exists "price_schedules_insert_admin" on price_schedules;
create policy "price_schedules_insert_admin" on price_schedules for insert
  with check (lab_id = my_lab_id() and is_lab_admin());

drop policy if exists "price_schedules_update_admin" on price_schedules;
create policy "price_schedules_update_admin" on price_schedules for update
  using (lab_id = my_lab_id() and is_lab_admin());

drop policy if exists "price_schedules_delete_admin" on price_schedules;
create policy "price_schedules_delete_admin" on price_schedules for delete
  using (lab_id = my_lab_id() and is_lab_admin());

drop policy if exists "price_items_select" on price_schedule_items;
create policy "price_items_select" on price_schedule_items for select
  using (exists (
    select 1 from price_schedules s
    where s.id = price_schedule_items.schedule_id
      and (s.lab_id = my_lab_id() or is_admin())
  ));

drop policy if exists "price_items_insert_admin" on price_schedule_items;
create policy "price_items_insert_admin" on price_schedule_items for insert
  with check (exists (
    select 1 from price_schedules s
    where s.id = price_schedule_items.schedule_id
      and s.lab_id = my_lab_id() and is_lab_admin()
  ));

drop policy if exists "price_items_update_admin" on price_schedule_items;
create policy "price_items_update_admin" on price_schedule_items for update
  using (exists (
    select 1 from price_schedules s
    where s.id = price_schedule_items.schedule_id
      and s.lab_id = my_lab_id() and is_lab_admin()
  ));

drop policy if exists "price_items_delete_admin" on price_schedule_items;
create policy "price_items_delete_admin" on price_schedule_items for delete
  using (exists (
    select 1 from price_schedules s
    where s.id = price_schedule_items.schedule_id
      and s.lab_id = my_lab_id() and is_lab_admin()
  ));

drop policy if exists "clinic_price_rules_select" on clinic_price_rules;
create policy "clinic_price_rules_select" on clinic_price_rules for select
  using (lab_id = my_lab_id() or is_admin());

drop policy if exists "clinic_price_rules_insert_admin" on clinic_price_rules;
create policy "clinic_price_rules_insert_admin" on clinic_price_rules for insert
  with check (lab_id = my_lab_id() and is_lab_admin());

drop policy if exists "clinic_price_rules_update_admin" on clinic_price_rules;
create policy "clinic_price_rules_update_admin" on clinic_price_rules for update
  using (lab_id = my_lab_id() and is_lab_admin());

drop policy if exists "clinic_price_rules_delete_admin" on clinic_price_rules;
create policy "clinic_price_rules_delete_admin" on clinic_price_rules for delete
  using (lab_id = my_lab_id() and is_lab_admin());

-- Billing/assignment columns are lab-side only. A clinic writer trying to
-- change them (only possible via a hand-crafted API call — the app never
-- sends them) gets the old values silently restored. Fires before the
-- pricing trigger ("g" < "p" in trigger name order), so legitimate
-- repricing still lands afterwards.
create or replace function guard_lab_financial_columns()
returns trigger
as $$
begin
  if current_setting('role', true) is distinct from 'service_role'
     and (new.lab_id is null or new.lab_id is distinct from my_lab_id()) then
    new.assigned_tech_id := old.assigned_tech_id;
    new.invoice_status := old.invoice_status;
    new.base_fee := old.base_fee;
    new.adjustments := old.adjustments;
    new.total_price := old.total_price;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists cases_guard_financials on cases;
create trigger cases_guard_financials
  before update on cases
  for each row execute function guard_lab_financial_columns();

-- The pricing engine. SECURITY DEFINER: it runs during a dentist's case
-- insert, and the dentist's own RLS can't read the lab's price tables.
create or replace function price_case()
returns trigger
security definer
set search_path = public
as $$
declare
  sched uuid;
  disc numeric := 0;
  base numeric := 0;
  priced boolean := false;
  r record;
  p numeric;
  adj jsonb := '[]'::jsonb;
  credit numeric := 0;
begin
  -- issued/paid invoices are frozen; new lab-less cases can't be priced
  if tg_op = 'UPDATE' and old.invoice_status in ('issued', 'paid') then
    return new;
  end if;
  if new.lab_id is null then
    return new;
  end if;

  -- clinic-specific schedule/discount, else the lab's default list
  select cpr.price_schedule_id, coalesce(cpr.discount_pct, 0)
    into sched, disc
    from clinic_price_rules cpr
   where cpr.lab_id = new.lab_id and cpr.clinic_id = new.clinic_id;
  if sched is null then
    select ps.id into sched from price_schedules ps
     where ps.lab_id = new.lab_id and ps.is_default
     limit 1;
  end if;
  if sched is null then
    return new;  -- lab has no price list yet: leave fee columns alone
  end if;

  -- itemize: multi-restoration cart, or the flat legacy/appliance shape
  for r in
    select x->>'category' as category,
           greatest(coalesce(jsonb_array_length(x->'teeth'), 0), 1) as units
      from jsonb_array_elements(
             coalesce(new.prescription->'restorations',
                      jsonb_build_array(new.prescription))) as x
  loop
    select psi.base_price into p
      from price_schedule_items psi
     where psi.schedule_id = sched and psi.category = r.category;
    if p is not null then
      base := base + p * r.units;
      priced := true;
    end if;
  end loop;

  if not priced then
    return new;  -- nothing matched the list: don't write misleading zeros
  end if;

  if disc <> 0 then
    adj := adj || jsonb_build_array(jsonb_build_object(
      'label', 'Clinic rate ' || (case when disc > 0 then '−' else '+' end) || abs(disc)::text || '%',
      'amount', round(-(base * disc / 100.0), 3)));
  end if;
  if new.remake is not null and coalesce((new.remake->>'cost')::numeric, 0) > 0 then
    credit := (new.remake->>'cost')::numeric;
    adj := adj || jsonb_build_array(jsonb_build_object('label', 'Remake credit', 'amount', -credit));
  end if;

  new.base_fee := round(base, 3);
  new.adjustments := adj;
  new.total_price := greatest(0, round(base - (base * disc / 100.0) - credit, 3));
  return new;
exception when others then
  -- pricing must NEVER block a clinical case write
  return new;
end;
$$ language plpgsql;

drop trigger if exists cases_price on cases;
create trigger cases_price
  before insert or update of prescription, remake, lab_id on cases
  for each row execute function price_case();

/* --------------------------------------------------------------------- */
/*  Phase 18 — reprice RPC + lab roster visibility                       */
/* --------------------------------------------------------------------- */

-- One-click "re-price unbilled cases" for the Price Lists tab. The no-op
-- "set prescription = prescription" exists purely to fire the cases_price
-- trigger on every draft case of the caller's lab. SECURITY DEFINER so it
-- can touch all the lab's rows in one statement; scope + role are checked
-- explicitly first. Issued/paid invoices stay frozen (trigger + WHERE).
create or replace function reprice_unbilled_cases()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if my_lab_id() is null or not is_lab_admin() then
    raise exception 'Only an active lab admin can re-price cases';
  end if;
  update cases
     set prescription = prescription
   where lab_id = my_lab_id()
     and invoice_status = 'draft';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Lab members can see their co-members' profiles — needed for the
-- technician roster (names/avatars). Scoped to the caller's own lab;
-- my_lab_id() already nulls out for suspended members.
drop policy if exists "profiles_select_lab_members" on profiles;
create policy "profiles_select_lab_members" on profiles for select
  using (lab_id is not null and lab_id = my_lab_id());

/* --------------------------------------------------------------------- */
/*  Phase 19 — staff invites, org-join validation, lab deactivation      */
/*                                                                       */
/*  SECURITY FIX included: since Phase 5, profiles_insert/update only    */
/*  checked id = auth.uid() — nothing server-side stopped a signup from  */
/*  pointing profiles.lab_id/clinic_id at ANY org and reading its data   */
/*  through my_lab_id()/my_clinic_id() (the claim flow was client-side   */
/*  only). can_join_lab()/can_join_clinic() close that: an org pointer   */
/*  is only writable when you own the org, are already a member, hold a  */
/*  matching email invite, or the org is a legitimately claimable        */
/*  orphan.                                                              */
/* --------------------------------------------------------------------- */

create or replace function can_join_lab(target uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select
    -- you own it, or it's an unclaimed lab (the original claim flow)
    exists (select 1 from labs l where l.id = target
            and (l.owner_id = auth.uid() or l.owner_id is null))
    -- you're already on its roster
    or exists (select 1 from lab_members m where m.lab_id = target and m.user_id = auth.uid())
    -- or you hold an invite addressed to your login email
    or exists (select 1 from lab_members m where m.lab_id = target and m.user_id is null
               and lower(m.email) = lower(coalesce(auth.jwt()->>'email', '')));
$$;

create or replace function can_join_clinic(target uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from clinics c
    where c.id = target
      and (
        c.owner_id = auth.uid()
        -- orphaned clinic (owner login deleted): claimable by email match,
        -- or freely when no email was ever recorded on the row
        or (c.owner_id is null
            and (lower(coalesce(c.email, '')) = lower(coalesce(auth.jwt()->>'email', ''))
                 or coalesce(c.email, '') = ''))
      )
  );
$$;

drop policy if exists "profiles_insert_own" on profiles;
create policy "profiles_insert_own" on profiles for insert
  with check (
    id = auth.uid()
    and (clinic_id is null or can_join_clinic(clinic_id))
    and (lab_id is null or can_join_lab(lab_id))
  );

drop policy if exists "profiles_update_own" on profiles;
create policy "profiles_update_own" on profiles for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and (clinic_id is null or can_join_clinic(clinic_id))
    and (lab_id is null or can_join_lab(lab_id))
  );

-- Invite claim: the invited person (matched by login email) may take an
-- unclaimed row. The guard trigger pins everything except user_id —
-- a claim can never change its own role or lab, and always lands active.
drop policy if exists "lab_members_claim_invite" on lab_members;
create policy "lab_members_claim_invite" on lab_members for update
  using (user_id is null and lower(email) = lower(coalesce(auth.jwt()->>'email', '')))
  with check (user_id = auth.uid());

create or replace function guard_invite_claim()
returns trigger
as $$
begin
  if old.user_id is null and new.user_id is not null
     and new.user_id = auth.uid()
     and current_setting('role', true) is distinct from 'service_role' then
    if new.role is distinct from old.role or new.lab_id is distinct from old.lab_id then
      raise exception 'invite claim cannot change role or lab';
    end if;
    new.status := 'active';
    new.email := old.email;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists lab_members_guard_claim on lab_members;
create trigger lab_members_guard_claim
  before update on lab_members
  for each row execute function guard_invite_claim();

-- Tenant deactivation: a suspended lab goes fully dark for its members.
alter table labs add column if not exists status text not null default 'active'
  check (status in ('active', 'suspended'));

create or replace function my_lab_id()
returns uuid
language sql security definer stable
set search_path = public
as $$
  select p.lab_id from profiles p
  join labs l on l.id = p.lab_id
  where p.id = auth.uid()
    and l.status = 'active'
    and not exists (
      select 1 from lab_members m
      where m.user_id = auth.uid()
        and m.lab_id = p.lab_id
        and m.status = 'suspended'
    );
$$;

-- Now that the Staff tab manages membership rows, the old "no rows = full
-- access" fallback is retired in favor of an explicit owner check —
-- otherwise removing someone's rows would GRANT them access. ("Remove"
-- in the UI suspends rather than deletes for the same reason; only
-- unclaimed invites are ever hard-deleted.)
create or replace function is_lab_admin()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select
    exists (select 1 from labs l join profiles p on p.lab_id = l.id
            where p.id = auth.uid() and l.owner_id = auth.uid())
    or exists (select 1 from lab_members m
               where m.user_id = auth.uid()
                 and m.lab_id = (select lab_id from profiles where id = auth.uid())
                 and m.role = 'lab_admin' and m.status = 'active');
$$;

create or replace function lab_write_allowed()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select
    exists (select 1 from labs l join profiles p on p.lab_id = l.id
            where p.id = auth.uid() and l.owner_id = auth.uid())
    or exists (select 1 from lab_members m
               where m.user_id = auth.uid()
                 and m.lab_id = (select lab_id from profiles where id = auth.uid())
                 and m.status = 'active');
$$;

/* --------------------------------------------------------------------- */
/*  Phase 20 — designated case-notification recipient                    */
/*                                                                       */
/*  The lab admin picks ONE address (their own or a technician's, from   */
/*  the roster in Lab Settings) to receive new-case emails. Empty means  */
/*  fall back to the lab's general contact email, which is what every    */
/*  lab effectively used before this column existed. Writable via the    */
/*  existing admin-gated labs update policy; read by case-notify.        */
/* --------------------------------------------------------------------- */

alter table labs add column if not exists notify_email text not null default '';

-- The claim flow needs its own branch again: at claim time the lab has no
-- owner and the claimer holds no membership rows, so neither the owner
-- branch nor is_lab_admin() can pass — but their profile already points
-- at the (validated, claimable) lab.
drop policy if exists "labs_update_owner_or_creator" on labs;
create policy "labs_update_owner_or_creator" on labs for update
  using (
    owner_id = auth.uid()
    or created_by_clinic_id = my_clinic_id()
    or (owner_id is null and id = my_lab_id())
    or (id = my_lab_id() and is_lab_admin())
  );

/* --------------------------------------------------------------------- */
/*  Phase 21 — true member removal + emailed invitations                 */
/*                                                                       */
/*  remove_lab_member: an active lab_admin can fully remove a non-owner  */
/*  member (not just suspend). Removal must clear the target's profile   */
/*  row — which only their own RLS could touch — so it runs SECURITY     */
/*  DEFINER with every ownership check inline. The removed login         */
/*  survives; next sign-in lands on Onboarding like a fresh account.     */
/*                                                                       */
/*  Invite emails: an AFTER INSERT trigger on unclaimed lab_members      */
/*  rows posts to the case-notify Edge Function (same pg_net + shared    */
/*  secret machinery as the cases webhook); the function emails the      */
/*  invitee a signup link that pre-fills their address.                  */
/* --------------------------------------------------------------------- */

create or replace function remove_lab_member(target_user uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  caller_lab uuid;
begin
  select lab_id into caller_lab from profiles where id = auth.uid();
  if caller_lab is null or not is_lab_admin() then
    raise exception 'only a lab admin can remove members';
  end if;
  if target_user = auth.uid() then
    raise exception 'you cannot remove yourself';
  end if;
  if exists (select 1 from labs where id = caller_lab and owner_id = target_user) then
    raise exception 'the lab owner cannot be removed';
  end if;
  if (select lab_id from profiles where id = target_user) is distinct from caller_lab then
    raise exception 'user is not a member of your lab';
  end if;

  delete from lab_members where lab_id = caller_lab and user_id = target_user;
  delete from profiles where id = target_user;
end;
$$;

create or replace function notify_invite_webhook()
returns trigger
security definer
set search_path = public, private
as $$
declare
  secret text;
begin
  select value into secret from private.webhook_config where key = 'case_notify_secret';
  perform net.http_post(
    url := 'https://mtxkushcxczjwypwoxdh.supabase.co/functions/v1/case-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', coalesce(secret, '')
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'lab_members',
      'schema', 'public',
      'record', to_jsonb(NEW)
    )
  );
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists lab_members_notify_invite on lab_members;
create trigger lab_members_notify_invite
  after insert on lab_members
  for each row
  when (new.user_id is null)
  execute function notify_invite_webhook();

/* --------------------------------------------------------------------- */
/*  Phase 22 — 30-minute prescription edit window                        */
/*                                                                       */
/*  Dentists may correct a just-submitted Rx (wrong shade, missed tooth) */
/*  for 30 minutes after submission. Enforced here, not just in the UI:  */
/*  the cases_update RLS policy lets a clinic update its cases forever   */
/*  (stage moves, handover, remakes need that), so without this trigger  */
/*  any client could rewrite a prescription the lab is already working   */
/*  from. Labs never edit Rx content — their writes to these columns     */
/*  are reverted, same pattern as guard_lab_financial_columns. The       */
/*  reprice path's "set prescription = prescription" no-op is not a      */
/*  distinct change, so it passes untouched.                             */
/* --------------------------------------------------------------------- */

create or replace function guard_prescription_edits()
returns trigger
as $$
declare
  rx_changed boolean;
  is_clinic_writer boolean;
begin
  if current_setting('role', true) = 'service_role' then
    return new;
  end if;

  rx_changed :=
    new.prescription is distinct from old.prescription
    or new.patient_name is distinct from old.patient_name
    or new.patient_id is distinct from old.patient_id
    or new.patient_phone is distinct from old.patient_phone
    or new.appointment_date is distinct from old.appointment_date
    or new.delivery_time is distinct from old.delivery_time;
  if not rx_changed then
    return new;
  end if;

  is_clinic_writer :=
    old.clinic_id = my_clinic_id()
    or old.clinic_id in (select my_owned_clinic_ids());

  if not is_clinic_writer then
    -- Lab-side write: keep the rest of the patch, drop the Rx changes.
    new.prescription := old.prescription;
    new.patient_name := old.patient_name;
    new.patient_id := old.patient_id;
    new.patient_phone := old.patient_phone;
    new.appointment_date := old.appointment_date;
    new.delivery_time := old.delivery_time;
    return new;
  end if;

  -- Raise instead of silently reverting (the RLS-0-row lesson): the edit
  -- flow sends ONLY Rx fields, and the dentist needs to know it failed.
  if old.created_at < now() - interval '30 minutes' then
    raise exception 'This prescription can no longer be edited — changes are only allowed within 30 minutes of submission.';
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists cases_guard_prescription on cases;
create trigger cases_guard_prescription
  before update on cases
  for each row execute function guard_prescription_edits();

/* --------------------------------------------------------------------- */
/*  Phase 23 — automatic monthly payment reminders                       */
/*                                                                       */
/*  On the 25th of every month at 06:00 UTC (10:00 in Oman), a pg_cron   */
/*  job posts to the payment-reminders Edge Function, which emails each  */
/*  clinic a summary of its ISSUED-but-unpaid invoices per lab (draft    */
/*  cases are never mentioned — no invoice, no reminder). Same shared-   */
/*  secret gate as case-notify, read from private.webhook_config.        */
/*                                                                       */
/*  Manual steps that pair with this block:                              */
/*    1. deploy supabase/functions/payment-reminders/index.ts as a new   */
/*       Edge Function named exactly "payment-reminders", Verify JWT OFF */
/*    2. (nothing else — it reuses the existing secrets)                 */
/* --------------------------------------------------------------------- */

create extension if not exists pg_cron;

create or replace function private.run_payment_reminders()
returns void
security definer
set search_path = public, private
as $$
declare
  secret text;
begin
  select value into secret from private.webhook_config where key = 'case_notify_secret';
  perform net.http_post(
    url := 'https://mtxkushcxczjwypwoxdh.supabase.co/functions/v1/payment-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', coalesce(secret, '')
    ),
    body := jsonb_build_object('source', 'pg_cron'),
    -- Give the function time to email every clinic before pg_net hangs up.
    timeout_milliseconds := 30000
  );
end;
$$ language plpgsql;

-- cron.schedule by name is an upsert in pg_cron — safe to re-run.
select cron.schedule(
  'payment-reminders-monthly',
  '0 6 25 * *',
  $$select private.run_payment_reminders()$$
);

/* --------------------------------------------------------------------- */
/*  Phase 24 — client error reporting + hourly admin alert emails        */
/*                                                                       */
/*  The app inserts crashes into client_errors (anyone may insert, only  */
/*  the super admin may read; a trigger caps volume so a broken client   */
/*  or an abuser can't flood the table). Every hour pg_cron checks for   */
/*  new rows and emails a digest to the admin — via the Resend API       */
/*  called directly from Postgres (pg_net), no Edge Function involved.   */
/*                                                                       */
/*  Manual step: store your Resend API key (resend.com → API Keys) —    */
/*  swap in your key over the placeholder in the INSERT below before     */
/*  running (the placeholder string deliberately appears nowhere else    */
/*  in this file: a find-and-replace-all once poisoned the function's    */
/*  is-configured check, silently disabling alert emails). Without a     */
/*  key, errors are still recorded; only the emails are skipped.         */
/* --------------------------------------------------------------------- */

create table if not exists client_errors (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  message text not null,
  stack text,
  url text,
  ua text,
  user_id uuid default auth.uid()
);

-- Digest state lives on the rows themselves (alerted flips true once
-- emailed) because the sender is an Edge Function that can't reach the
-- private schema through PostgREST.
alter table client_errors add column if not exists alerted boolean not null default false;

alter table client_errors enable row level security;

drop policy if exists "client_errors_insert" on client_errors;
create policy "client_errors_insert" on client_errors for insert with check (true);

drop policy if exists "client_errors_select" on client_errors;
create policy "client_errors_select" on client_errors for select using (is_admin());

-- Flood guard: at most 300 reports per hour platform-wide; oversized
-- fields are clipped server-side even if a client bypasses the app.
create or replace function guard_client_errors()
returns trigger as $$
begin
  if (select count(*) from client_errors where at > now() - interval '1 hour') >= 300 then
    return null; -- silently drop, never error a reporting client
  end if;
  new.message := left(coalesce(new.message, ''), 500);
  new.stack := left(coalesce(new.stack, ''), 4000);
  new.url := left(coalesce(new.url, ''), 300);
  new.ua := left(coalesce(new.ua, ''), 300);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists client_errors_guard on client_errors;
create trigger client_errors_guard
  before insert on client_errors
  for each row execute function guard_client_errors();

-- Resend key for direct-from-Postgres alert emails (write-only storage,
-- same non-exposed private table as the webhook secret).
-- do nothing on conflict: a full-file re-run with the placeholder must
-- never clobber a real key that's already stored.
insert into private.webhook_config (key, value)
  values ('resend_api_key', 'PASTE-RESEND-KEY-HERE')
  on conflict (key) do nothing;

create or replace function private.send_error_alert()
returns void
security definer
set search_path = public, private
as $$
declare
  secret text;
begin
  -- Direct pg_net -> api.resend.com hangs from the DB network (timed out
  -- live on 2026-08-17), so the digest goes through the payment-reminders
  -- Edge Function instead: pg_net reaches the project's own functions
  -- reliably, and Deno -> Resend is the same proven path case-notify uses.
  -- The function reads client_errors where alerted = false and flips the
  -- flag after emailing, so no state lives here.
  if not exists (select 1 from client_errors where alerted = false) then
    return;
  end if;
  select value into secret from private.webhook_config where key = 'case_notify_secret';
  perform net.http_post(
    url := 'https://mtxkushcxczjwypwoxdh.supabase.co/functions/v1/payment-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', coalesce(secret, '')
    ),
    body := jsonb_build_object('task', 'error-digest'),
    timeout_milliseconds := 15000
  );
end;
$$ language plpgsql;

select cron.schedule(
  'error-alerts-hourly',
  '5 * * * *',
  $$select private.send_error_alert()$$
);

/* --------------------------------------------------------------------- */
/*  Phase 25 — per-lab payment-reminder on/off toggle                    */
/*                                                                       */
/*  Lab Settings gains a "Payment reminders" switch. Off = the monthly   */
/*  payment-reminders Edge Function skips every clinic of that lab.      */
/*  Default true preserves the existing always-on behavior; the column   */
/*  is written through the normal labs_update RLS path (lab admins).     */
/*                                                                       */
/*  Manual step that pairs with this block: re-paste                     */
/*  supabase/functions/payment-reminders/index.ts (it now reads the      */
/*  column and skips opted-out labs).                                    */
/* --------------------------------------------------------------------- */

alter table public.labs
  add column if not exists payment_reminders_enabled boolean not null default true;

/* --------------------------------------------------------------------- */
/*  Phase 26 — lab financial engine: monthly statements, payments,       */
/*  expenses, technician commission rates                                */
/*                                                                       */
/*  Replaces the lab's Excel accounting workbook. All four tables are    */
/*  per-lab (multi-tenant) and admin-only via RLS. Statements aggregate  */
/*  unbilled completed cases per clinic per month; recording payments    */
/*  against a statement auto-advances its status, and a fully settled   */
/*  statement marks every included case invoice_status='paid'.          */
/*                                                                       */
/*  Manual steps that pair with this block: none (client deploy only).  */
/* --------------------------------------------------------------------- */

create table if not exists clinic_statements (
  id uuid primary key default gen_random_uuid(),
  lab_id uuid not null references labs(id) on delete cascade,
  clinic_id uuid not null references clinics(id) on delete cascade,
  month date not null,                       -- first day of the billed month
  total numeric not null default 0,
  status text not null default 'unpaid' check (status in ('unpaid','partial','paid')),
  created_at timestamptz not null default now(),
  unique (lab_id, clinic_id, month)
);

alter table cases add column if not exists statement_id uuid references clinic_statements(id) on delete set null;

create table if not exists lab_payments (
  id uuid primary key default gen_random_uuid(),
  lab_id uuid not null references labs(id) on delete cascade,
  clinic_id uuid not null references clinics(id) on delete cascade,
  statement_id uuid references clinic_statements(id) on delete set null,
  amount numeric not null check (amount > 0),
  method text not null check (method in ('cash','cheque','bank')),
  reference text not null default '',
  received_date date not null default current_date,
  -- Cheques start uncleared and only count toward cash-on-hand once
  -- cleared; cash/bank payments clear immediately (client sets this).
  cleared boolean not null default true,
  cleared_date date,
  created_at timestamptz not null default now()
);

create table if not exists lab_expenses (
  id uuid primary key default gen_random_uuid(),
  lab_id uuid not null references labs(id) on delete cascade,
  category text not null check (category in ('Materials','Salaries','Rent','Utilities','Maintenance','Other')),
  amount numeric not null check (amount > 0),
  method text not null check (method in ('cash','cheque','bank')),
  description text not null default '',
  expense_date date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists tech_commission_rates (
  lab_id uuid not null references labs(id) on delete cascade,
  user_id uuid not null,
  rates jsonb not null default '{}'::jsonb,  -- { "<Rx category name>": OMR per unit }
  primary key (lab_id, user_id)
);

-- Financial data is lab-admin-only (techs never see clinic money);
-- the super admin dashboard gets read access for support.
alter table clinic_statements enable row level security;
alter table lab_payments enable row level security;
alter table lab_expenses enable row level security;
alter table tech_commission_rates enable row level security;

drop policy if exists "statements_all" on clinic_statements;
create policy "statements_all" on clinic_statements for all
  using ((lab_id = my_lab_id() and is_lab_admin()) or is_admin())
  with check (lab_id = my_lab_id() and is_lab_admin());

drop policy if exists "payments_all" on lab_payments;
create policy "payments_all" on lab_payments for all
  using ((lab_id = my_lab_id() and is_lab_admin()) or is_admin())
  with check (lab_id = my_lab_id() and is_lab_admin());

drop policy if exists "expenses_all" on lab_expenses;
create policy "expenses_all" on lab_expenses for all
  using ((lab_id = my_lab_id() and is_lab_admin()) or is_admin())
  with check (lab_id = my_lab_id() and is_lab_admin());

drop policy if exists "commission_rates_all" on tech_commission_rates;
create policy "commission_rates_all" on tech_commission_rates for all
  using ((lab_id = my_lab_id() and is_lab_admin()) or is_admin())
  with check (lab_id = my_lab_id() and is_lab_admin());

-- When a case first reached WORK_COMPLETE (stage 3+), from its history
-- audit trail; falls back to created_at for rows with sparse history.
create or replace function case_completed_at(h jsonb, fallback timestamptz)
returns timestamptz
language sql
immutable
as $$
  select coalesce(
    (select min((e->>'at')::timestamptz)
       from jsonb_array_elements(coalesce(h, '[]'::jsonb)) e
      where (e->>'toStage')::int >= 3
        and e->>'action' in ('advance','created')),
    fallback
  );
$$;

-- "Generate monthly statements" button. Sweeps every completed, still-
-- draft, un-statemented case finished on or before the end of p_month
-- into one statement per clinic, marks those cases issued, and returns
-- how many statements were touched. Re-running is safe: an existing
-- statement for that month absorbs newly eligible cases and its status
-- is recomputed against payments already recorded.
create or replace function generate_clinic_statements(p_month date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lab uuid;
  v_cutoff timestamptz;
  v_month date;
  r record;
  v_sid uuid;
  v_sum numeric;
  n integer := 0;
begin
  v_lab := my_lab_id();
  if v_lab is null or not is_lab_admin() then
    raise exception 'Only an active lab admin can generate statements';
  end if;
  v_month := date_trunc('month', p_month)::date;
  v_cutoff := (v_month + interval '1 month');

  for r in
    select clinic_id
      from cases
     where lab_id = v_lab
       and invoice_status = 'draft'
       and statement_id is null
       and stage_index >= 3
       and coalesce(total_price, 0) > 0
       and case_completed_at(history, created_at) < v_cutoff
     group by clinic_id
  loop
    insert into clinic_statements (lab_id, clinic_id, month)
    values (v_lab, r.clinic_id, v_month)
    on conflict (lab_id, clinic_id, month) do update set month = excluded.month
    returning id into v_sid;

    update cases
       set invoice_status = 'issued', statement_id = v_sid
     where lab_id = v_lab
       and clinic_id = r.clinic_id
       and invoice_status = 'draft'
       and statement_id is null
       and stage_index >= 3
       and coalesce(total_price, 0) > 0
       and case_completed_at(history, created_at) < v_cutoff;

    select coalesce(sum(total_price), 0) into v_sum
      from cases where statement_id = v_sid;
    update clinic_statements set total = v_sum where id = v_sid;
    perform statement_recompute(v_sid);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Recompute a statement's status from its recorded payments. Fully
-- settled -> every included case flips to invoice_status='paid'
-- (one-directional: removing a payment later downgrades the statement
-- but never un-pays cases; that stays a manual correction).
create or replace function statement_recompute(p_sid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric;
  v_paid numeric;
  v_status text;
begin
  select total into v_total from clinic_statements where id = p_sid;
  if v_total is null then return; end if;
  select coalesce(sum(amount), 0) into v_paid from lab_payments where statement_id = p_sid;
  v_status := case
    when v_paid <= 0 then 'unpaid'
    when v_paid >= v_total and v_total > 0 then 'paid'
    else 'partial'
  end;
  update clinic_statements set status = v_status where id = p_sid and status is distinct from v_status;
  if v_status = 'paid' then
    update cases set invoice_status = 'paid'
     where statement_id = p_sid and invoice_status = 'issued';
  end if;
end;
$$;

create or replace function lab_payments_after_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.statement_id is not null then
    perform statement_recompute(new.statement_id);
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.statement_id is not null
     and (tg_op = 'DELETE' or old.statement_id is distinct from new.statement_id) then
    perform statement_recompute(old.statement_id);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists lab_payments_recompute on lab_payments;
create trigger lab_payments_recompute
  after insert or update or delete on lab_payments
  for each row execute function lab_payments_after_change();

-- statement_id joins the lab-only case columns: without this, a clinic
-- writer updating its own case would silently null the statement link.
create or replace function guard_lab_financial_columns()
returns trigger
as $$
begin
  if current_setting('role', true) is distinct from 'service_role'
     and (new.lab_id is null or new.lab_id is distinct from my_lab_id()) then
    new.assigned_tech_id := old.assigned_tech_id;
    new.invoice_status := old.invoice_status;
    new.base_fee := old.base_fee;
    new.adjustments := old.adjustments;
    new.total_price := old.total_price;
    new.statement_id := old.statement_id;
  end if;
  return new;
end;
$$ language plpgsql;

/* --------------------------------------------------------------------- */
/*  Phase 27 — case cancellation workflow                                 */
/*                                                                        */
/*  Dentists REQUEST cancellation; the lab approves (setting a            */
/*  cancellation fee for work already done — never more than the case     */
/*  price) or declines. Approved cancellations bill the fee instead of    */
/*  the full price in monthly statements.                                 */
/* --------------------------------------------------------------------- */

alter table cases add column if not exists cancel_status text not null default 'none'
  check (cancel_status in ('none','requested','cancelled','declined'));
alter table cases add column if not exists cancellation_fee numeric;

-- Transition rules, enforced regardless of which client writes:
--   clinic side: none -> requested (only before Work Complete), and
--                requested -> none (withdraw). Anything else reverts.
--                The fee is lab-only and always reverts for clinic writers.
--   lab side:    requested -> cancelled|declined; fee only meaningful on
--                cancelled and capped at the case price (raises loudly —
--                the lab UI surfaces the message).
create or replace function guard_case_cancellation()
returns trigger
as $$
declare
  is_lab_writer boolean;
begin
  if current_setting('role', true) = 'service_role' then
    return new;
  end if;
  is_lab_writer := new.lab_id is not null and new.lab_id = my_lab_id();

  if not is_lab_writer then
    new.cancellation_fee := old.cancellation_fee;
    if new.cancel_status is distinct from old.cancel_status then
      if old.cancel_status = 'none' and new.cancel_status = 'requested'
         and old.stage_index < 3 then
        null; -- allowed: dentist requests before the work is complete
      elsif old.cancel_status = 'requested' and new.cancel_status = 'none' then
        null; -- allowed: dentist withdraws the request
      else
        new.cancel_status := old.cancel_status;
      end if;
    end if;
  else
    if new.cancel_status is distinct from old.cancel_status
       and not (old.cancel_status = 'requested' and new.cancel_status in ('cancelled','declined'))
       and not (old.cancel_status = 'declined' and new.cancel_status = 'none') then
      new.cancel_status := old.cancel_status;
    end if;
    if new.cancellation_fee is not null then
      if new.cancellation_fee < 0 then
        raise exception 'Cancellation fee cannot be negative';
      end if;
      if new.total_price is not null and new.cancellation_fee > new.total_price then
        raise exception 'Cancellation fee (%.3f OMR) cannot exceed the case price (%.3f OMR)',
          new.cancellation_fee, new.total_price;
      end if;
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists cases_guard_cancellation on cases;
create trigger cases_guard_cancellation
  before update on cases
  for each row execute function guard_case_cancellation();

-- Statements now also bill approved cancellations at their fee: a
-- cancelled case with a fee is real money owed for work already done,
-- even though the case never reached Work Complete.
create or replace function generate_clinic_statements(p_month date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lab uuid;
  v_cutoff timestamptz;
  v_month date;
  r record;
  v_sid uuid;
  v_sum numeric;
  n integer := 0;
begin
  v_lab := my_lab_id();
  if v_lab is null or not is_lab_admin() then
    raise exception 'Only an active lab admin can generate statements';
  end if;
  v_month := date_trunc('month', p_month)::date;
  v_cutoff := (v_month + interval '1 month');

  for r in
    select clinic_id
      from cases
     where lab_id = v_lab
       and invoice_status = 'draft'
       and statement_id is null
       and (
         (cancel_status = 'cancelled' and coalesce(cancellation_fee, 0) > 0)
         or (cancel_status <> 'cancelled' and stage_index >= 3 and coalesce(total_price, 0) > 0)
       )
       and case_completed_at(history, created_at) < v_cutoff
     group by clinic_id
  loop
    insert into clinic_statements (lab_id, clinic_id, month)
    values (v_lab, r.clinic_id, v_month)
    on conflict (lab_id, clinic_id, month) do update set month = excluded.month
    returning id into v_sid;

    update cases
       set invoice_status = 'issued', statement_id = v_sid
     where lab_id = v_lab
       and clinic_id = r.clinic_id
       and invoice_status = 'draft'
       and statement_id is null
       and (
         (cancel_status = 'cancelled' and coalesce(cancellation_fee, 0) > 0)
         or (cancel_status <> 'cancelled' and stage_index >= 3 and coalesce(total_price, 0) > 0)
       )
       and case_completed_at(history, created_at) < v_cutoff;

    select coalesce(sum(case when cancel_status = 'cancelled' then coalesce(cancellation_fee, 0) else total_price end), 0)
      into v_sum
      from cases where statement_id = v_sid;
    update clinic_statements set total = v_sum where id = v_sid;
    perform statement_recompute(v_sid);
    n := n + 1;
  end loop;
  return n;
end;
$$;

/* --------------------------------------------------------------------- */
/*  Phase 28 — historical finance import                                  */
/*                                                                        */
/*  New labs arrive with years of Excel bookkeeping. Imported bills and   */
/*  payments reference clinics that are usually NOT registered on the     */
/*  platform, so both financial tables learn a free-text clinic_name      */
/*  and their clinic_id becomes optional. Everything else (status,        */
/*  aging, treasury, recompute trigger) already works on these rows.      */
/* --------------------------------------------------------------------- */

alter table clinic_statements alter column clinic_id drop not null;
alter table clinic_statements add column if not exists clinic_name text not null default '';
alter table lab_payments alter column clinic_id drop not null;
alter table lab_payments add column if not exists clinic_name text not null default '';

/* --------------------------------------------------------------------- */
/*  Phase 27 hotfix — cancellation guard broke for dentists              */
/*                                                                       */
/*  `new.lab_id = my_lab_id()` is NULL (not false) when my_lab_id() is   */
/*  NULL — i.e. for every dentist — so `if not is_lab_writer` skipped    */
/*  to the lab branch, which reverted the dentist's none->requested      */
/*  transition. Live symptom: request saved a history entry but          */
/*  cancel_status stayed 'none' and no badge appeared. coalesce() pins   */
/*  the boolean.                                                         */
/* --------------------------------------------------------------------- */

create or replace function guard_case_cancellation()
returns trigger
as $$
declare
  is_lab_writer boolean;
begin
  if current_setting('role', true) = 'service_role' then
    return new;
  end if;
  is_lab_writer := coalesce(new.lab_id = my_lab_id(), false);

  if not is_lab_writer then
    new.cancellation_fee := old.cancellation_fee;
    if new.cancel_status is distinct from old.cancel_status then
      if old.cancel_status = 'none' and new.cancel_status = 'requested'
         and old.stage_index < 3 then
        null; -- allowed: dentist requests before the work is complete
      elsif old.cancel_status = 'requested' and new.cancel_status = 'none' then
        null; -- allowed: dentist withdraws the request
      else
        new.cancel_status := old.cancel_status;
      end if;
    end if;
  else
    if new.cancel_status is distinct from old.cancel_status
       and not (old.cancel_status = 'requested' and new.cancel_status in ('cancelled','declined'))
       and not (old.cancel_status = 'declined' and new.cancel_status = 'none') then
      new.cancel_status := old.cancel_status;
    end if;
    if new.cancellation_fee is not null then
      if new.cancellation_fee < 0 then
        raise exception 'Cancellation fee cannot be negative';
      end if;
      if new.total_price is not null and new.cancellation_fee > new.total_price then
        raise exception 'Cancellation fee (%.3f OMR) cannot exceed the case price (%.3f OMR)',
          new.cancellation_fee, new.total_price;
      end if;
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

/* --------------------------------------------------------------------- */
/*  Phase 29 — invoice number always editable by the lab                 */
/*                                                                       */
/*  The Phase 7 once-set lock frustrated real use (typos, renumbering).  */
/*  Labs can now edit it freely; it joins the lab-only column guard so   */
/*  clinic writers still can't touch it.                                 */
/* --------------------------------------------------------------------- */

drop trigger if exists cases_lock_invoice_number on cases;
drop function if exists lock_invoice_number();

create or replace function guard_lab_financial_columns()
returns trigger
as $$
begin
  if current_setting('role', true) is distinct from 'service_role'
     and (new.lab_id is null or new.lab_id is distinct from my_lab_id()) then
    new.assigned_tech_id := old.assigned_tech_id;
    new.invoice_status := old.invoice_status;
    new.base_fee := old.base_fee;
    new.adjustments := old.adjustments;
    new.total_price := old.total_price;
    new.statement_id := old.statement_id;
    new.invoice_number := old.invoice_number;
  end if;
  return new;
end;
$$ language plpgsql;

/* --------------------------------------------------------------------- */
/*  Phase 30 — super-admin activation gate for new accounts              */
/*                                                                       */
/*  New self-registered labs AND clinics now start as 'pending' and stay */
/*  dark (no cases, invisible to the other side) until the super admin   */
/*  activates them from the Admin Dashboard. Existing rows are           */
/*  grandfathered to 'active' by the column defaults at add time.        */
/*  Orphan/unclaimed rows stay 'active' on purpose: the claim flows      */
/*  go through my_lab_id()/my_clinic_id(), which now require an active   */
/*  org — a pending orphan would make the claim a silent RLS no-op.      */
/* --------------------------------------------------------------------- */

-- labs: 'pending' joins the active|suspended lifecycle; new rows pending.
alter table labs drop constraint if exists labs_status_check;
alter table labs add constraint labs_status_check
  check (status in ('pending', 'active', 'suspended'));
alter table labs alter column status set default 'pending';

-- clinics get the same lifecycle. Adding the column with default 'active'
-- stamps every EXISTING clinic as active; only then does the default flip
-- to 'pending' for future signups.
alter table clinics add column if not exists status text not null default 'active'
  check (status in ('pending', 'active', 'suspended'));
alter table clinics alter column status set default 'pending';

-- my_clinic_id() now mirrors my_lab_id(): it resolves only while the
-- clinic is active, so every clinic-side policy (cases, case_notes,
-- statements, …) goes dark for pending/suspended clinics in one place.
-- The dentist can still read their own clinic row (clinics_select owner
-- branch) — that's what lets the client show the "awaiting activation"
-- screen instead of a blank app.
create or replace function my_clinic_id()
returns uuid
language sql security definer stable
set search_path = public
as $$
  select p.clinic_id from profiles p
  join clinics c on c.id = p.clinic_id
  where p.id = auth.uid()
    and c.status = 'active';
$$;

create or replace function my_owned_clinic_ids()
returns setof uuid
language sql security definer stable
set search_path = public
as $$
  select id from clinics where owner_id = auth.uid() and status = 'active';
$$;

/* --------------------------------------------------------------------- */
/*  Phase 31 — imported statement line items                             */
/*                                                                       */
/*  Statements generated from live cases are itemized via               */
/*  cases.statement_id; statements imported from a lab's historical      */
/*  Excel have no case rows, so the line detail (invoice no, dentist,    */
/*  patient, procedure, units, price) rides along as jsonb instead.      */
/*  Shape: [{ date, invoice, dentist, patient, procedure, units,        */
/*  price, amount }]. Empty for platform-generated statements.          */
/* --------------------------------------------------------------------- */

alter table clinic_statements add column if not exists line_items jsonb not null default '[]'::jsonb;

/* --------------------------------------------------------------------- */
/*  Phase 32 — lab-editable final case price                             */
/*                                                                       */
/*  The lab can always set a case's final price by hand before the work  */
/*  goes back to the clinic. A manual price is STICKY: the pricing       */
/*  trigger skips overridden cases entirely, so Rx edits and the         */
/*  "Re-price unbilled cases" RPC (whose no-op prescription write fires  */
/*  this same trigger) can never clobber it. Clearing the flag while     */
/*  touching prescription recomputes automatically. Dentists can't flip  */
/*  the flag — it joins the lab-only financial column guard.             */
/* --------------------------------------------------------------------- */

alter table cases add column if not exists price_overridden boolean not null default false;

create or replace function price_case()
returns trigger
security definer
set search_path = public
as $$
declare
  sched uuid;
  disc numeric := 0;
  base numeric := 0;
  priced boolean := false;
  r record;
  p numeric;
  adj jsonb := '[]'::jsonb;
  credit numeric := 0;
begin
  -- issued/paid invoices are frozen; new lab-less cases can't be priced
  if tg_op = 'UPDATE' and old.invoice_status in ('issued', 'paid') then
    return new;
  end if;
  -- Phase 32: manually set final prices are sticky until the lab clears them
  if tg_op = 'UPDATE' and new.price_overridden then
    return new;
  end if;
  if new.lab_id is null then
    return new;
  end if;

  -- clinic-specific schedule/discount, else the lab's default list
  select cpr.price_schedule_id, coalesce(cpr.discount_pct, 0)
    into sched, disc
    from clinic_price_rules cpr
   where cpr.lab_id = new.lab_id and cpr.clinic_id = new.clinic_id;
  if sched is null then
    select ps.id into sched from price_schedules ps
     where ps.lab_id = new.lab_id and ps.is_default
     limit 1;
  end if;
  if sched is null then
    return new;  -- lab has no price list yet: leave fee columns alone
  end if;

  -- itemize: multi-restoration cart, or the flat legacy/appliance shape
  for r in
    select x->>'category' as category,
           greatest(coalesce(jsonb_array_length(x->'teeth'), 0), 1) as units
      from jsonb_array_elements(
             coalesce(new.prescription->'restorations',
                      jsonb_build_array(new.prescription))) as x
  loop
    select psi.base_price into p
      from price_schedule_items psi
     where psi.schedule_id = sched and psi.category = r.category;
    if p is not null then
      base := base + p * r.units;
      priced := true;
    end if;
  end loop;

  if not priced then
    return new;  -- nothing matched the list: don't write misleading zeros
  end if;

  if disc <> 0 then
    adj := adj || jsonb_build_array(jsonb_build_object(
      'label', 'Clinic rate ' || (case when disc > 0 then '−' else '+' end) || abs(disc)::text || '%',
      'amount', round(-(base * disc / 100.0), 3)));
  end if;
  if new.remake is not null and coalesce((new.remake->>'cost')::numeric, 0) > 0 then
    credit := (new.remake->>'cost')::numeric;
    adj := adj || jsonb_build_array(jsonb_build_object('label', 'Remake credit', 'amount', -credit));
  end if;

  new.base_fee := round(base, 3);
  new.adjustments := adj;
  new.total_price := greatest(0, round(base - (base * disc / 100.0) - credit, 3));
  return new;
exception when others then
  -- pricing must NEVER block a clinical case write
  return new;
end;
$$ language plpgsql;

create or replace function guard_lab_financial_columns()
returns trigger
as $$
begin
  if current_setting('role', true) is distinct from 'service_role'
     and (new.lab_id is null or new.lab_id is distinct from my_lab_id()) then
    new.assigned_tech_id := old.assigned_tech_id;
    new.invoice_status := old.invoice_status;
    new.base_fee := old.base_fee;
    new.adjustments := old.adjustments;
    new.total_price := old.total_price;
    new.statement_id := old.statement_id;
    new.invoice_number := old.invoice_number;
    new.price_overridden := old.price_overridden;
  end if;
  return new;
end;
$$ language plpgsql;

/* --------------------------------------------------------------------- */
/*  Phase 33 — dentist-side expected-price estimate                      */
/*                                                                       */
/*  Dentists can't read the lab's price tables (Phase 17 keeps them      */
/*  lab-only), so the Rx form asks this SECURITY DEFINER function for a  */
/*  live estimate instead. It mirrors price_case()'s itemization for a   */
/*  hypothetical prescription and only answers for a clinic the caller   */
/*  actually owns — no price-list contents ever leave the database,      */
/*  just the one computed number the clinic would be charged anyway.     */
/* --------------------------------------------------------------------- */

create or replace function estimate_case_price(p_lab uuid, p_clinic uuid, p_prescription jsonb)
returns numeric
language plpgsql security definer stable
set search_path = public
as $$
declare
  sched uuid;
  disc numeric := 0;
  base numeric := 0;
  priced boolean := false;
  r record;
  p numeric;
begin
  if p_lab is null or p_clinic is null or p_prescription is null then
    return null;
  end if;
  -- only the clinic's own dentist (or its member) may ask about its rates
  if not (p_clinic in (select my_owned_clinic_ids()) or p_clinic = my_clinic_id()) then
    return null;
  end if;

  select cpr.price_schedule_id, coalesce(cpr.discount_pct, 0)
    into sched, disc
    from clinic_price_rules cpr
   where cpr.lab_id = p_lab and cpr.clinic_id = p_clinic;
  if sched is null then
    select ps.id into sched from price_schedules ps
     where ps.lab_id = p_lab and ps.is_default
     limit 1;
  end if;
  if sched is null then
    return null;
  end if;

  for r in
    select x->>'category' as category,
           greatest(coalesce(jsonb_array_length(x->'teeth'), 0), 1) as units
      from jsonb_array_elements(
             coalesce(p_prescription->'restorations',
                      jsonb_build_array(p_prescription))) as x
  loop
    select psi.base_price into p
      from price_schedule_items psi
     where psi.schedule_id = sched and psi.category = r.category;
    if p is not null then
      base := base + p * r.units;
      priced := true;
    end if;
  end loop;

  if not priced then
    return null;
  end if;
  return greatest(0, round(base - (base * disc / 100.0), 3));
exception when others then
  return null;  -- an estimate must never break the Rx form
end;
$$;

/* --------------------------------------------------------------------- */
/*  Phase 34 — appliance categories price per appliance, not per tooth   */
/*                                                                       */
/*  A removable denture marked with 16 teeth was billing 16 units        */
/*  (real case: 680 x 16 = 10,880 OMR). Tooth-borne work (crowns,        */
/*  bridges, veneers) keeps per-tooth units; whole-case appliances       */
/*  (dentures, splints, "Others") count as ONE unit per restoration.     */
/*  Applies to both the pricing trigger and the Rx-form estimator.       */
/* --------------------------------------------------------------------- */

create or replace function price_case()
returns trigger
security definer
set search_path = public
as $$
declare
  sched uuid;
  disc numeric := 0;
  base numeric := 0;
  priced boolean := false;
  r record;
  p numeric;
  adj jsonb := '[]'::jsonb;
  credit numeric := 0;
begin
  if tg_op = 'UPDATE' and old.invoice_status in ('issued', 'paid') then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.price_overridden then
    return new;
  end if;
  if new.lab_id is null then
    return new;
  end if;

  select cpr.price_schedule_id, coalesce(cpr.discount_pct, 0)
    into sched, disc
    from clinic_price_rules cpr
   where cpr.lab_id = new.lab_id and cpr.clinic_id = new.clinic_id;
  if sched is null then
    select ps.id into sched from price_schedules ps
     where ps.lab_id = new.lab_id and ps.is_default
     limit 1;
  end if;
  if sched is null then
    return new;
  end if;

  for r in
    select x->>'category' as category,
           case
             when x->>'category' in ('Removable denture', 'Michigan splint', 'Orthodontics splint',
                                     'Single layer splint - soft', 'Double layer splint - soft',
                                     'Double layer splint - outer hard, inner soft', 'Others - refer to notes')
               then 1
             else greatest(coalesce(jsonb_array_length(x->'teeth'), 0), 1)
           end as units
      from jsonb_array_elements(
             coalesce(new.prescription->'restorations',
                      jsonb_build_array(new.prescription))) as x
  loop
    select psi.base_price into p
      from price_schedule_items psi
     where psi.schedule_id = sched and psi.category = r.category;
    if p is not null then
      base := base + p * r.units;
      priced := true;
    end if;
  end loop;

  if not priced then
    return new;
  end if;

  if disc <> 0 then
    adj := adj || jsonb_build_array(jsonb_build_object(
      'label', 'Clinic rate ' || (case when disc > 0 then '−' else '+' end) || abs(disc)::text || '%',
      'amount', round(-(base * disc / 100.0), 3)));
  end if;
  if new.remake is not null and coalesce((new.remake->>'cost')::numeric, 0) > 0 then
    credit := (new.remake->>'cost')::numeric;
    adj := adj || jsonb_build_array(jsonb_build_object('label', 'Remake credit', 'amount', -credit));
  end if;

  new.base_fee := round(base, 3);
  new.adjustments := adj;
  new.total_price := greatest(0, round(base - (base * disc / 100.0) - credit, 3));
  return new;
exception when others then
  return new;
end;
$$ language plpgsql;

create or replace function estimate_case_price(p_lab uuid, p_clinic uuid, p_prescription jsonb)
returns numeric
language plpgsql security definer stable
set search_path = public
as $$
declare
  sched uuid;
  disc numeric := 0;
  base numeric := 0;
  priced boolean := false;
  r record;
  p numeric;
begin
  if p_lab is null or p_clinic is null or p_prescription is null then
    return null;
  end if;
  if not (p_clinic in (select my_owned_clinic_ids()) or p_clinic = my_clinic_id()) then
    return null;
  end if;

  select cpr.price_schedule_id, coalesce(cpr.discount_pct, 0)
    into sched, disc
    from clinic_price_rules cpr
   where cpr.lab_id = p_lab and cpr.clinic_id = p_clinic;
  if sched is null then
    select ps.id into sched from price_schedules ps
     where ps.lab_id = p_lab and ps.is_default
     limit 1;
  end if;
  if sched is null then
    return null;
  end if;

  for r in
    select x->>'category' as category,
           case
             when x->>'category' in ('Removable denture', 'Michigan splint', 'Orthodontics splint',
                                     'Single layer splint - soft', 'Double layer splint - soft',
                                     'Double layer splint - outer hard, inner soft', 'Others - refer to notes')
               then 1
             else greatest(coalesce(jsonb_array_length(x->'teeth'), 0), 1)
           end as units
      from jsonb_array_elements(
             coalesce(p_prescription->'restorations',
                      jsonb_build_array(p_prescription))) as x
  loop
    select psi.base_price into p
      from price_schedule_items psi
     where psi.schedule_id = sched and psi.category = r.category;
    if p is not null then
      base := base + p * r.units;
      priced := true;
    end if;
  end loop;

  if not priced then
    return null;
  end if;
  return greatest(0, round(base - (base * disc / 100.0), 3));
exception when others then
  return null;
end;
$$;

/* --------------------------------------------------------------------- */
/*  Phase 35 — supplier invoice number on expenses                       */
/* --------------------------------------------------------------------- */

alter table lab_expenses add column if not exists invoice_number text not null default '';

/* --------------------------------------------------------------------- */
/*  Phase 36 — lab-determined shade                                      */
/*                                                                       */
/*  When the dentist picks "Shade by Lab", the technician records the    */
/*  actual shade here before the work returns to the clinic. Lab-only    */
/*  writable (joins the financial-column guard); the clinic sees it      */
/*  read-only in the case details.                                       */
/* --------------------------------------------------------------------- */

alter table cases add column if not exists lab_shade text not null default '';

create or replace function guard_lab_financial_columns()
returns trigger
as $$
begin
  if current_setting('role', true) is distinct from 'service_role'
     and (new.lab_id is null or new.lab_id is distinct from my_lab_id()) then
    new.assigned_tech_id := old.assigned_tech_id;
    new.invoice_status := old.invoice_status;
    new.base_fee := old.base_fee;
    new.adjustments := old.adjustments;
    new.total_price := old.total_price;
    new.statement_id := old.statement_id;
    new.invoice_number := old.invoice_number;
    new.price_overridden := old.price_overridden;
    new.lab_shade := old.lab_shade;
  end if;
  return new;
end;
$$ language plpgsql;

/* --------------------------------------------------------------------- */
/*  Phase 37 — "Accountant" lab role + sign-in audit log                 */
/*                                                                       */
/*  Accountants run the money side (billing, expenses, price lists) and  */
/*  work the technician case queue, but they are NOT admins: no          */
/*  Overview/financial analysis, no Technicians panel, no Staff          */
/*  management, no Lab Settings. Their view of bills and expenses is     */
/*  capped at the last 2 calendar months — EXCEPT statements a clinic    */
/*  still owes money on, which stay visible at any age so collections    */
/*  keep working. All enforced here in RLS, not just hidden in the UI.   */
/*                                                                       */
/*  login_events is an append-only sign-in audit (every clinic and lab   */
/*  user), readable only by the platform super admin ("Staff logs").     */
/* --------------------------------------------------------------------- */

alter table lab_members drop constraint if exists lab_members_role_check;
alter table lab_members add constraint lab_members_role_check
  check (role in ('lab_admin', 'lab_tech', 'accountant'));

create or replace function is_lab_accountant()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from lab_members m
    where m.user_id = auth.uid()
      and m.lab_id = (select lab_id from profiles where id = auth.uid())
      and m.role = 'accountant' and m.status = 'active'
  );
$$;

-- Money-side write access: admins and accountants alike.
create or replace function is_lab_finance()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select is_lab_admin() or is_lab_accountant();
$$;

-- The accountant's rolling visibility window: first day of the month,
-- two months back (e.g. on 20 Aug the cutoff is 1 Jun).
create or replace function accountant_cutoff()
returns date
language sql stable
as $$
  select (date_trunc('month', now()) - interval '2 months')::date;
$$;

-- Statements: admins see everything; accountants see the recent window
-- plus ANY statement that still has money owing on it.
drop policy if exists "statements_all" on clinic_statements;
create policy "statements_select" on clinic_statements for select
  using (
    is_admin()
    or (lab_id = my_lab_id()
        and (is_lab_admin()
             or (is_lab_accountant() and (month >= accountant_cutoff() or status <> 'paid'))))
  );
drop policy if exists "statements_insert" on clinic_statements;
create policy "statements_insert" on clinic_statements for insert
  with check (lab_id = my_lab_id() and is_lab_finance());
drop policy if exists "statements_update" on clinic_statements;
create policy "statements_update" on clinic_statements for update
  using (lab_id = my_lab_id() and is_lab_finance());
drop policy if exists "statements_delete" on clinic_statements;
create policy "statements_delete" on clinic_statements for delete
  using (lab_id = my_lab_id() and is_lab_finance());

drop policy if exists "payments_all" on lab_payments;
create policy "payments_select" on lab_payments for select
  using (
    is_admin()
    or (lab_id = my_lab_id()
        and (is_lab_admin()
             or (is_lab_accountant() and received_date >= accountant_cutoff())))
  );
drop policy if exists "payments_insert" on lab_payments;
create policy "payments_insert" on lab_payments for insert
  with check (lab_id = my_lab_id() and is_lab_finance());
drop policy if exists "payments_update" on lab_payments;
create policy "payments_update" on lab_payments for update
  using (lab_id = my_lab_id() and is_lab_finance());
drop policy if exists "payments_delete" on lab_payments;
create policy "payments_delete" on lab_payments for delete
  using (lab_id = my_lab_id() and is_lab_finance());

drop policy if exists "expenses_all" on lab_expenses;
create policy "expenses_select" on lab_expenses for select
  using (
    is_admin()
    or (lab_id = my_lab_id()
        and (is_lab_admin()
             or (is_lab_accountant() and expense_date >= accountant_cutoff())))
  );
drop policy if exists "expenses_insert" on lab_expenses;
create policy "expenses_insert" on lab_expenses for insert
  with check (lab_id = my_lab_id() and is_lab_finance());
drop policy if exists "expenses_update" on lab_expenses;
create policy "expenses_update" on lab_expenses for update
  using (lab_id = my_lab_id() and is_lab_finance());
drop policy if exists "expenses_delete" on lab_expenses;
create policy "expenses_delete" on lab_expenses for delete
  using (lab_id = my_lab_id() and is_lab_finance());

-- Price lists: accountants manage them too (writes were admin-only).
drop policy if exists "price_schedules_insert_admin" on price_schedules;
create policy "price_schedules_insert_admin" on price_schedules for insert
  with check (lab_id = my_lab_id() and is_lab_finance());
drop policy if exists "price_schedules_update_admin" on price_schedules;
create policy "price_schedules_update_admin" on price_schedules for update
  using (lab_id = my_lab_id() and is_lab_finance());
drop policy if exists "price_schedules_delete_admin" on price_schedules;
create policy "price_schedules_delete_admin" on price_schedules for delete
  using (lab_id = my_lab_id() and is_lab_finance());

drop policy if exists "price_items_insert_admin" on price_schedule_items;
create policy "price_items_insert_admin" on price_schedule_items for insert
  with check (exists (
    select 1 from price_schedules s
     where s.id = schedule_id and s.lab_id = my_lab_id() and is_lab_finance()
  ));
drop policy if exists "price_items_update_admin" on price_schedule_items;
create policy "price_items_update_admin" on price_schedule_items for update
  using (exists (
    select 1 from price_schedules s
     where s.id = schedule_id and s.lab_id = my_lab_id() and is_lab_finance()
  ));
drop policy if exists "price_items_delete_admin" on price_schedule_items;
create policy "price_items_delete_admin" on price_schedule_items for delete
  using (exists (
    select 1 from price_schedules s
     where s.id = schedule_id and s.lab_id = my_lab_id() and is_lab_finance()
  ));

drop policy if exists "clinic_price_rules_insert_admin" on clinic_price_rules;
create policy "clinic_price_rules_insert_admin" on clinic_price_rules for insert
  with check (lab_id = my_lab_id() and is_lab_finance());
drop policy if exists "clinic_price_rules_update_admin" on clinic_price_rules;
create policy "clinic_price_rules_update_admin" on clinic_price_rules for update
  using (lab_id = my_lab_id() and is_lab_finance());
drop policy if exists "clinic_price_rules_delete_admin" on clinic_price_rules;
create policy "clinic_price_rules_delete_admin" on clinic_price_rules for delete
  using (lab_id = my_lab_id() and is_lab_finance());

-- Repricing goes with price-list editing.
create or replace function reprice_unbilled_cases()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if my_lab_id() is null or not is_lab_finance() then
    raise exception 'Only an active lab admin or accountant can re-price cases';
  end if;
  update cases
     set prescription = prescription
   where lab_id = my_lab_id()
     and invoice_status = 'draft';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Sign-in audit ("Staff logs" on the super admin dashboard). Append-only:
-- each user may insert their own row at sign-in; only the platform admin
-- reads; nobody updates or deletes through the API.
create table if not exists login_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null default '',
  role text not null default '',
  org_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists login_events_created_idx on login_events (created_at desc);
alter table login_events enable row level security;
drop policy if exists "login_events_insert_own" on login_events;
create policy "login_events_insert_own" on login_events for insert
  with check (user_id = auth.uid());
drop policy if exists "login_events_select_admin" on login_events;
create policy "login_events_select_admin" on login_events for select
  using (is_admin());

/* --------------------------------------------------------------------- */
/*  Phase 37b — lab admins read their own staff's sign-in log            */
/*                                                                       */
/*  Scoped strictly to users whose profile belongs to the admin's lab —  */
/*  clinics and other labs stay super-admin-only.                        */
/* --------------------------------------------------------------------- */

create or replace function same_lab_user(target uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select my_lab_id() is not null and exists (
    select 1 from profiles p where p.id = target and p.lab_id = my_lab_id()
  );
$$;

drop policy if exists "login_events_select_lab_admin" on login_events;
create policy "login_events_select_lab_admin" on login_events for select
  using (is_lab_admin() and same_lab_user(user_id));

/* --------------------------------------------------------------------- */
/*  Phase 38 — sign-in log grows into a full activity log                */
/*  What each user DID: viewed a case, downloaded a PDF, exported a CSV, */
/*  recorded a payment, added an expense, submitted a prescription, ...  */
/* --------------------------------------------------------------------- */

alter table login_events add column if not exists action text not null default 'sign-in';
alter table login_events add column if not exists detail text not null default '';

/* --------------------------------------------------------------------- */
/*  Phase 39 — payment reminders start 25 September 2026                 */
/*                                                                       */
/*  The platform wasn't ready for the first firing (25 Aug 2026 — price  */
/*  lists still being rebuilt after Phase 34), so the monthly reminder   */
/*  run is a no-op before this date. The cron job still fires on the     */
/*  25th; the guard simply returns early. Nothing to undo later — from   */
/*  25 Sep 2026 onward the guard always passes.                          */
/* --------------------------------------------------------------------- */

create or replace function private.run_payment_reminders()
returns void
security definer
set search_path = public, private
as $$
declare
  secret text;
begin
  -- Skip firings before the go-live date (see Phase 39 header).
  if current_date < date '2026-09-25' then
    return;
  end if;
  select value into secret from private.webhook_config where key = 'case_notify_secret';
  perform net.http_post(
    url := 'https://mtxkushcxczjwypwoxdh.supabase.co/functions/v1/payment-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', coalesce(secret, '')
    ),
    body := jsonb_build_object('source', 'pg_cron'),
    -- Give the function time to email every clinic before pg_net hangs up.
    timeout_milliseconds := 30000
  );
end;
$$ language plpgsql;

/* --------------------------------------------------------------------- */
/*  Phase 40 — profiles.role privilege guard (security audit fix)        */
/*                                                                       */
/*  CRITICAL fix: profiles_insert_own / profiles_update_own gate only on */
/*  id = auth.uid(); neither constrained the role column, and no trigger */
/*  guarded it. Any authenticated user could set their own role='admin'  */
/*  (is_admin() -> true), gaining cross-tenant read of every clinic/case */
/*  /profile plus the full admin-actions surface (list users, delete any */
/*  account/org/case, impersonate anyone). The app never writes role     */
/*  after onboarding (updateProfile touches name/phone/avatar only), so  */
/*  freezing it for app writers breaks nothing.                          */
/*                                                                       */
/*  Self-signup may only create dentist|lab; nobody may change role      */
/*  through the app. Real admins are minted only via service_role, e.g.  */
/*  in the SQL editor:                                                   */
/*    begin; set local role service_role;                               */
/*    update profiles set role='admin' where id='<uuid>'; commit;       */
/* --------------------------------------------------------------------- */

create or replace function guard_profile_privilege()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Trusted backend writes bypass (service_role: SQL editor / admin-actions).
  if current_setting('role', true) = 'service_role' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.role not in ('dentist', 'lab') then
      raise exception 'self-signup role must be dentist or lab';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.role is distinct from old.role then
      raise exception 'role cannot be changed through the app';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_privilege on profiles;
create trigger profiles_guard_privilege
  before insert or update on profiles
  for each row execute function guard_profile_privilege();

/* --------------------------------------------------------------------- */
/*  Phase 41 — follow-up / iterative rounds + returned-work remakes       */
/*                                                                       */
/*  A parent case can gather many follow-up ROUNDS: an extra clinical     */
/*  visit/stage of a multi-visit case (denture try-in sequence, RPD,      */
/*  full-arch implant), or a post-delivery return (remake / adjustment /  */
/*  refit) on already-completed work. The parent case row is NEVER        */
/*  mutated — its clinical + financial record stays intact and immutable  */
/*  — each round is its own open->resolved unit of work with its own      */
/*  instructions, attachments (troubleshooting photos / STL) and pickup.  */
/*                                                                       */
/*  Rounds are FREE (no charge to the clinic, no statement/pricing        */
/*  touch). The lab's private cost estimate + fault classification live   */
/*  in a SEPARATE, finance-only table (41c) so lab technicians never see  */
/*  them — row-level RLS can hide a whole table from techs, but not a     */
/*  single column of case_rounds, which every lab member can read.        */
/* --------------------------------------------------------------------- */

-- 41a. Logs identify the actual person, not the generic "Lab Tech" display-
-- name placeholder some accounts carry from onboarding. Email is the stable
-- fallback identity shown in every staff/activity log view.
alter table login_events add column if not exists email text not null default '';

-- 41b. The shared follow-up round (visible to both parties of the parent case).
create table if not exists case_rounds (
  id uuid primary key default gen_random_uuid(),
  parent_case_id text not null references cases(id) on delete cascade,
  kind text not null check (kind in ('stage', 'remake', 'adjustment', 'refit')),
  instructions text not null default '',
  attachments jsonb not null default '[]'::jsonb,   -- [{name,size,url,kind:'photo'|'scan'}]
  pickup_requested boolean not null default false,
  status text not null check (status in ('open', 'resolved')) default 'open',
  created_by uuid default auth.uid(),
  created_by_role text not null check (created_by_role in ('dentist', 'lab')),
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);
create index if not exists case_rounds_parent_idx on case_rounds (parent_case_id);
alter table case_rounds enable row level security;

-- Same tenant rule as case_notes, multi-clinic aware (Phase 13/15): either
-- party of the PARENT case. A dentist may only attach a round to a case their
-- clinic owns; a lab only to a case assigned to it. Clinic/lab identity comes
-- from the caller's JWT via the security-definer helpers, never the client.
drop policy if exists "case_rounds_select" on case_rounds;
create policy "case_rounds_select" on case_rounds for select
  using (exists (
    select 1 from cases c where c.id = case_rounds.parent_case_id
      and (c.clinic_id = my_clinic_id() or c.clinic_id in (select my_owned_clinic_ids()) or c.lab_id = my_lab_id())
  ));

drop policy if exists "case_rounds_insert" on case_rounds;
create policy "case_rounds_insert" on case_rounds for insert
  with check (exists (
    select 1 from cases c where c.id = case_rounds.parent_case_id
      and (c.clinic_id = my_clinic_id() or c.clinic_id in (select my_owned_clinic_ids()) or c.lab_id = my_lab_id())
  ));

drop policy if exists "case_rounds_update" on case_rounds;
create policy "case_rounds_update" on case_rounds for update
  using (exists (
    select 1 from cases c where c.id = case_rounds.parent_case_id
      and (c.clinic_id = my_clinic_id() or c.clinic_id in (select my_owned_clinic_ids()) or c.lab_id = my_lab_id())
  ));

-- Server-side hardening: clip instruction length even if a client bypasses the
-- app, and freeze parentage/author on update so a round can never be re-parented
-- onto another tenant's case (which would smuggle attachments across clinics).
create or replace function guard_case_round()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('role', true) = 'service_role' then
    return new;
  end if;
  new.instructions := left(coalesce(new.instructions, ''), 4000);
  if tg_op = 'UPDATE' then
    if new.parent_case_id is distinct from old.parent_case_id
       or new.created_by is distinct from old.created_by
       or new.created_by_role is distinct from old.created_by_role
       or new.created_at is distinct from old.created_at then
      raise exception 'a follow-up round''s parent case and author are immutable';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists case_rounds_guard on case_rounds;
create trigger case_rounds_guard
  before insert or update on case_rounds
  for each row execute function guard_case_round();

-- 41c. LAB-INTERNAL cost estimate + fault. NEVER visible to the clinic, and
-- NEVER to lab technicians — only finance roles (admin + accountant), gated by
-- the same is_lab_finance() that guards every money table in this schema. No
-- money moves: cost_estimate is an internal estimate, not a charge. Kept in its
-- own table precisely so techs (who read case_rounds) can't see these fields.
create table if not exists case_round_costs (
  round_id uuid primary key references case_rounds(id) on delete cascade,
  lab_id uuid not null references labs(id) on delete cascade,
  fault text not null check (fault in ('lab', 'clinic', 'shared', 'unclassified')) default 'unclassified',
  cost_estimate numeric(12, 3),
  note text not null default '',
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table case_round_costs enable row level security;

-- Finance-only (admin or accountant) of the OWNING lab, and the labelled lab_id
-- must actually match the round's parent-case lab (no mislabelling another lab's
-- round as your own). Techs are excluded by construction: is_lab_finance() is
-- false for them, so they get zero rows and never learn a cost exists.
drop policy if exists "round_costs_select" on case_round_costs;
create policy "round_costs_select" on case_round_costs for select
  using (lab_id = my_lab_id() and is_lab_finance());

drop policy if exists "round_costs_insert" on case_round_costs;
create policy "round_costs_insert" on case_round_costs for insert
  with check (
    lab_id = my_lab_id() and is_lab_finance()
    and exists (
      select 1 from case_rounds r join cases c on c.id = r.parent_case_id
      where r.id = round_id and c.lab_id = case_round_costs.lab_id
    )
  );

drop policy if exists "round_costs_update" on case_round_costs;
create policy "round_costs_update" on case_round_costs for update
  using (lab_id = my_lab_id() and is_lab_finance())
  with check (lab_id = my_lab_id() and is_lab_finance());

drop policy if exists "round_costs_delete" on case_round_costs;
create policy "round_costs_delete" on case_round_costs for delete
  using (lab_id = my_lab_id() and is_lab_finance());

-- Live sync: both parties see new rounds / status flips without a refresh, and
-- the finance Remakes tab sees cost/fault edits live. Guarded add (no IF NOT
-- EXISTS form for alter publication — an unguarded re-run rolls back the file).
do $$
begin
  if not exists (select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'case_rounds') then
    alter publication supabase_realtime add table case_rounds;
  end if;
  if not exists (select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'case_round_costs') then
    alter publication supabase_realtime add table case_round_costs;
  end if;
end $$;

/* --------------------------------------------------------------------- */
/*  Phase 42 — atomic stage merge (offline write queue conflict rule)     */
/*                                                                       */
/*  A technician on a bad/absent connection taps "mark stage complete";  */
/*  the change is queued locally and replayed when the signal returns.   */
/*  Replaying a plain "set stage = N" would clobber whatever happened     */
/*  meanwhile (someone else advanced it, a duplicate replay, ...). So a   */
/*  stage change is a MONOTONIC, IDEMPOTENT intent: "this case has        */
/*  reached at least stage N". This function applies that atomically —    */
/*  it locks the row, and only moves the stage if it isn't already at or  */
/*  past the target in the intended direction; otherwise it's a no-op     */
/*  success. Concurrent advances, duplicate replays, and stale queued     */
/*  taps all resolve safely without double-counting or clobbering.        */
/*                                                                       */
/*  SECURITY INVOKER (the default): the UPDATE runs under the caller's    */
/*  RLS, so a tech can only move a case their lab is allowed to write     */
/*  (cases_update: lab_id = my_lab_id() and lab_write_allowed()). The     */
/*  online path uses it too, so concurrent on-network advances are also   */
/*  race-free. The client falls back to a plain update if this function   */
/*  isn't present yet, so app-before-SQL deploy order stays safe.         */
/* --------------------------------------------------------------------- */

create or replace function case_apply_stage(
  p_id text, p_target integer, p_entry jsonb, p_direction text, p_clear_handover boolean default false
)
returns setof cases
language plpgsql
set search_path = public
as $$
declare
  cur integer;
begin
  -- Lock the row so concurrent applies serialize (the merge is read-modify-write).
  select stage_index into cur from cases where id = p_id for update;
  if cur is null then
    return; -- no such case, or not visible to this caller -> empty result
  end if;
  -- Intent already satisfied (already at/past the target the intended way): no-op.
  if (p_direction = 'advance' and cur >= p_target) or (p_direction = 'revert' and cur <= p_target) then
    return query select * from cases where id = p_id;
    return;
  end if;
  return query
    update cases
      set stage_index = p_target,
          history = coalesce(history, '[]'::jsonb) || coalesce(p_entry, '[]'::jsonb),
          -- Reverting out of the final stage discards the handover record.
          handover = case when p_clear_handover then null else handover end
      where id = p_id
      returning *;
end;
$$;

/* --------------------------------------------------------------------- */
/*  Phase 44 — denture pricing: fixed base + per-tooth fee                */
/*                                                                       */
/*  Real-world denture pricing (user, 2026-08-21): a Removable denture   */
/*  has a fixed base price for the appliance PLUS a fee for each tooth   */
/*  marked on the chart. A full denture with no teeth marked = base      */
/*  only. Splints and every other category keep their flat price; tooth- */
/*  borne work keeps price x teeth. The fee lives on the price list item */
/*  (per_tooth_fee, nullable — empty means the old flat behavior), so    */
/*  each list/clinic can have its own base + fee. Both price_case() and  */
/*  estimate_case_price() are re-emitted with the same line-item logic.  */
/* --------------------------------------------------------------------- */

alter table price_schedule_items add column if not exists per_tooth_fee numeric(12, 3);

create or replace function price_case()
returns trigger
security definer
set search_path = public
as $$
declare
  sched uuid;
  disc numeric := 0;
  base numeric := 0;
  priced boolean := false;
  r record;
  p numeric;
  ptf numeric;
  adj jsonb := '[]'::jsonb;
  credit numeric := 0;
begin
  if tg_op = 'UPDATE' and old.invoice_status in ('issued', 'paid') then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.price_overridden then
    return new;
  end if;
  if new.lab_id is null then
    return new;
  end if;

  select cpr.price_schedule_id, coalesce(cpr.discount_pct, 0)
    into sched, disc
    from clinic_price_rules cpr
   where cpr.lab_id = new.lab_id and cpr.clinic_id = new.clinic_id;
  if sched is null then
    select ps.id into sched from price_schedules ps
     where ps.lab_id = new.lab_id and ps.is_default
     limit 1;
  end if;
  if sched is null then
    return new;
  end if;

  for r in
    select x->>'category' as category,
           coalesce(jsonb_array_length(x->'teeth'), 0) as teeth,
           case
             when x->>'category' in ('Removable denture', 'Michigan splint', 'Orthodontics splint',
                                     'Single layer splint - soft', 'Double layer splint - soft',
                                     'Double layer splint - outer hard, inner soft', 'Others - refer to notes')
               then 1
             else greatest(coalesce(jsonb_array_length(x->'teeth'), 0), 1)
           end as units
      from jsonb_array_elements(
             coalesce(new.prescription->'restorations',
                      jsonb_build_array(new.prescription))) as x
  loop
    select psi.base_price, psi.per_tooth_fee into p, ptf
      from price_schedule_items psi
     where psi.schedule_id = sched and psi.category = r.category;
    if p is not null then
      -- Denture with a per-tooth fee configured: base + fee x marked teeth
      -- (0 teeth = full denture = base only). Everything else as before.
      if r.category = 'Removable denture' and ptf is not null then
        base := base + p + ptf * r.teeth;
      else
        base := base + p * r.units;
      end if;
      priced := true;
    end if;
  end loop;

  if not priced then
    return new;
  end if;

  if disc <> 0 then
    adj := adj || jsonb_build_array(jsonb_build_object(
      'label', 'Clinic rate ' || (case when disc > 0 then '−' else '+' end) || abs(disc)::text || '%',
      'amount', round(-(base * disc / 100.0), 3)));
  end if;
  if new.remake is not null and coalesce((new.remake->>'cost')::numeric, 0) > 0 then
    credit := (new.remake->>'cost')::numeric;
    adj := adj || jsonb_build_array(jsonb_build_object('label', 'Remake credit', 'amount', -credit));
  end if;

  new.base_fee := round(base, 3);
  new.adjustments := adj;
  new.total_price := greatest(0, round(base - (base * disc / 100.0) - credit, 3));
  return new;
exception when others then
  return new;
end;
$$ language plpgsql;

create or replace function estimate_case_price(p_lab uuid, p_clinic uuid, p_prescription jsonb)
returns numeric
language plpgsql security definer stable
set search_path = public
as $$
declare
  sched uuid;
  disc numeric := 0;
  base numeric := 0;
  priced boolean := false;
  r record;
  p numeric;
  ptf numeric;
begin
  if p_lab is null or p_clinic is null or p_prescription is null then
    return null;
  end if;
  if not (p_clinic in (select my_owned_clinic_ids()) or p_clinic = my_clinic_id()) then
    return null;
  end if;

  select cpr.price_schedule_id, coalesce(cpr.discount_pct, 0)
    into sched, disc
    from clinic_price_rules cpr
   where cpr.lab_id = p_lab and cpr.clinic_id = p_clinic;
  if sched is null then
    select ps.id into sched from price_schedules ps
     where ps.lab_id = p_lab and ps.is_default
     limit 1;
  end if;
  if sched is null then
    return null;
  end if;

  for r in
    select x->>'category' as category,
           coalesce(jsonb_array_length(x->'teeth'), 0) as teeth,
           case
             when x->>'category' in ('Removable denture', 'Michigan splint', 'Orthodontics splint',
                                     'Single layer splint - soft', 'Double layer splint - soft',
                                     'Double layer splint - outer hard, inner soft', 'Others - refer to notes')
               then 1
             else greatest(coalesce(jsonb_array_length(x->'teeth'), 0), 1)
           end as units
      from jsonb_array_elements(
             coalesce(p_prescription->'restorations',
                      jsonb_build_array(p_prescription))) as x
  loop
    select psi.base_price, psi.per_tooth_fee into p, ptf
      from price_schedule_items psi
     where psi.schedule_id = sched and psi.category = r.category;
    if p is not null then
      if r.category = 'Removable denture' and ptf is not null then
        base := base + p + ptf * r.teeth;
      else
        base := base + p * r.units;
      end if;
      priced := true;
    end if;
  end loop;

  if not priced then
    return null;
  end if;
  return greatest(0, round(base - (base * disc / 100.0), 3));
exception when others then
  return null;
end;
$$;

/* --------------------------------------------------------------------- */
/*  Phase 45 — arch-based appliances: single-arch vs both-arches price    */
/*                                                                       */
/*  Five new Rx categories (Clear retainer, Night guard, Fixed retainer, */
/*  Study model, Special tray) plus Removable denture are made PER ARCH: */
/*  the dentist picks Upper / Lower / Both in the Rx form (stored as     */
/*  prescription.arches) and the price list holds two prices —          */
/*  base_price = one arch, price_both_arches = both. A null both-price   */
/*  means one price regardless of arch (the old behavior, so nothing     */
/*  changes until the lab fills the new column). The denture combines    */
/*  this with Phase 44: arch base + per-tooth fee x marked teeth.        */
/* --------------------------------------------------------------------- */

alter table price_schedule_items add column if not exists price_both_arches numeric(12, 3);

create or replace function price_case()
returns trigger
security definer
set search_path = public
as $$
declare
  sched uuid;
  disc numeric := 0;
  base numeric := 0;
  priced boolean := false;
  r record;
  p numeric;
  ptf numeric;
  pba numeric;
  line_base numeric;
  adj jsonb := '[]'::jsonb;
  credit numeric := 0;
begin
  if tg_op = 'UPDATE' and old.invoice_status in ('issued', 'paid') then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.price_overridden then
    return new;
  end if;
  if new.lab_id is null then
    return new;
  end if;

  select cpr.price_schedule_id, coalesce(cpr.discount_pct, 0)
    into sched, disc
    from clinic_price_rules cpr
   where cpr.lab_id = new.lab_id and cpr.clinic_id = new.clinic_id;
  if sched is null then
    select ps.id into sched from price_schedules ps
     where ps.lab_id = new.lab_id and ps.is_default
     limit 1;
  end if;
  if sched is null then
    return new;
  end if;

  for r in
    select x->>'category' as category,
           x->>'arches' as arches,
           coalesce(jsonb_array_length(x->'teeth'), 0) as teeth,
           case
             when x->>'category' in ('Removable denture', 'Michigan splint', 'Orthodontics splint',
                                     'Single layer splint - soft', 'Double layer splint - soft',
                                     'Double layer splint - outer hard, inner soft',
                                     'Clear retainer', 'Night guard', 'Fixed retainer',
                                     'Study model', 'Special tray', 'Others - refer to notes')
               then 1
             else greatest(coalesce(jsonb_array_length(x->'teeth'), 0), 1)
           end as units
      from jsonb_array_elements(
             coalesce(new.prescription->'restorations',
                      jsonb_build_array(new.prescription))) as x
  loop
    select psi.base_price, psi.per_tooth_fee, psi.price_both_arches into p, ptf, pba
      from price_schedule_items psi
     where psi.schedule_id = sched and psi.category = r.category;
    if p is not null then
      -- Arch appliances: both-arches price when chosen and configured,
      -- else the single-arch base (also the pre-Phase-45 behavior).
      if r.category in ('Removable denture', 'Clear retainer', 'Night guard',
                        'Fixed retainer', 'Study model', 'Special tray')
         and r.arches = 'both' and pba is not null then
        line_base := pba;
      else
        line_base := p;
      end if;
      if r.category = 'Removable denture' and ptf is not null then
        base := base + line_base + ptf * r.teeth;
      else
        base := base + line_base * r.units;
      end if;
      priced := true;
    end if;
  end loop;

  if not priced then
    return new;
  end if;

  if disc <> 0 then
    adj := adj || jsonb_build_array(jsonb_build_object(
      'label', 'Clinic rate ' || (case when disc > 0 then '−' else '+' end) || abs(disc)::text || '%',
      'amount', round(-(base * disc / 100.0), 3)));
  end if;
  if new.remake is not null and coalesce((new.remake->>'cost')::numeric, 0) > 0 then
    credit := (new.remake->>'cost')::numeric;
    adj := adj || jsonb_build_array(jsonb_build_object('label', 'Remake credit', 'amount', -credit));
  end if;

  new.base_fee := round(base, 3);
  new.adjustments := adj;
  new.total_price := greatest(0, round(base - (base * disc / 100.0) - credit, 3));
  return new;
exception when others then
  return new;
end;
$$ language plpgsql;

create or replace function estimate_case_price(p_lab uuid, p_clinic uuid, p_prescription jsonb)
returns numeric
language plpgsql security definer stable
set search_path = public
as $$
declare
  sched uuid;
  disc numeric := 0;
  base numeric := 0;
  priced boolean := false;
  r record;
  p numeric;
  ptf numeric;
  pba numeric;
  line_base numeric;
begin
  if p_lab is null or p_clinic is null or p_prescription is null then
    return null;
  end if;
  if not (p_clinic in (select my_owned_clinic_ids()) or p_clinic = my_clinic_id()) then
    return null;
  end if;

  select cpr.price_schedule_id, coalesce(cpr.discount_pct, 0)
    into sched, disc
    from clinic_price_rules cpr
   where cpr.lab_id = p_lab and cpr.clinic_id = p_clinic;
  if sched is null then
    select ps.id into sched from price_schedules ps
     where ps.lab_id = p_lab and ps.is_default
     limit 1;
  end if;
  if sched is null then
    return null;
  end if;

  for r in
    select x->>'category' as category,
           x->>'arches' as arches,
           coalesce(jsonb_array_length(x->'teeth'), 0) as teeth,
           case
             when x->>'category' in ('Removable denture', 'Michigan splint', 'Orthodontics splint',
                                     'Single layer splint - soft', 'Double layer splint - soft',
                                     'Double layer splint - outer hard, inner soft',
                                     'Clear retainer', 'Night guard', 'Fixed retainer',
                                     'Study model', 'Special tray', 'Others - refer to notes')
               then 1
             else greatest(coalesce(jsonb_array_length(x->'teeth'), 0), 1)
           end as units
      from jsonb_array_elements(
             coalesce(p_prescription->'restorations',
                      jsonb_build_array(p_prescription))) as x
  loop
    select psi.base_price, psi.per_tooth_fee, psi.price_both_arches into p, ptf, pba
      from price_schedule_items psi
     where psi.schedule_id = sched and psi.category = r.category;
    if p is not null then
      if r.category in ('Removable denture', 'Clear retainer', 'Night guard',
                        'Fixed retainer', 'Study model', 'Special tray')
         and r.arches = 'both' and pba is not null then
        line_base := pba;
      else
        line_base := p;
      end if;
      if r.category = 'Removable denture' and ptf is not null then
        base := base + line_base + ptf * r.teeth;
      else
        base := base + line_base * r.units;
      end if;
      priced := true;
    end if;
  end loop;

  if not priced then
    return null;
  end if;
  return greatest(0, round(base - (base * disc / 100.0), 3));
exception when others then
  return null;
end;
$$;

/* --------------------------------------------------------------------- */
/*  Phase 46 — accountant window: strict rolling 2 months                 */
/*                                                                       */
/*  The original cutoff was month-start minus 2 months, which on the     */
/*  21st exposes almost 3 months of history. User rule (2026-08-21):     */
/*  the accountant sees the PAST 2 MONTHS only — anything older is       */
/*  hidden UNLESS it is still unpaid/partial (the existing exception in  */
/*  the statement policy, kept so collections work never disappears).    */
/*  Every accountant policy (statements / payments / expenses) calls     */
/*  this function, so re-emitting it fixes all three at once.            */
/* --------------------------------------------------------------------- */

create or replace function accountant_cutoff()
returns date
language sql stable
as $$
  select (now() - interval '2 months')::date;
$$;

/* --------------------------------------------------------------------- */
/*  Phase 47 — partial vs complete dentures + first-tooth-included fee    */
/*                                                                       */
/*  User's real tariff (2026-08-22): a removable PARTIAL denture starts  */
/*  at the base price FOR ONE TOOTH, plus the fee for each ADDITIONAL    */
/*  tooth (15 + 2 x (teeth-1): 1 tooth = 15, 6 teeth = 25) — the Phase   */
/*  44 form charged the fee for every tooth. COMPLETE dentures are a     */
/*  different product priced per arch, so they become their own Rx       */
/*  category ('Complete denture', no teeth marked, single/both arch      */
/*  prices like the other arch appliances). Both functions re-emitted.   */
/* --------------------------------------------------------------------- */

create or replace function price_case()
returns trigger
security definer
set search_path = public
as $$
declare
  sched uuid;
  disc numeric := 0;
  base numeric := 0;
  priced boolean := false;
  r record;
  p numeric;
  ptf numeric;
  pba numeric;
  line_base numeric;
  adj jsonb := '[]'::jsonb;
  credit numeric := 0;
begin
  if tg_op = 'UPDATE' and old.invoice_status in ('issued', 'paid') then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.price_overridden then
    return new;
  end if;
  if new.lab_id is null then
    return new;
  end if;

  select cpr.price_schedule_id, coalesce(cpr.discount_pct, 0)
    into sched, disc
    from clinic_price_rules cpr
   where cpr.lab_id = new.lab_id and cpr.clinic_id = new.clinic_id;
  if sched is null then
    select ps.id into sched from price_schedules ps
     where ps.lab_id = new.lab_id and ps.is_default
     limit 1;
  end if;
  if sched is null then
    return new;
  end if;

  for r in
    select x->>'category' as category,
           x->>'arches' as arches,
           coalesce(jsonb_array_length(x->'teeth'), 0) as teeth,
           case
             when x->>'category' in ('Removable denture', 'Michigan splint', 'Orthodontics splint',
                                     'Single layer splint - soft', 'Double layer splint - soft',
                                     'Double layer splint - outer hard, inner soft',
                                     'Clear retainer', 'Night guard', 'Fixed retainer',
                                     'Study model', 'Special tray', 'Complete denture', 'Others - refer to notes')
               then 1
             else greatest(coalesce(jsonb_array_length(x->'teeth'), 0), 1)
           end as units
      from jsonb_array_elements(
             coalesce(new.prescription->'restorations',
                      jsonb_build_array(new.prescription))) as x
  loop
    select psi.base_price, psi.per_tooth_fee, psi.price_both_arches into p, ptf, pba
      from price_schedule_items psi
     where psi.schedule_id = sched and psi.category = r.category;
    if p is not null then
      -- Arch appliances: both-arches price when chosen and configured,
      -- else the single-arch base (also the pre-Phase-45 behavior).
      if r.category in ('Removable denture', 'Complete denture', 'Clear retainer', 'Night guard',
                        'Fixed retainer', 'Study model', 'Special tray')
         and r.arches = 'both' and pba is not null then
        line_base := pba;
      else
        line_base := p;
      end if;
      if r.category = 'Removable denture' and ptf is not null then
        -- first tooth is included in the base; only extras add the fee
        base := base + line_base + ptf * greatest(r.teeth - 1, 0);
      else
        base := base + line_base * r.units;
      end if;
      priced := true;
    end if;
  end loop;

  if not priced then
    return new;
  end if;

  if disc <> 0 then
    adj := adj || jsonb_build_array(jsonb_build_object(
      'label', 'Clinic rate ' || (case when disc > 0 then '−' else '+' end) || abs(disc)::text || '%',
      'amount', round(-(base * disc / 100.0), 3)));
  end if;
  if new.remake is not null and coalesce((new.remake->>'cost')::numeric, 0) > 0 then
    credit := (new.remake->>'cost')::numeric;
    adj := adj || jsonb_build_array(jsonb_build_object('label', 'Remake credit', 'amount', -credit));
  end if;

  new.base_fee := round(base, 3);
  new.adjustments := adj;
  new.total_price := greatest(0, round(base - (base * disc / 100.0) - credit, 3));
  return new;
exception when others then
  return new;
end;
$$ language plpgsql;

create or replace function estimate_case_price(p_lab uuid, p_clinic uuid, p_prescription jsonb)
returns numeric
language plpgsql security definer stable
set search_path = public
as $$
declare
  sched uuid;
  disc numeric := 0;
  base numeric := 0;
  priced boolean := false;
  r record;
  p numeric;
  ptf numeric;
  pba numeric;
  line_base numeric;
begin
  if p_lab is null or p_clinic is null or p_prescription is null then
    return null;
  end if;
  if not (p_clinic in (select my_owned_clinic_ids()) or p_clinic = my_clinic_id()) then
    return null;
  end if;

  select cpr.price_schedule_id, coalesce(cpr.discount_pct, 0)
    into sched, disc
    from clinic_price_rules cpr
   where cpr.lab_id = p_lab and cpr.clinic_id = p_clinic;
  if sched is null then
    select ps.id into sched from price_schedules ps
     where ps.lab_id = p_lab and ps.is_default
     limit 1;
  end if;
  if sched is null then
    return null;
  end if;

  for r in
    select x->>'category' as category,
           x->>'arches' as arches,
           coalesce(jsonb_array_length(x->'teeth'), 0) as teeth,
           case
             when x->>'category' in ('Removable denture', 'Michigan splint', 'Orthodontics splint',
                                     'Single layer splint - soft', 'Double layer splint - soft',
                                     'Double layer splint - outer hard, inner soft',
                                     'Clear retainer', 'Night guard', 'Fixed retainer',
                                     'Study model', 'Special tray', 'Complete denture', 'Others - refer to notes')
               then 1
             else greatest(coalesce(jsonb_array_length(x->'teeth'), 0), 1)
           end as units
      from jsonb_array_elements(
             coalesce(p_prescription->'restorations',
                      jsonb_build_array(p_prescription))) as x
  loop
    select psi.base_price, psi.per_tooth_fee, psi.price_both_arches into p, ptf, pba
      from price_schedule_items psi
     where psi.schedule_id = sched and psi.category = r.category;
    if p is not null then
      if r.category in ('Removable denture', 'Complete denture', 'Clear retainer', 'Night guard',
                        'Fixed retainer', 'Study model', 'Special tray')
         and r.arches = 'both' and pba is not null then
        line_base := pba;
      else
        line_base := p;
      end if;
      if r.category = 'Removable denture' and ptf is not null then
        -- first tooth is included in the base; only extras add the fee
        base := base + line_base + ptf * greatest(r.teeth - 1, 0);
      else
        base := base + line_base * r.units;
      end if;
      priced := true;
    end if;
  end loop;

  if not priced then
    return null;
  end if;
  return greatest(0, round(base - (base * disc / 100.0), 3));
exception when others then
  return null;
end;
$$;

/* --------------------------------------------------------------------- */
/*  Phase 48 — rename category 'Removable denture' ->                     */
/*  'Removable partial denture' (user request 2026-08-22)                 */
/*                                                                       */
/*  The category string is a JOIN KEY (Rx form <-> price list items <->  */
/*  pricing trigger <-> TAT settings <-> commission rates), so the       */
/*  rename is a coordinated code change + this data migration + a        */
/*  re-emit of both pricing functions with the new name. All idempotent. */
/* --------------------------------------------------------------------- */

-- Migrations run as service_role: the cases UPDATE must bypass the
-- prescription guard trigger (a plain editor-role write would be silently
-- reverted by its lab-writer branch). reset role afterwards so any later
-- statements in a full-file run are unaffected.
set local role service_role;

-- 1. Price list rows. If a schedule somehow holds BOTH the canonical row
--    and a hand-typed 'Removable partial denture' reference row, drop the
--    hand-typed one first so the rename can't hit the unique constraint.
delete from price_schedule_items t
  where t.category = 'Removable partial denture'
    and exists (select 1 from price_schedule_items s
                 where s.schedule_id = t.schedule_id and s.category = 'Removable denture');
update price_schedule_items set category = 'Removable partial denture'
  where category = 'Removable denture';

-- 2. Historical cases (flat appliance shape; cart mode never holds dentures).
update cases
  set prescription = jsonb_set(prescription, '{category}', '"Removable partial denture"')
  where prescription->>'category' = 'Removable denture';

-- 3. Per-procedure turnaround times (labs.procedure_tats jsonb keyed by name).
update labs
  set procedure_tats = (procedure_tats - 'Removable denture')
        || jsonb_build_object('Removable partial denture', procedure_tats->'Removable denture')
  where procedure_tats ? 'Removable denture';

-- 4. Technician commission rates (rates jsonb keyed by category name).
update tech_commission_rates
  set rates = (rates - 'Removable denture')
        || jsonb_build_object('Removable partial denture', rates->'Removable denture')
  where rates ? 'Removable denture';

reset role;

-- 5. Pricing functions re-emitted with the new category name.

create or replace function price_case()
returns trigger
security definer
set search_path = public
as $$
declare
  sched uuid;
  disc numeric := 0;
  base numeric := 0;
  priced boolean := false;
  r record;
  p numeric;
  ptf numeric;
  pba numeric;
  line_base numeric;
  adj jsonb := '[]'::jsonb;
  credit numeric := 0;
begin
  if tg_op = 'UPDATE' and old.invoice_status in ('issued', 'paid') then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.price_overridden then
    return new;
  end if;
  if new.lab_id is null then
    return new;
  end if;

  select cpr.price_schedule_id, coalesce(cpr.discount_pct, 0)
    into sched, disc
    from clinic_price_rules cpr
   where cpr.lab_id = new.lab_id and cpr.clinic_id = new.clinic_id;
  if sched is null then
    select ps.id into sched from price_schedules ps
     where ps.lab_id = new.lab_id and ps.is_default
     limit 1;
  end if;
  if sched is null then
    return new;
  end if;

  for r in
    select x->>'category' as category,
           x->>'arches' as arches,
           coalesce(jsonb_array_length(x->'teeth'), 0) as teeth,
           case
             when x->>'category' in ('Removable partial denture', 'Michigan splint', 'Orthodontics splint',
                                     'Single layer splint - soft', 'Double layer splint - soft',
                                     'Double layer splint - outer hard, inner soft',
                                     'Clear retainer', 'Night guard', 'Fixed retainer',
                                     'Study model', 'Special tray', 'Complete denture', 'Others - refer to notes')
               then 1
             else greatest(coalesce(jsonb_array_length(x->'teeth'), 0), 1)
           end as units
      from jsonb_array_elements(
             coalesce(new.prescription->'restorations',
                      jsonb_build_array(new.prescription))) as x
  loop
    select psi.base_price, psi.per_tooth_fee, psi.price_both_arches into p, ptf, pba
      from price_schedule_items psi
     where psi.schedule_id = sched and psi.category = r.category;
    if p is not null then
      -- Arch appliances: both-arches price when chosen and configured,
      -- else the single-arch base (also the pre-Phase-45 behavior).
      if r.category in ('Removable partial denture', 'Complete denture', 'Clear retainer', 'Night guard',
                        'Fixed retainer', 'Study model', 'Special tray')
         and r.arches = 'both' and pba is not null then
        line_base := pba;
      else
        line_base := p;
      end if;
      if r.category = 'Removable partial denture' and ptf is not null then
        -- first tooth is included in the base; only extras add the fee
        base := base + line_base + ptf * greatest(r.teeth - 1, 0);
      else
        base := base + line_base * r.units;
      end if;
      priced := true;
    end if;
  end loop;

  if not priced then
    return new;
  end if;

  if disc <> 0 then
    adj := adj || jsonb_build_array(jsonb_build_object(
      'label', 'Clinic rate ' || (case when disc > 0 then '−' else '+' end) || abs(disc)::text || '%',
      'amount', round(-(base * disc / 100.0), 3)));
  end if;
  if new.remake is not null and coalesce((new.remake->>'cost')::numeric, 0) > 0 then
    credit := (new.remake->>'cost')::numeric;
    adj := adj || jsonb_build_array(jsonb_build_object('label', 'Remake credit', 'amount', -credit));
  end if;

  new.base_fee := round(base, 3);
  new.adjustments := adj;
  new.total_price := greatest(0, round(base - (base * disc / 100.0) - credit, 3));
  return new;
exception when others then
  return new;
end;
$$ language plpgsql;

create or replace function estimate_case_price(p_lab uuid, p_clinic uuid, p_prescription jsonb)
returns numeric
language plpgsql security definer stable
set search_path = public
as $$
declare
  sched uuid;
  disc numeric := 0;
  base numeric := 0;
  priced boolean := false;
  r record;
  p numeric;
  ptf numeric;
  pba numeric;
  line_base numeric;
begin
  if p_lab is null or p_clinic is null or p_prescription is null then
    return null;
  end if;
  if not (p_clinic in (select my_owned_clinic_ids()) or p_clinic = my_clinic_id()) then
    return null;
  end if;

  select cpr.price_schedule_id, coalesce(cpr.discount_pct, 0)
    into sched, disc
    from clinic_price_rules cpr
   where cpr.lab_id = p_lab and cpr.clinic_id = p_clinic;
  if sched is null then
    select ps.id into sched from price_schedules ps
     where ps.lab_id = p_lab and ps.is_default
     limit 1;
  end if;
  if sched is null then
    return null;
  end if;

  for r in
    select x->>'category' as category,
           x->>'arches' as arches,
           coalesce(jsonb_array_length(x->'teeth'), 0) as teeth,
           case
             when x->>'category' in ('Removable partial denture', 'Michigan splint', 'Orthodontics splint',
                                     'Single layer splint - soft', 'Double layer splint - soft',
                                     'Double layer splint - outer hard, inner soft',
                                     'Clear retainer', 'Night guard', 'Fixed retainer',
                                     'Study model', 'Special tray', 'Complete denture', 'Others - refer to notes')
               then 1
             else greatest(coalesce(jsonb_array_length(x->'teeth'), 0), 1)
           end as units
      from jsonb_array_elements(
             coalesce(p_prescription->'restorations',
                      jsonb_build_array(p_prescription))) as x
  loop
    select psi.base_price, psi.per_tooth_fee, psi.price_both_arches into p, ptf, pba
      from price_schedule_items psi
     where psi.schedule_id = sched and psi.category = r.category;
    if p is not null then
      if r.category in ('Removable partial denture', 'Complete denture', 'Clear retainer', 'Night guard',
                        'Fixed retainer', 'Study model', 'Special tray')
         and r.arches = 'both' and pba is not null then
        line_base := pba;
      else
        line_base := p;
      end if;
      if r.category = 'Removable partial denture' and ptf is not null then
        -- first tooth is included in the base; only extras add the fee
        base := base + line_base + ptf * greatest(r.teeth - 1, 0);
      else
        base := base + line_base * r.units;
      end if;
      priced := true;
    end if;
  end loop;

  if not priced then
    return null;
  end if;
  return greatest(0, round(base - (base * disc / 100.0), 3));
exception when others then
  return null;
end;
$$;

/* --------------------------------------------------------------------- */
/*  Phase 49 — pricing NULL-discount fix (every ruleless clinic = 0 OMR)  */
/*                                                                       */
/*  With no clinic_price_rules row, SELECT INTO set disc to NULL (not    */
/*  0), NULL propagated through the total and greatest(0, NULL) = 0 --   */
/*  latent since Phase 17, exposed when master-for-all deleted every     */
/*  rule. One coalesce in each function fixes it.                        */
/* --------------------------------------------------------------------- */

create or replace function price_case()
returns trigger
security definer
set search_path = public
as $$
declare
  sched uuid;
  disc numeric := 0;
  base numeric := 0;
  priced boolean := false;
  r record;
  p numeric;
  ptf numeric;
  pba numeric;
  line_base numeric;
  adj jsonb := '[]'::jsonb;
  credit numeric := 0;
begin
  if tg_op = 'UPDATE' and old.invoice_status in ('issued', 'paid') then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.price_overridden then
    return new;
  end if;
  if new.lab_id is null then
    return new;
  end if;

  select cpr.price_schedule_id, coalesce(cpr.discount_pct, 0)
    into sched, disc
    from clinic_price_rules cpr
   where cpr.lab_id = new.lab_id and cpr.clinic_id = new.clinic_id;
  -- No rule row: SELECT INTO nulls BOTH targets, and a NULL discount
  -- poisons the arithmetic (base - base*NULL/100 = NULL; greatest(0,
  -- NULL) = 0) -> every ruleless clinic priced to ZERO. Same plpgsql
  -- NULL-trap class as the cancellation-guard bug (2026-08-19).
  disc := coalesce(disc, 0);
  if sched is null then
    select ps.id into sched from price_schedules ps
     where ps.lab_id = new.lab_id and ps.is_default
     limit 1;
  end if;
  if sched is null then
    return new;
  end if;

  for r in
    select x->>'category' as category,
           x->>'arches' as arches,
           coalesce(jsonb_array_length(x->'teeth'), 0) as teeth,
           case
             when x->>'category' in ('Removable partial denture', 'Michigan splint', 'Orthodontics splint',
                                     'Single layer splint - soft', 'Double layer splint - soft',
                                     'Double layer splint - outer hard, inner soft',
                                     'Clear retainer', 'Night guard', 'Fixed retainer',
                                     'Study model', 'Special tray', 'Complete denture', 'Others - refer to notes')
               then 1
             else greatest(coalesce(jsonb_array_length(x->'teeth'), 0), 1)
           end as units
      from jsonb_array_elements(
             coalesce(new.prescription->'restorations',
                      jsonb_build_array(new.prescription))) as x
  loop
    select psi.base_price, psi.per_tooth_fee, psi.price_both_arches into p, ptf, pba
      from price_schedule_items psi
     where psi.schedule_id = sched and psi.category = r.category;
    if p is not null then
      -- Arch appliances: both-arches price when chosen and configured,
      -- else the single-arch base (also the pre-Phase-45 behavior).
      if r.category in ('Removable partial denture', 'Complete denture', 'Clear retainer', 'Night guard',
                        'Fixed retainer', 'Study model', 'Special tray')
         and r.arches = 'both' and pba is not null then
        line_base := pba;
      else
        line_base := p;
      end if;
      if r.category = 'Removable partial denture' and ptf is not null then
        -- first tooth is included in the base; only extras add the fee
        base := base + line_base + ptf * greatest(r.teeth - 1, 0);
      else
        base := base + line_base * r.units;
      end if;
      priced := true;
    end if;
  end loop;

  if not priced then
    return new;
  end if;

  if disc <> 0 then
    adj := adj || jsonb_build_array(jsonb_build_object(
      'label', 'Clinic rate ' || (case when disc > 0 then '−' else '+' end) || abs(disc)::text || '%',
      'amount', round(-(base * disc / 100.0), 3)));
  end if;
  if new.remake is not null and coalesce((new.remake->>'cost')::numeric, 0) > 0 then
    credit := (new.remake->>'cost')::numeric;
    adj := adj || jsonb_build_array(jsonb_build_object('label', 'Remake credit', 'amount', -credit));
  end if;

  new.base_fee := round(base, 3);
  new.adjustments := adj;
  new.total_price := greatest(0, round(base - (base * disc / 100.0) - credit, 3));
  return new;
exception when others then
  return new;
end;
$$ language plpgsql;

create or replace function estimate_case_price(p_lab uuid, p_clinic uuid, p_prescription jsonb)
returns numeric
language plpgsql security definer stable
set search_path = public
as $$
declare
  sched uuid;
  disc numeric := 0;
  base numeric := 0;
  priced boolean := false;
  r record;
  p numeric;
  ptf numeric;
  pba numeric;
  line_base numeric;
begin
  if p_lab is null or p_clinic is null or p_prescription is null then
    return null;
  end if;
  if not (p_clinic in (select my_owned_clinic_ids()) or p_clinic = my_clinic_id()) then
    return null;
  end if;

  select cpr.price_schedule_id, coalesce(cpr.discount_pct, 0)
    into sched, disc
    from clinic_price_rules cpr
   where cpr.lab_id = p_lab and cpr.clinic_id = p_clinic;
  -- No rule row: SELECT INTO nulls BOTH targets, and a NULL discount
  -- poisons the arithmetic (base - base*NULL/100 = NULL; greatest(0,
  -- NULL) = 0) -> every ruleless clinic priced to ZERO. Same plpgsql
  -- NULL-trap class as the cancellation-guard bug (2026-08-19).
  disc := coalesce(disc, 0);
  if sched is null then
    select ps.id into sched from price_schedules ps
     where ps.lab_id = p_lab and ps.is_default
     limit 1;
  end if;
  if sched is null then
    return null;
  end if;

  for r in
    select x->>'category' as category,
           x->>'arches' as arches,
           coalesce(jsonb_array_length(x->'teeth'), 0) as teeth,
           case
             when x->>'category' in ('Removable partial denture', 'Michigan splint', 'Orthodontics splint',
                                     'Single layer splint - soft', 'Double layer splint - soft',
                                     'Double layer splint - outer hard, inner soft',
                                     'Clear retainer', 'Night guard', 'Fixed retainer',
                                     'Study model', 'Special tray', 'Complete denture', 'Others - refer to notes')
               then 1
             else greatest(coalesce(jsonb_array_length(x->'teeth'), 0), 1)
           end as units
      from jsonb_array_elements(
             coalesce(p_prescription->'restorations',
                      jsonb_build_array(p_prescription))) as x
  loop
    select psi.base_price, psi.per_tooth_fee, psi.price_both_arches into p, ptf, pba
      from price_schedule_items psi
     where psi.schedule_id = sched and psi.category = r.category;
    if p is not null then
      if r.category in ('Removable partial denture', 'Complete denture', 'Clear retainer', 'Night guard',
                        'Fixed retainer', 'Study model', 'Special tray')
         and r.arches = 'both' and pba is not null then
        line_base := pba;
      else
        line_base := p;
      end if;
      if r.category = 'Removable partial denture' and ptf is not null then
        -- first tooth is included in the base; only extras add the fee
        base := base + line_base + ptf * greatest(r.teeth - 1, 0);
      else
        base := base + line_base * r.units;
      end if;
      priced := true;
    end if;
  end loop;

  if not priced then
    return null;
  end if;
  return greatest(0, round(base - (base * disc / 100.0), 3));
exception when others then
  return null;
end;
$$;

/* --------------------------------------------------------------------- */
/*  Phase 50 — case-photos becomes a PRIVATE bucket (signed URLs only)    */
/*                                                                       */
/*  Patient clinical photos are PHI. They were public-read: knowing the  */
/*  URL was enough, so a link leaked through a shared PDF, a referrer,   */
/*  a proxy log or browser history exposed the image with no second      */
/*  check. Now the bucket is private and every view goes through a       */
/*  short-lived signed URL, which Storage only issues to a caller who    */
/*  passes the SELECT policy below.                                      */
/*                                                                       */
/*  Who may read an object:                                              */
/*    - the uploader (their own <uid>/... folder) — also what lets the   */
/*      Rx form show its own thumbnails before the case row exists; and  */
/*    - any member of the clinic that owns, or the lab assigned to, a    */
/*      case (or follow-up round) whose attachments reference the file.  */
/*  Stored URLs are unchanged: the object path is embedded in them, and  */
/*  the client signs from that — no data migration.                      */
/*                                                                       */
/*  DEPLOY ORDER (opposite of the usual): ship the APP FIRST, then run   */
/*  this. Signing works against a public bucket too, so the new client   */
/*  is safe either way; flipping the bucket before the new client is     */
/*  live would break thumbnails for anyone on the old bundle.            */
/* --------------------------------------------------------------------- */

update storage.buckets set public = false where id = 'case-photos';

-- Also close the Aug-21 audit's "no upload limits" finding while we're here:
-- 10 MB and image types only, enforced by Storage itself rather than by the
-- form's accept attribute (which a crafted client simply ignores).
update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif']
 where id = 'case-photos';

-- Security definer: the policy must look inside cases/case_rounds, which the
-- caller cannot read directly for other tenants. Mirrors the case visibility
-- rule used everywhere else (own clinic, owned clinics, assigned lab).
create or replace function can_read_case_photo(object_name text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from cases c,
           lateral jsonb_array_elements(coalesce(c.prescription->'files', '[]'::jsonb)) f
     where (c.clinic_id = my_clinic_id()
            or c.clinic_id in (select my_owned_clinic_ids())
            or c.lab_id = my_lab_id())
       and f->>'url' like '%' || object_name
  )
  or exists (
    select 1
      from case_rounds r
      join cases c on c.id = r.parent_case_id,
           lateral jsonb_array_elements(coalesce(r.attachments, '[]'::jsonb)) a
     where (c.clinic_id = my_clinic_id()
            or c.clinic_id in (select my_owned_clinic_ids())
            or c.lab_id = my_lab_id())
       and a->>'url' like '%' || object_name
  );
$$;

-- Replace public read with membership-scoped read. Writes/deletes stay
-- owner-scoped exactly as before.
drop policy if exists "case_photos_public_read" on storage.objects;
drop policy if exists "case_photos_read" on storage.objects;
create policy "case_photos_read" on storage.objects for select
  using (
    bucket_id = 'case-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or can_read_case_photo(name)
    )
  );

/* --------------------------------------------------------------------- */
/*  Phase 51 — QR mobile photo upload sessions                            */
/*                                                                       */
/*  A dentist on desktop shows a QR; their phone opens                   */
/*  /mobile-upload/<token> WITHOUT logging in, takes photos, and the     */
/*  mobile-upload Edge Function (service role, token-gated, fail-closed) */
/*  puts them in the PRIVATE case-photos bucket under the DESKTOP        */
/*  user's own folder — so Phase 50 signing and case-visibility rules    */
/*  apply unchanged and the phone never holds any credential beyond a    */
/*  single-use, 15-minute token.                                         */
/*                                                                       */
/*  The authenticated desktop INSERTs the session row itself (RLS: own   */
/*  rows only, and it cannot forge user_id or stretch the expiry). Only  */
/*  the Edge Function (service role) may UPDATE — appending uploaded     */
/*  file entries and flipping status — which the desktop receives over   */
/*  Supabase Realtime on its own row.                                    */
/*                                                                       */
/*  Manual steps that pair with this block:                              */
/*    1. run this SQL;                                                   */
/*    2. create a NEW Edge Function named exactly "mobile-upload",       */
/*       paste supabase/functions/mobile-upload/index.ts,                */
/*       and turn "Verify JWT with legacy secret" OFF (the phone is      */
/*       anonymous; the token is the auth).                              */
/* --------------------------------------------------------------------- */

create table if not exists mobile_upload_sessions (
  id uuid primary key default gen_random_uuid(),   -- the QR token itself
  user_id uuid not null references auth.users(id) on delete cascade,
  group_id text not null,                          -- the Rx form's photo group
  status text not null default 'pending' check (status in ('pending', 'used', 'cancelled')),
  uploaded jsonb not null default '[]'::jsonb,     -- [{name,size,url,kind:'photo'}]
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes'
);

alter table mobile_upload_sessions enable row level security;

drop policy if exists "mobile_upload_select_own" on mobile_upload_sessions;
create policy "mobile_upload_select_own" on mobile_upload_sessions for select
  using (user_id = auth.uid());

-- Insert: own rows only, expiry may only be shortened, never stretched.
drop policy if exists "mobile_upload_insert_own" on mobile_upload_sessions;
create policy "mobile_upload_insert_own" on mobile_upload_sessions for insert
  with check (user_id = auth.uid() and expires_at <= now() + interval '15 minutes');

-- The desktop may cancel its own pending session (closing the QR modal);
-- everything else (uploads, used flag) is service-role-only via the function.
drop policy if exists "mobile_upload_cancel_own" on mobile_upload_sessions;
create policy "mobile_upload_cancel_own" on mobile_upload_sessions for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and status = 'cancelled');

-- Realtime: the desktop hears the function's update the moment photos land.
do $$
begin
  if not exists (select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mobile_upload_sessions') then
    alter publication supabase_realtime add table mobile_upload_sessions;
  end if;
end $$;
/* --------------------------------------------------------------------- */
/*  Phase 56 — Clinic multi-tenancy: members, roles, per-doctor cases    */
/*                                                                       */
/*  Clinics gain staff the way labs did in Phase 16: a clinic_members    */
/*  junction with roles admin / receptionist / doctor. Owners are        */
/*  admins always (trigger + my_clinic_role's owner branch, so an       */
/*  owner's member row can never demote them). Case visibility becomes   */
/*  role-aware: admins and receptionists see every case of their         */
/*  clinics; doctors see only cases they created (cases.created_by,     */
/*  stamped server-side, backfilled to the clinic owner). Receptionists  */
/*  may update cases (cancellations, scheduling) but the Phase 22 Rx     */
/*  guard now raises on their clinical-column edits. Roles are TEXT +    */
/*  CHECK, not an enum, on purpose: ALTER TYPE ... ADD VALUE cannot run  */
/*  inside the SQL editor's single-transaction paste.                    */
/*  Team invitations (clinic_invitations) land in Phase 57; super-admin  */
/*  lab visibility mapping (clinic_lab_access) in Phase 58.              */
/* --------------------------------------------------------------------- */

create table if not exists clinic_members (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'doctor' check (role in ('admin', 'receptionist', 'doctor')),
  created_at timestamptz not null default now(),
  unique (clinic_id, user_id)
);

create index if not exists clinic_members_user_idx on clinic_members (user_id);
create index if not exists clinic_members_clinic_idx on clinic_members (clinic_id);

alter table clinic_members enable row level security;

-- Who created each case. Stamped by trigger from the caller's JWT (never
-- client-supplied), backfilled to the clinic owner for existing rows.
alter table cases add column if not exists created_by uuid references auth.users(id) on delete set null;
create index if not exists cases_created_by_idx on cases (created_by);

update cases c set created_by = cl.owner_id
  from clinics cl
 where cl.id = c.clinic_id and c.created_by is null;

create or replace function stamp_case_creator()
returns trigger
as $$
begin
  if current_setting('role', true) <> 'service_role' and auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists cases_stamp_creator on cases;
create trigger cases_stamp_creator
  before insert on cases
  for each row execute function stamp_case_creator();

/* ---- helpers -------------------------------------------------------- */

-- Every ACTIVE clinic the caller can act for: owned, primary profile
-- pointer, or clinic_members row. SECURITY DEFINER for the same
-- recursion/RLS reasons as my_owned_clinic_ids() (Phase 13 comment).
create or replace function my_clinic_ids()
returns setof uuid
language sql security definer stable
set search_path = public
as $$
  select c.id from clinics c
  where c.status = 'active'
    and (c.owner_id = auth.uid()
         or c.id = (select clinic_id from profiles where id = auth.uid())
         or c.id in (select clinic_id from clinic_members where user_id = auth.uid()));
$$;

-- The caller's role at one clinic. Owners are admins regardless of any
-- member row; a legacy profile pointer without a member row (pre-Phase-56
-- accounts) also counts as admin — that is exactly the access it had.
create or replace function my_clinic_role(target uuid)
returns text
language sql security definer stable
set search_path = public
as $$
  select case
    when exists (select 1 from clinics where id = target and owner_id = auth.uid())
      then 'admin'
    when exists (select 1 from clinic_members where clinic_id = target and user_id = auth.uid())
      then (select role from clinic_members where clinic_id = target and user_id = auth.uid())
    when target = (select clinic_id from profiles where id = auth.uid())
      then 'admin'
  end;
$$;

create or replace function has_clinic_role(target uuid, roles text[])
returns boolean
language sql security definer stable
set search_path = public
as $$
  select target in (select my_clinic_ids())
     and coalesce(my_clinic_role(target), '') = any (roles);
$$;

-- Clinic-side case visibility in one place: admins/receptionists see all
-- of their clinics' cases, doctors only their own. Every policy that used
-- the "my_clinic_id() or my_owned_clinic_ids()" pair now routes here.
create or replace function clinic_case_visible(p_clinic uuid, p_created_by uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select p_clinic in (select my_clinic_ids())
     and (coalesce(my_clinic_role(p_clinic), '') in ('admin', 'receptionist')
          or coalesce(p_created_by = auth.uid(), false));
$$;

-- Owner of a clinic without re-entering clinics RLS (used by the
-- clinic_members owner-row protection below).
create or replace function clinic_owner(target uuid)
returns uuid
language sql security definer stable
set search_path = public
as $$
  select owner_id from clinics where id = target;
$$;

/* ---- owners are members (mirror of labs_owner_membership) ----------- */

create or replace function backfill_clinic_owner_membership()
returns trigger
security definer
set search_path = public
as $$
begin
  -- OLD is unassigned on INSERT — TG_OP must be checked first.
  if new.owner_id is not null
     and (TG_OP = 'INSERT' or new.owner_id is distinct from old.owner_id) then
    insert into clinic_members (clinic_id, user_id, role)
    values (new.id, new.owner_id, 'admin')
    on conflict (clinic_id, user_id) do update set role = 'admin';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists clinics_owner_membership on clinics;
create trigger clinics_owner_membership
  after insert or update of owner_id on clinics
  for each row execute function backfill_clinic_owner_membership();

-- One-time backfill: every existing clinic owner becomes an admin member.
insert into clinic_members (clinic_id, user_id, role)
select id, owner_id, 'admin' from clinics where owner_id is not null
on conflict (clinic_id, user_id) do update set role = 'admin';

-- Membership now also legitimises the profiles.clinic_id pointer (the
-- Phase 19 org-join gate): an invited member may point their profile at
-- the clinic they joined.
create or replace function can_join_clinic(target uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from clinics c
    where c.id = target
      and (
        c.owner_id = auth.uid()
        -- orphaned clinic (owner login deleted): claimable by email match,
        -- or freely when no email was ever recorded on the row
        or (c.owner_id is null
            and (lower(coalesce(c.email, '')) = lower(coalesce(auth.jwt()->>'email', ''))
                 or coalesce(c.email, '') = ''))
        or exists (select 1 from clinic_members m
                   where m.clinic_id = c.id and m.user_id = auth.uid())
      )
  );
$$;

/* ---- clinic_members RLS --------------------------------------------- */

-- Roster is visible to every member of the clinic (and the super admin).
drop policy if exists "clinic_members_select" on clinic_members;
create policy "clinic_members_select" on clinic_members for select
  using (
    user_id = auth.uid()
    or clinic_id in (select my_clinic_ids())
    or is_admin()
  );

-- Direct member-row management is clinic-admin only (Phase 57's invite
-- accept RPC is SECURITY DEFINER and does not need these). The owner's
-- row can never be modified or removed — ownership is not demotable.
drop policy if exists "clinic_members_insert_admin" on clinic_members;
create policy "clinic_members_insert_admin" on clinic_members for insert
  with check (has_clinic_role(clinic_id, array['admin']) or is_admin());

drop policy if exists "clinic_members_update_admin" on clinic_members;
create policy "clinic_members_update_admin" on clinic_members for update
  using (
    (has_clinic_role(clinic_id, array['admin']) or is_admin())
    and user_id is distinct from clinic_owner(clinic_id)
  );

drop policy if exists "clinic_members_delete_admin" on clinic_members;
create policy "clinic_members_delete_admin" on clinic_members for delete
  using (
    (has_clinic_role(clinic_id, array['admin']) or is_admin())
    and user_id is distinct from clinic_owner(clinic_id)
  );

-- Members can see their co-members' profiles (names/avatars for the team
-- roster) — the clinic mirror of profiles_select_lab_members.
drop policy if exists "profiles_select_clinic_members" on profiles;
create policy "profiles_select_clinic_members" on profiles for select
  using (
    id in (select user_id from clinic_members
           where clinic_id in (select my_clinic_ids()))
  );

/* ---- role-aware policy rewrites ------------------------------------- */

-- clinics: members see their clinics; owner branch stays so a pending
-- clinic's owner still sees the "awaiting activation" screen; the lab
-- branch (case counterparties) is unchanged.
drop policy if exists "clinics_select" on clinics;
create policy "clinics_select" on clinics for select
  using (
    owner_id = auth.uid()
    or id in (select my_clinic_ids())
    or id in (select clinic_id from cases where lab_id = my_lab_id())
  );

drop policy if exists "cases_select" on cases;
create policy "cases_select" on cases for select
  using (
    clinic_case_visible(clinic_id, created_by)
    or lab_id = my_lab_id()
  );

-- Cases are submitted by doctors and admins; receptionists handle
-- front-desk actions on existing cases but do not author prescriptions.
drop policy if exists "cases_insert_own_clinic" on cases;
create policy "cases_insert_own_clinic" on cases for insert
  with check (has_clinic_role(clinic_id, array['admin', 'doctor']));

-- Clinic side: whoever can see a case can act on it (cancellation
-- requests, handover) — the Rx guard below keeps clinical columns away
-- from receptionists. Lab side unchanged (read_only gate from Phase 16).
drop policy if exists "cases_update" on cases;
create policy "cases_update" on cases for update
  using (
    clinic_case_visible(clinic_id, created_by)
    or (lab_id = my_lab_id() and lab_write_allowed())
  );

drop policy if exists "cases_delete_own_clinic" on cases;
create policy "cases_delete_own_clinic" on cases for delete
  using (
    has_clinic_role(clinic_id, array['admin'])
    or (has_clinic_role(clinic_id, array['doctor']) and created_by = auth.uid())
  );

-- case_notes / case_rounds / photos follow case visibility exactly, so a
-- doctor cannot read a colleague's case through its side tables.
drop policy if exists "case_notes_select" on case_notes;
create policy "case_notes_select" on case_notes for select
  using (
    exists (
      select 1 from cases c
      where c.id = case_notes.case_id
        and (clinic_case_visible(c.clinic_id, c.created_by)
             or c.lab_id = my_lab_id())
    )
  );

drop policy if exists "case_notes_insert" on case_notes;
create policy "case_notes_insert" on case_notes for insert
  with check (
    exists (
      select 1 from cases c
      where c.id = case_notes.case_id
        and (clinic_case_visible(c.clinic_id, c.created_by)
             or (c.lab_id = my_lab_id() and lab_write_allowed()))
    )
  );

drop policy if exists "case_rounds_select" on case_rounds;
create policy "case_rounds_select" on case_rounds for select
  using (exists (
    select 1 from cases c where c.id = case_rounds.parent_case_id
      and (clinic_case_visible(c.clinic_id, c.created_by) or c.lab_id = my_lab_id())
  ));

drop policy if exists "case_rounds_insert" on case_rounds;
create policy "case_rounds_insert" on case_rounds for insert
  with check (exists (
    select 1 from cases c where c.id = case_rounds.parent_case_id
      and (clinic_case_visible(c.clinic_id, c.created_by) or c.lab_id = my_lab_id())
  ));

drop policy if exists "case_rounds_update" on case_rounds;
create policy "case_rounds_update" on case_rounds for update
  using (exists (
    select 1 from cases c where c.id = case_rounds.parent_case_id
      and (clinic_case_visible(c.clinic_id, c.created_by) or c.lab_id = my_lab_id())
  ));

-- Case-photo reads (Phase 50 signed URLs) get the same role scoping.
create or replace function can_read_case_photo(object_name text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from cases c,
           lateral jsonb_array_elements(coalesce(c.prescription->'files', '[]'::jsonb)) f
     where (clinic_case_visible(c.clinic_id, c.created_by)
            or c.lab_id = my_lab_id())
       and f->>'url' like '%' || object_name
  )
  or exists (
    select 1
      from case_rounds r
      join cases c on c.id = r.parent_case_id,
           lateral jsonb_array_elements(coalesce(r.attachments, '[]'::jsonb)) a
     where (clinic_case_visible(c.clinic_id, c.created_by)
            or c.lab_id = my_lab_id())
       and a->>'url' like '%' || object_name
  );
$$;

/* ---- Rx guard: receptionists never edit clinical content ------------ */
/*  Same body as Phase 22 except: clinic-writer detection is membership- */
/*  aware, and a receptionist's Rx-column change raises instead of the   */
/*  clinic branch's 30-minute check.                                     */

create or replace function guard_prescription_edits()
returns trigger
as $$
declare
  rx_changed boolean;
  is_clinic_writer boolean;
begin
  if current_setting('role', true) = 'service_role' then
    return new;
  end if;

  rx_changed :=
    new.prescription is distinct from old.prescription
    or new.patient_name is distinct from old.patient_name
    or new.patient_id is distinct from old.patient_id
    or new.patient_phone is distinct from old.patient_phone
    or new.appointment_date is distinct from old.appointment_date
    or new.delivery_time is distinct from old.delivery_time;
  if not rx_changed then
    return new;
  end if;

  is_clinic_writer := old.clinic_id in (select my_clinic_ids());

  if not is_clinic_writer then
    -- Lab-side write: keep the rest of the patch, drop the Rx changes.
    new.prescription := old.prescription;
    new.patient_name := old.patient_name;
    new.patient_id := old.patient_id;
    new.patient_phone := old.patient_phone;
    new.appointment_date := old.appointment_date;
    new.delivery_time := old.delivery_time;
    return new;
  end if;

  if coalesce(my_clinic_role(old.clinic_id), '') = 'receptionist' then
    raise exception 'Receptionists cannot change prescription details — ask the case''s doctor or a clinic admin.';
  end if;

  -- Raise instead of silently reverting (the RLS-0-row lesson): the edit
  -- flow sends ONLY Rx fields, and the dentist needs to know it failed.
  if old.created_at < now() - interval '30 minutes' then
    raise exception 'This prescription can no longer be edited — changes are only allowed within 30 minutes of submission.';
  end if;

  return new;
end;
$$ language plpgsql;

-- Price estimates now answer for any clinic member (identical to the
-- Phase 49 body except the membership check).
create or replace function estimate_case_price(p_lab uuid, p_clinic uuid, p_prescription jsonb)
returns numeric
language plpgsql security definer stable
set search_path = public
as $$
declare
  sched uuid;
  disc numeric := 0;
  base numeric := 0;
  priced boolean := false;
  r record;
  p numeric;
  ptf numeric;
  pba numeric;
  line_base numeric;
begin
  if p_lab is null or p_clinic is null or p_prescription is null then
    return null;
  end if;
  if p_clinic not in (select my_clinic_ids()) then
    return null;
  end if;

  select cpr.price_schedule_id, coalesce(cpr.discount_pct, 0)
    into sched, disc
    from clinic_price_rules cpr
   where cpr.lab_id = p_lab and cpr.clinic_id = p_clinic;
  -- No rule row: SELECT INTO nulls BOTH targets, and a NULL discount
  -- poisons the arithmetic (base - base*NULL/100 = NULL; greatest(0,
  -- NULL) = 0) -> every ruleless clinic priced to ZERO. Same plpgsql
  -- NULL-trap class as the cancellation-guard bug (2026-08-19).
  disc := coalesce(disc, 0);
  if sched is null then
    select ps.id into sched from price_schedules ps
     where ps.lab_id = p_lab and ps.is_default
     limit 1;
  end if;
  if sched is null then
    return null;
  end if;

  for r in
    select x->>'category' as category,
           x->>'arches' as arches,
           coalesce(jsonb_array_length(x->'teeth'), 0) as teeth,
           case
             when x->>'category' in ('Removable partial denture', 'Michigan splint', 'Orthodontics splint',
                                     'Single layer splint - soft', 'Double layer splint - soft',
                                     'Double layer splint - outer hard, inner soft',
                                     'Clear retainer', 'Night guard', 'Fixed retainer',
                                     'Study model', 'Special tray', 'Complete denture', 'Others - refer to notes')
               then 1
             else greatest(coalesce(jsonb_array_length(x->'teeth'), 0), 1)
           end as units
      from jsonb_array_elements(
             coalesce(p_prescription->'restorations',
                      jsonb_build_array(p_prescription))) as x
  loop
    select psi.base_price, psi.per_tooth_fee, psi.price_both_arches into p, ptf, pba
      from price_schedule_items psi
     where psi.schedule_id = sched and psi.category = r.category;
    if p is not null then
      if r.category in ('Removable partial denture', 'Complete denture', 'Clear retainer', 'Night guard',
                        'Fixed retainer', 'Study model', 'Special tray')
         and r.arches = 'both' and pba is not null then
        line_base := pba;
      else
        line_base := p;
      end if;
      if r.category = 'Removable partial denture' and ptf is not null then
        -- first tooth is included in the base; only extras add the fee
        base := base + line_base + ptf * greatest(r.teeth - 1, 0);
      else
        base := base + line_base * r.units;
      end if;
      priced := true;
    end if;
  end loop;

  if not priced then
    return null;
  end if;
  return greatest(0, round(base - (base * disc / 100.0), 3));
exception when others then
  return null;
end;
$$;
/* --------------------------------------------------------------------- */
/*  Phase 57 — Clinic team invitations + membership hygiene              */
/*                                                                       */
/*  Tokenized email invitations for clinic staff (the clinic half of     */
/*  Phase 21's lab invites, upgraded): clinic_invitations rows carry a   */
/*  random 64-hex token, expire after 7 days, and can be revoked while   */
/*  pending. Admins invite anyone; receptionists invite doctors and      */
/*  receptionists but never admins. The invite email (case-notify, via   */
/*  the Phase 21 webhook poster, now table-agnostic) links to            */
/*  /?clinic_invite=<token>; accepting happens in accept_clinic_         */
/*  invitation() — unlike the lab email-match flow, a token invite can   */
/*  also be accepted by an ALREADY-REGISTERED dentist account, which     */
/*  becomes a multi-clinic member. Also closes two Phase 56 leftovers:   */
/*  my_clinic_role()'s legacy pointer-as-admin branch is dropped         */
/*  (backfill-verified: every pointer profile is an owner with a member  */
/*  row), and remove_clinic_member() repoints/clears the removed user's  */
/*  primary clinic pointer so a stale pointer can't retain access.       */
/* --------------------------------------------------------------------- */

create table if not exists clinic_invitations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  email text not null,
  role text not null default 'doctor' check (role in ('admin', 'receptionist', 'doctor')),
  invited_by uuid not null references auth.users(id) on delete cascade,
  -- 64 hex chars of pg_strong_random via two v4 uuids — same entropy shape
  -- as gen_random_bytes(32) without requiring the pgcrypto extension.
  token text unique not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'revoked')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

create index if not exists clinic_invitations_clinic_idx on clinic_invitations (clinic_id);
-- One live invite per address per clinic; older accepted/revoked rows stay
-- as the audit trail.
create unique index if not exists clinic_invitations_pending_key
  on clinic_invitations (clinic_id, lower(email)) where status = 'pending';

alter table clinic_invitations enable row level security;

-- Members' emails on the roster (profiles has no email column, and
-- auth.users is off-limits to clients). Backfilled for the Phase 56
-- owner rows; the accept RPC fills it for invited staff.
alter table clinic_members add column if not exists email text not null default '';
update clinic_members m set email = coalesce(u.email, '')
  from auth.users u
 where u.id = m.user_id and m.email = '';

-- Owner auto-membership now records the owner's email too.
create or replace function backfill_clinic_owner_membership()
returns trigger
security definer
set search_path = public
as $$
begin
  -- OLD is unassigned on INSERT — TG_OP must be checked first.
  if new.owner_id is not null
     and (TG_OP = 'INSERT' or new.owner_id is distinct from old.owner_id) then
    insert into clinic_members (clinic_id, user_id, role, email)
    values (new.id, new.owner_id, 'admin',
            coalesce((select email from auth.users where id = new.owner_id), ''))
    on conflict (clinic_id, user_id) do update set role = 'admin';
  end if;
  return new;
end;
$$ language plpgsql;

-- my_clinic_role: the Phase 56 legacy pointer-as-admin branch is gone.
-- Every legitimate pointer-holder is an owner or has a member row
-- (backfill-verified in prod 2026-08-27); keeping the branch would have
-- let a REMOVED member with a stale pointer walk back in as admin.
create or replace function my_clinic_role(target uuid)
returns text
language sql security definer stable
set search_path = public
as $$
  select case
    when exists (select 1 from clinics where id = target and owner_id = auth.uid())
      then 'admin'
    else (select role from clinic_members where clinic_id = target and user_id = auth.uid())
  end;
$$;

/* ---- clinic_invitations RLS + column guard -------------------------- */

-- Managing invites is an admin/receptionist affair; invitees never read
-- the table directly — the token in their email is their credential and
-- the two RPCs below are their only door.
drop policy if exists "clinic_invitations_select" on clinic_invitations;
create policy "clinic_invitations_select" on clinic_invitations for select
  using (has_clinic_role(clinic_id, array['admin', 'receptionist']) or is_admin());

drop policy if exists "clinic_invitations_insert" on clinic_invitations;
create policy "clinic_invitations_insert" on clinic_invitations for insert
  with check (
    invited_by = auth.uid()
    and (
      has_clinic_role(clinic_id, array['admin'])
      or (has_clinic_role(clinic_id, array['receptionist']) and role <> 'admin')
    )
  );

drop policy if exists "clinic_invitations_update" on clinic_invitations;
create policy "clinic_invitations_update" on clinic_invitations for update
  using (has_clinic_role(clinic_id, array['admin', 'receptionist']) or is_admin());

-- No delete policy: revoked/accepted invites are the audit trail.

-- Client updates can only ever mean "revoke a pending invite" — every
-- identifying column is frozen and the only status transition allowed is
-- pending -> revoked. The accept RPC marks accepted under a transaction-
-- local flag (same current_setting technique as the service_role gates).
create or replace function guard_clinic_invitation()
returns trigger
as $$
begin
  if current_setting('role', true) = 'service_role'
     or current_setting('drcrown.accept_invite', true) = '1' then
    return new;
  end if;
  new.clinic_id := old.clinic_id;
  new.email := old.email;
  new.role := old.role;
  new.token := old.token;
  new.invited_by := old.invited_by;
  new.expires_at := old.expires_at;
  new.created_at := old.created_at;
  if new.status is distinct from old.status
     and not (old.status = 'pending' and new.status = 'revoked') then
    raise exception 'Only pending invitations can be revoked.';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists clinic_invitations_guard on clinic_invitations;
create trigger clinic_invitations_guard
  before update on clinic_invitations
  for each row execute function guard_clinic_invitation();

/* ---- invite emails (reuse the Phase 21 webhook poster) -------------- */

-- Now table-agnostic: the hardcoded 'lab_members' literal becomes
-- TG_TABLE_NAME so clinic_invitations can share it. Payload shape for the
-- existing lab trigger is unchanged.
create or replace function notify_invite_webhook()
returns trigger
security definer
set search_path = public, private
as $$
declare
  secret text;
begin
  select value into secret from private.webhook_config where key = 'case_notify_secret';
  perform net.http_post(
    url := 'https://mtxkushcxczjwypwoxdh.supabase.co/functions/v1/case-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', coalesce(secret, '')
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', TG_TABLE_NAME,
      'schema', 'public',
      'record', to_jsonb(NEW)
    )
  );
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists clinic_invitations_notify on clinic_invitations;
create trigger clinic_invitations_notify
  after insert on clinic_invitations
  for each row execute function notify_invite_webhook();

/* ---- invitee-facing RPCs -------------------------------------------- */

-- What the /?clinic_invite=<token> landing screen shows before the user
-- signs in: clinic name, invited address, role, effective status. The
-- token is the credential; holding it means holding the invite email.
create or replace function peek_clinic_invitation(p_token text)
returns jsonb
language plpgsql security definer stable
set search_path = public
as $$
declare
  inv clinic_invitations%rowtype;
begin
  select * into inv from clinic_invitations where token = p_token;
  if inv.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'clinicName', (select name from clinics where id = inv.clinic_id),
    'email', inv.email,
    'role', inv.role,
    'status', case when inv.status = 'pending' and inv.expires_at < now()
                   then 'expired' else inv.status end
  );
end;
$$;

-- Accepting binds the signed-in user to the clinic. Works for a brand-new
-- signup (creates the dentist profile, p_name fills the display name) AND
-- for an existing dentist account (becomes a multi-clinic member — the
-- fix for the lab flow's "inviting a registered email does nothing").
-- The signed-in email must match the invited address exactly.
create or replace function accept_clinic_invitation(p_token text, p_name text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  inv clinic_invitations%rowtype;
  caller uuid := auth.uid();
  caller_email text := lower(coalesce(auth.jwt()->>'email', ''));
  prof_role text;
  cname text;
begin
  if caller is null then
    raise exception 'Sign in first, then open the invitation link again.';
  end if;
  select * into inv from clinic_invitations where token = p_token;
  if inv.id is null then
    raise exception 'This invitation link is not valid.';
  end if;
  select name into cname from clinics where id = inv.clinic_id and status = 'active';
  if cname is null then
    raise exception 'This clinic is not active on Dr-Crown.';
  end if;
  if inv.status = 'revoked' then
    raise exception 'This invitation was withdrawn by the clinic.';
  end if;
  if inv.status = 'accepted' then
    if exists (select 1 from clinic_members where clinic_id = inv.clinic_id and user_id = caller) then
      -- double-click / re-opened link by the same person: succeed quietly
      return jsonb_build_object('clinicId', inv.clinic_id, 'clinicName', cname, 'role', inv.role, 'already', true);
    end if;
    raise exception 'This invitation has already been used.';
  end if;
  if inv.expires_at < now() then
    raise exception 'This invitation has expired — ask the clinic to send a new one.';
  end if;
  if caller_email is distinct from lower(inv.email) then
    raise exception 'This invitation was sent to % — you are signed in as %.',
      inv.email, coalesce(nullif(caller_email, ''), 'an account without an email');
  end if;

  select role into prof_role from profiles where id = caller;
  if prof_role is null then
    insert into profiles (id, role, name, clinic_id)
    values (caller, 'dentist', coalesce(nullif(trim(p_name), ''), ''), inv.clinic_id);
  elsif prof_role <> 'dentist' then
    raise exception 'This account is registered as a % account — clinic invitations need a dentist account.', prof_role;
  end if;

  insert into clinic_members (clinic_id, user_id, role, email)
  values (inv.clinic_id, caller, inv.role, inv.email)
  on conflict (clinic_id, user_id) do update
    set role = case when clinic_owner(excluded.clinic_id) = excluded.user_id
                    then 'admin' else excluded.role end,
        email = excluded.email;

  -- primary clinic pointer: only set when empty (never steal an existing
  -- dentist's default clinic)
  update profiles set clinic_id = inv.clinic_id where id = caller and clinic_id is null;

  perform set_config('drcrown.accept_invite', '1', true);
  update clinic_invitations set status = 'accepted' where id = inv.id;

  return jsonb_build_object('clinicId', inv.clinic_id, 'clinicName', cname, 'role', inv.role);
end;
$$;

/* ---- member removal (mirror of remove_lab_member, gentler) ---------- */

-- Unlike the lab version this does NOT delete the profile: clinic staff
-- can belong to several clinics, so removal deletes the membership and
-- repoints (or clears) the primary clinic pointer. With no memberships
-- left the account simply drops to Onboarding on next load.
create or replace function remove_clinic_member(p_clinic uuid, p_user uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not (has_clinic_role(p_clinic, array['admin']) or is_admin()) then
    raise exception 'Only a clinic admin can remove members.';
  end if;
  if p_user = clinic_owner(p_clinic) then
    raise exception 'The clinic owner cannot be removed.';
  end if;
  if p_user = auth.uid() and not is_admin() then
    raise exception 'You cannot remove yourself.';
  end if;

  delete from clinic_members where clinic_id = p_clinic and user_id = p_user;

  -- A stale primary pointer must never linger (my_clinic_ids() honors it):
  -- repoint to another clinic they belong to, or clear it.
  update profiles set clinic_id = (
      select m.clinic_id from clinic_members m
      where m.user_id = p_user and m.clinic_id <> p_clinic
      order by m.created_at limit 1)
  where id = p_user and clinic_id = p_clinic;
end;
$$;
/* --------------------------------------------------------------------- */
/*  Phase 58 — Super-admin lab visibility: exclusive clinics, private    */
/*  labs, and the clinic↔lab access map                                  */
/*                                                                       */
/*  Until now every authenticated user saw the whole labs directory      */
/*  (labs_select_all). Visibility is now a super-admin-controlled rule:  */
/*    - labs.is_public (default true): a private lab is visible only to  */
/*      clinics mapped to it in clinic_lab_access.                       */
/*    - clinics.is_exclusive (default false): an exclusive clinic sees   */
/*      ONLY its mapped labs — public labs disappear from its picker.    */
/*    - clinic_lab_access rows are managed by the super admin alone.     */
/*  Enforced in RLS (labs select + cases insert per SENDING clinic), so  */
/*  the Rx form's LabPicker follows automatically and a hand-rolled      */
/*  request can't sidestep it. Untouched: a lab always sees itself, a    */
/*  clinic always sees labs it has cases with (invoices/statements for   */
/*  later-revoked labs must keep rendering), unclaimed orphan rows stay  */
/*  reachable for the claim flow, and the super admin sees everything.   */
/*  Defaults reproduce today's behavior exactly (all public, none        */
/*  exclusive) — nothing changes until the admin flips a switch.        */
/* --------------------------------------------------------------------- */

create table if not exists clinic_lab_access (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  lab_id uuid not null references labs(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (clinic_id, lab_id)
);

create index if not exists clinic_lab_access_lab_idx on clinic_lab_access (lab_id);

alter table clinic_lab_access enable row level security;

alter table clinics add column if not exists is_exclusive boolean not null default false;
alter table labs add column if not exists is_public boolean not null default true;

-- Clinic members can read their own clinic's mappings (the Rx form uses
-- them to filter the picker per sending clinic); only the super admin
-- writes them. No update policy: rows are granted/revoked, never edited.
drop policy if exists "clinic_lab_access_select" on clinic_lab_access;
create policy "clinic_lab_access_select" on clinic_lab_access for select
  using (clinic_id in (select my_clinic_ids()) or is_admin());

drop policy if exists "clinic_lab_access_insert" on clinic_lab_access;
create policy "clinic_lab_access_insert" on clinic_lab_access for insert
  with check (is_admin());

drop policy if exists "clinic_lab_access_delete" on clinic_lab_access;
create policy "clinic_lab_access_delete" on clinic_lab_access for delete
  using (is_admin());

/* ---- visibility helpers --------------------------------------------- */

-- May THIS clinic send to THIS lab? Mapped always wins; otherwise a
-- standard clinic may use any public lab. SECURITY DEFINER so the labs
-- lookup doesn't re-enter labs RLS from inside the labs policy below.
create or replace function clinic_can_use_lab(p_clinic uuid, p_lab uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (select 1 from clinic_lab_access
                 where clinic_id = p_clinic and lab_id = p_lab)
      or exists (select 1 from clinics c
                 join labs l on l.id = p_lab
                 where c.id = p_clinic
                   and not c.is_exclusive
                   and l.is_public);
$$;

-- Is the lab visible to ANY clinic the caller belongs to?
create or replace function lab_visible_for_rx(p_lab uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (select 1 from my_clinic_ids() mc(cid)
                 where clinic_can_use_lab(mc.cid, p_lab));
$$;

/* ---- labs directory RLS --------------------------------------------- */

drop policy if exists "labs_select_all" on labs;
drop policy if exists "labs_select" on labs;
create policy "labs_select" on labs for select
  using (
    is_admin()
    or owner_id = auth.uid()
    or id = my_lab_id()
    or created_by_clinic_id in (select my_clinic_ids())
    -- unclaimed placeholder/orphan rows stay reachable: the lab signup
    -- claim flow must find them (they are already filtered out of every
    -- dentist-facing list client-side)
    or owner_id is null
    -- labs this caller's clinics have cases with — history must render
    -- even after a mapping is revoked or a lab goes private
    or id in (select lab_id from cases where clinic_id in (select my_clinic_ids()))
    or lab_visible_for_rx(id)
  );

-- Super-admin toggles (clinics.is_exclusive / labs.is_public) are plain
-- RLS-gated updates from the Admin Dashboard — no Edge Function needed.
drop policy if exists "clinics_update_admin" on clinics;
create policy "clinics_update_admin" on clinics for update
  using (is_admin());

drop policy if exists "labs_update_admin" on labs;
create policy "labs_update_admin" on labs for update
  using (is_admin());

/* ---- enforcement on cases ------------------------------------------- */

-- New cases must go to a lab the SENDING clinic may use — "one of my
-- other clinics could" is not enough for a multi-clinic doctor.
drop policy if exists "cases_insert_own_clinic" on cases;
create policy "cases_insert_own_clinic" on cases for insert
  with check (
    has_clinic_role(clinic_id, array['admin', 'doctor'])
    and (lab_id is null or clinic_can_use_lab(clinic_id, lab_id))
  );

-- A case never changes labs client-side (the Rx edit flow already strips
-- labId). Freezing it here closes the re-point hole: without this, a
-- hand-rolled PATCH could move a case to an unmapped lab, since UPDATE
-- policies can't compare old vs new. Service role stays exempt (the
-- super-admin clinic-reassign recipe).
create or replace function guard_case_lab_binding()
returns trigger
as $$
begin
  if current_setting('role', true) <> 'service_role'
     and new.lab_id is distinct from old.lab_id then
    new.lab_id := old.lab_id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists cases_guard_lab_binding on cases;
create trigger cases_guard_lab_binding
  before update on cases
  for each row execute function guard_case_lab_binding();
/* --------------------------------------------------------------------- */
/*  Phase 59 — per-USER activate/deactivate from the super admin          */
/*                                                                       */
/*  Orgs already have a full on/off lifecycle (Phase 30 suspend ↔        */
/*  activate); this adds the same for individual accounts. profiles.     */
/*  status = 'inactive' makes the four identity helpers (my_clinic_id,   */
/*  my_clinic_ids, my_clinic_role, my_lab_id) return nothing, which      */
/*  darkens every clinic- and lab-side policy derived from them —        */
/*  instantly, even for a session that is already signed in. The client  */
/*  additionally shows a "deactivated" screen (profiles_select_own       */
/*  still returns the user's own row, so they can see WHY the app is    */
/*  empty). is_admin() is deliberately NOT gated and admin accounts      */
/*  cannot be deactivated — no self-lockout. A trigger freezes the      */
/*  column so a user cannot reactivate themselves through the own-       */
/*  profile update policy; the only write path is the RPC below.         */
/* --------------------------------------------------------------------- */

alter table profiles add column if not exists status text not null default 'active'
  check (status in ('active', 'inactive'));

-- Missing profile row = active on purpose: onboarding and the org claim
-- flows run before a profile exists and must not go dark.
create or replace function is_active_user()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select coalesce((select status <> 'inactive' from profiles where id = auth.uid()), true);
$$;

-- The four identity helpers, re-created with the gate. Bodies are the
-- latest versions (Phases 30/16/56/57) with only is_active_user() added.

create or replace function my_clinic_id()
returns uuid
language sql security definer stable
set search_path = public
as $$
  select p.clinic_id from profiles p
  join clinics c on c.id = p.clinic_id
  where p.id = auth.uid()
    and c.status = 'active'
    and is_active_user();
$$;

create or replace function my_lab_id()
returns uuid
language sql security definer stable
set search_path = public
as $$
  select p.lab_id from profiles p
  join labs l on l.id = p.lab_id
  where p.id = auth.uid()
    and l.status = 'active'
    and is_active_user()
    and not exists (
      select 1 from lab_members m
      where m.user_id = auth.uid()
        and m.lab_id = p.lab_id
        and m.status = 'suspended'
    );
$$;

create or replace function my_clinic_ids()
returns setof uuid
language sql security definer stable
set search_path = public
as $$
  select c.id from clinics c
  where c.status = 'active'
    and is_active_user()
    and (c.owner_id = auth.uid()
         or c.id = (select clinic_id from profiles where id = auth.uid())
         or c.id in (select clinic_id from clinic_members where user_id = auth.uid()));
$$;

create or replace function my_clinic_role(target uuid)
returns text
language sql security definer stable
set search_path = public
as $$
  select case
    when not is_active_user() then null
    when exists (select 1 from clinics where id = target and owner_id = auth.uid())
      then 'admin'
    else (select role from clinic_members where clinic_id = target and user_id = auth.uid())
  end;
$$;

-- Only the super admin flips accounts, only through here (the trigger
-- below freezes the column for every other writer).
create or replace function admin_set_user_status(p_user uuid, p_status text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Only the super admin can change account status.';
  end if;
  if p_status not in ('active', 'inactive') then
    raise exception 'Invalid status %.', p_status;
  end if;
  if p_user = auth.uid() then
    raise exception 'You cannot deactivate your own account.';
  end if;
  if (select role from profiles where id = p_user) = 'admin' then
    raise exception 'Admin accounts cannot be deactivated.';
  end if;
  perform set_config('drcrown.admin_status', '1', true);
  update profiles set status = p_status where id = p_user;
  if not found then
    raise exception 'No profile found for that user.';
  end if;
end;
$$;

-- profiles_update_own allows any column — without this, a deactivated
-- user could simply set themselves active again.
create or replace function guard_profile_status()
returns trigger
as $$
begin
  if current_setting('role', true) = 'service_role'
     or current_setting('drcrown.admin_status', true) = '1' then
    return new;
  end if;
  new.status := old.status;
  return new;
end;
$$ language plpgsql;

drop trigger if exists profiles_guard_status on profiles;
create trigger profiles_guard_status
  before update on profiles
  for each row execute function guard_profile_status();
