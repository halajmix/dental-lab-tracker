-- Clinic multi-tenancy, RBAC, and (Phases 57-58, forthcoming) invitations +
-- super-admin lab visibility. Mirrors supabase/schema.sql Phase 56+, which
-- is the canonical, SQL-editor-pasteable home of all schema in this repo.

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
