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
    body := jsonb_build_object('source', 'pg_cron')
  );
end;
$$ language plpgsql;

-- cron.schedule by name is an upsert in pg_cron — safe to re-run.
select cron.schedule(
  'payment-reminders-monthly',
  '0 6 25 * *',
  $$select private.run_payment_reminders()$$
);
