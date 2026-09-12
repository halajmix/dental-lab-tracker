-- Owner-applied. No invitations are sent by the backfill.
begin;
alter table public.clinic_invitations add column if not exists dentist_name text not null default '';
create table if not exists public.clinic_dentists (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  email text not null,
  user_id uuid references auth.users(id) on delete set null,
  invitation_id uuid references public.clinic_invitations(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists clinic_dentists_email_key on public.clinic_dentists(clinic_id,lower(email));
create unique index if not exists clinic_dentists_user_key on public.clinic_dentists(clinic_id,user_id) where user_id is not null;
alter table public.clinic_dentists enable row level security;
revoke all on public.clinic_dentists from anon, authenticated;
grant select on public.clinic_dentists to authenticated;
grant all on public.clinic_dentists to service_role;
drop policy if exists clinic_dentists_select on public.clinic_dentists;
create policy clinic_dentists_select on public.clinic_dentists for select
 using (clinic_id in (select my_clinic_ids()) or is_admin());

-- Existing doctors and the existing named clinic owner remain selectable.
insert into public.clinic_dentists(clinic_id,name,email,user_id)
select m.clinic_id,coalesce(nullif(trim(p.name),''),nullif(trim(c.dentist),''),'Dentist'),lower(trim(u.email)),m.user_id
from public.clinic_members m join public.profiles p on p.id=m.user_id
join public.clinics c on c.id=m.clinic_id join auth.users u on u.id=m.user_id
where (m.role='doctor' or (m.user_id=c.owner_id and nullif(trim(c.dentist),'') is not null))
 and nullif(trim(u.email),'') is not null
on conflict do nothing;

-- A table-specific trigger: invitation and roster are saved atomically.
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
revoke all on function public.sync_invited_dentist() from public;
drop trigger if exists clinic_invitations_sync_dentist on public.clinic_invitations;
create trigger clinic_invitations_sync_dentist after insert or update on public.clinic_invitations
for each row execute function public.sync_invited_dentist();

-- Membership acceptance links the stable roster identity, including earlier cases.
-- Removal or changing away from doctor disables the identity for future submissions.
create or replace function public.sync_member_dentist() returns trigger
language plpgsql security definer set search_path=public as $$
declare member_name text;
begin
 if TG_OP='DELETE' then
   update clinic_dentists set active=false where clinic_id=old.clinic_id and user_id=old.user_id;
   return old;
 end if;
 if new.role='doctor' or exists(select 1 from clinics where id=new.clinic_id and owner_id=new.user_id and nullif(trim(dentist),'') is not null) then
   select coalesce(nullif(trim(name),''),'Dentist') into member_name from profiles where id=new.user_id;
   if new.user_id=clinic_owner(new.clinic_id) then
     select coalesce(nullif(trim(dentist),''),member_name) into member_name from clinics where id=new.clinic_id;
   end if;
   insert into clinic_dentists(clinic_id,name,email,user_id)
   values(new.clinic_id,coalesce(member_name,'Dentist'),lower(trim(new.email)),new.user_id)
   on conflict (clinic_id,lower(email)) do update set user_id=excluded.user_id,active=true;
 else
   update clinic_dentists set active=(new.user_id=clinic_owner(new.clinic_id))
   where clinic_id=new.clinic_id and user_id=new.user_id;
 end if;
 return new;
end $$;
revoke all on function public.sync_member_dentist() from public;
drop trigger if exists clinic_members_sync_dentist on public.clinic_members;
create trigger clinic_members_sync_dentist after insert or update or delete on public.clinic_members
for each row execute function public.sync_member_dentist();

alter table public.cases add column if not exists treating_dentist_id uuid references public.clinic_dentists(id);
alter table public.cases add column if not exists treating_dentist_name text not null default '';
create index if not exists cases_treating_dentist_idx on public.cases(treating_dentist_id);
-- Never rewrite historical attribution. New submissions get a validated name snapshot.
create or replace function public.guard_case_dentist() returns trigger
language plpgsql security definer set search_path=public as $$
declare d clinic_dentists%rowtype; caller_role text;
begin
 if TG_OP='UPDATE' then
   if new.treating_dentist_id is distinct from old.treating_dentist_id
      or new.treating_dentist_name is distinct from old.treating_dentist_name
      or new.created_by is distinct from old.created_by
      or new.clinic_id is distinct from old.clinic_id then
     if current_setting('role',true) <> 'service_role' then
       raise exception 'The submitting user, dentist and clinic cannot be changed.';
     end if;
   end if;
   return new;
 end if;
 caller_role := my_clinic_role(new.clinic_id);
 if new.treating_dentist_id is null then
   if caller_role='receptionist' then raise exception 'Select a treating dentist.'; end if;
   -- Old clients and doctors submitting their own work continue to work.
   select * into d from clinic_dentists where clinic_id=new.clinic_id and user_id=auth.uid() and active;
   new.treating_dentist_id := d.id;
   new.treating_dentist_name := coalesce(d.name,'');
   return new;
 end if;
 select * into d from clinic_dentists where id=new.treating_dentist_id and clinic_id=new.clinic_id and active;
 if not found then raise exception 'Select an active dentist from the sending clinic.'; end if;
 if d.user_id is not null and not exists(select 1 from profiles where id=d.user_id and status='active') then
   raise exception 'This dentist account is inactive.';
 end if;
 if current_setting('role',true) <> 'service_role' then
   if caller_role is null or caller_role not in ('admin','receptionist','doctor') then
     raise exception 'You cannot submit for this clinic.';
   end if;
   if caller_role='doctor' and d.user_id is distinct from auth.uid() then
     raise exception 'Doctors may only submit their own prescriptions.';
   end if;
 end if;
 new.treating_dentist_name := d.name;
 return new;
end $$;
revoke all on function public.guard_case_dentist() from public;
drop trigger if exists cases_guard_dentist on public.cases;
create trigger cases_guard_dentist before insert or update on public.cases
for each row execute function public.guard_case_dentist();

drop policy if exists cases_insert_own_clinic on public.cases;
create policy cases_insert_own_clinic on public.cases for insert with check (
 has_clinic_role(clinic_id,array['admin','doctor','receptionist'])
 and (lab_id is null or clinic_can_use_lab(clinic_id,lab_id))
);

-- Keep the original two-argument helper for legacy callers. The new overload
-- lets the selected dentist see delegated work without impersonating its submitter.
create or replace function public.clinic_case_visible(p_clinic uuid,p_created_by uuid,p_dentist uuid)
returns boolean language sql security definer stable set search_path=public as $$
 select clinic_case_visible(p_clinic,p_created_by) or (
   has_clinic_role(p_clinic,array['doctor']) and exists(
     select 1 from clinic_dentists d where d.id=p_dentist and d.clinic_id=p_clinic
       and d.user_id=auth.uid() and d.active
   )
 );
$$;

drop policy if exists "cases_select" on cases;
create policy "cases_select" on cases for select
  using (
    clinic_case_visible(clinic_id, created_by, treating_dentist_id)
    or lab_id = my_lab_id()
  );

drop policy if exists "cases_update" on cases;
create policy "cases_update" on cases for update
  using (
    clinic_case_visible(clinic_id, created_by, treating_dentist_id)
    or (lab_id = my_lab_id() and lab_write_allowed())
  );

drop policy if exists "case_notes_select" on case_notes;
create policy "case_notes_select" on case_notes for select
  using (
    exists (
      select 1 from cases c
      where c.id = case_notes.case_id
        and (clinic_case_visible(c.clinic_id, c.created_by, c.treating_dentist_id)
             or c.lab_id = my_lab_id())
    )
  );

drop policy if exists "case_notes_insert" on case_notes;
create policy "case_notes_insert" on case_notes for insert
  with check (
    exists (
      select 1 from cases c
      where c.id = case_notes.case_id
        and (clinic_case_visible(c.clinic_id, c.created_by, c.treating_dentist_id)
             or (c.lab_id = my_lab_id() and lab_write_allowed()))
    )
  );

drop policy if exists "case_rounds_select" on case_rounds;
create policy "case_rounds_select" on case_rounds for select
  using (exists (
    select 1 from cases c where c.id = case_rounds.parent_case_id
      and (clinic_case_visible(c.clinic_id, c.created_by, c.treating_dentist_id) or c.lab_id = my_lab_id())
  ));

drop policy if exists "case_rounds_insert" on case_rounds;
create policy "case_rounds_insert" on case_rounds for insert
  with check (exists (
    select 1 from cases c where c.id = case_rounds.parent_case_id
      and (clinic_case_visible(c.clinic_id, c.created_by, c.treating_dentist_id) or c.lab_id = my_lab_id())
  ));

drop policy if exists "case_rounds_update" on case_rounds;
create policy "case_rounds_update" on case_rounds for update
  using (exists (
    select 1 from cases c where c.id = case_rounds.parent_case_id
      and (clinic_case_visible(c.clinic_id, c.created_by, c.treating_dentist_id) or c.lab_id = my_lab_id())
  ));

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
     where (clinic_case_visible(c.clinic_id, c.created_by, c.treating_dentist_id)
            or c.lab_id = my_lab_id())
       and f->>'url' like '%' || object_name
  )
  or exists (
    select 1
      from case_rounds r
      join cases c on c.id = r.parent_case_id,
           lateral jsonb_array_elements(coalesce(r.attachments, '[]'::jsonb)) a
     where (clinic_case_visible(c.clinic_id, c.created_by, c.treating_dentist_id)
            or c.lab_id = my_lab_id())
       and a->>'url' like '%' || object_name
  );
$$;

drop policy if exists case_clarifications_select on public.case_clarifications;
create policy case_clarifications_select on public.case_clarifications for select
  using (exists (select 1 from public.cases c where c.id = case_clarifications.case_id
                   and (clinic_case_visible(c.clinic_id, c.created_by, c.treating_dentist_id) or c.lab_id = my_lab_id() or is_admin())));
drop policy if exists case_clarifications_answer on public.case_clarifications;
create policy case_clarifications_answer on public.case_clarifications for update
  using  (exists (select 1 from public.cases c where c.id = case_clarifications.case_id
                    and clinic_case_visible(c.clinic_id, c.created_by, c.treating_dentist_id)))
  with check (status in ('open','answered'));

-- Flags: lab sees all of its cases' flags; clinic sees only clinic-visible ones.
drop policy if exists case_flags_select on public.case_flags;
create policy case_flags_select on public.case_flags for select
  using (exists (select 1 from public.cases c where c.id = case_flags.case_id
                   and ((c.lab_id = my_lab_id())
                        or (clinic_case_visible(c.clinic_id, c.created_by, c.treating_dentist_id) and case_flags.visible_to in ('clinic','both'))
                        or is_admin())));


-- Structural self-check before committing the owner-applied migration.
do $$ begin
 if not exists(select 1 from pg_trigger where tgname='cases_guard_dentist' and not tgisinternal)
 or not exists(select 1 from pg_trigger where tgname='clinic_invitations_sync_dentist' and not tgisinternal) then
   raise exception 'Dentist delegation triggers were not installed';
 end if;
end $$;
notify pgrst, 'reload schema';
commit;
