-- Apply only after isolated restore/regression verification. No historical backfill.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
alter table public.cases add column if not exists submitted_by_name text;
create or replace function public.sprint1_stamp_submitter() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if TG_OP = 'UPDATE' then
   if new.submitted_by_name is distinct from old.submitted_by_name then
     raise exception 'Submitted by is immutable.';
   end if;
   return new;
 end if;
 -- Independently use the verified actor, never a client-provided identity.
 select name into new.submitted_by_name from public.profiles where id=auth.uid();
 return new;
end $$;
revoke all on function public.sprint1_stamp_submitter() from public;
create trigger sprint1_cases_submitter before insert or update on public.cases
for each row execute function public.sprint1_stamp_submitter();

-- Separate state; no updates to existing profiles, credentials or memberships.
create table public.sprint1_onboarding_settings (
 id boolean primary key default true check(id), enabled boolean not null default false
);
insert into public.sprint1_onboarding_settings(id) values(true);
alter table public.sprint1_onboarding_settings enable row level security;
revoke all on public.sprint1_onboarding_settings from public,anon,authenticated;
create table public.sprint1_onboarding (
 user_id uuid primary key references auth.users(id),
 created_at timestamptz not null default now(),
 dismissed_at timestamptz
);
alter table public.sprint1_onboarding enable row level security;
revoke all on public.sprint1_onboarding from public,anon,authenticated;
-- Only an auth INSERT after installation can enroll someone. Old accounts,
-- even those with no profile or cases, are never enrolled by a first login.
create function public.sprint1_enroll_new_user() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 insert into public.sprint1_onboarding(user_id) values(new.id);
 return new;
exception when others then
 -- Optional guidance must never prevent account creation.
 raise warning 'Sprint 1 onboarding enrollment skipped';
 return new;
end $$;
revoke all on function public.sprint1_enroll_new_user() from public;
create trigger sprint1_auth_new_user after insert on auth.users
for each row execute function public.sprint1_enroll_new_user();
create function public.sprint1_onboarding_pending() returns boolean
language sql stable security definer set search_path=public as $$
 select coalesce((select enabled from sprint1_onboarding_settings where id),false)
 and exists(select 1 from sprint1_onboarding where user_id=auth.uid() and dismissed_at is null);
$$;
create function public.sprint1_dismiss_onboarding() returns void
language sql security definer set search_path=public as $$
 update sprint1_onboarding set dismissed_at=now() where user_id=auth.uid() and dismissed_at is null;
$$;
revoke all on function public.sprint1_onboarding_pending() from public,anon;
revoke all on function public.sprint1_dismiss_onboarding() from public,anon;
grant execute on function public.sprint1_onboarding_pending() to authenticated;
grant execute on function public.sprint1_dismiss_onboarding() to authenticated;

create or replace function public.sync_invited_dentist() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if TG_OP='UPDATE' then
   if new.dentist_name is distinct from old.dentist_name then
     raise exception 'Invite names cannot be changed; revoke and invite again.';
   end if;
   if new.status='revoked' then
     update clinic_dentists set active=false where invitation_id=new.id and user_id is null;
   end if;
   return new;
 end if;
 if new.role <> 'doctor' then return new; end if;
 -- Legacy clients omit the name: preserve their existing invitation path.
 -- Do not invent a clinical identity from an email address.
 if coalesce(trim(new.dentist_name),'') = '' then return new; end if;
 if length(trim(new.dentist_name)) not between 1 and 160 then
   raise exception 'Enter the dentist name (up to 160 characters).';
 end if;
 if new.email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
   raise exception 'Enter a valid dentist email.';
 end if;
 if exists(select 1 from clinic_members m where m.clinic_id=new.clinic_id and lower(trim(m.email))=lower(trim(new.email))) then
   raise exception 'This person already belongs to the clinic. Use the existing dentist or manage their team role.';
 end if;
 insert into clinic_dentists(clinic_id,name,email,invitation_id)
 values(new.clinic_id,trim(new.dentist_name),lower(trim(new.email)),new.id)
 on conflict (clinic_id,lower(email)) do update
 set name=excluded.name,invitation_id=excluded.invitation_id,active=true,user_id=null;
 return new;
end $$;

-- Structural proof inside the same transaction; a failure leaves no partial delta.
do $$ begin
 if not exists(select 1 from pg_trigger where tgname='sprint1_cases_submitter' and tgrelid='public.cases'::regclass and not tgisinternal)
 or not exists(select 1 from pg_trigger where tgname='sprint1_auth_new_user' and tgrelid='auth.users'::regclass and not tgisinternal)
 or (select enabled from public.sprint1_onboarding_settings where id) then
   raise exception 'Sprint 1 installation verification failed';
 end if;
end $$;
notify pgrst, 'reload schema';
commit;
