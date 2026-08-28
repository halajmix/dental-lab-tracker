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

/* --------------------------------------------------------------------- */
/*  Phase 60 — persisted Rx drafts with a 1-day lifetime                 */
/*                                                                       */
/*  The minimize-to-pill draft (3b0fefe) only lived in React state — a   */
/*  reload or sign-out lost it. Now closing a started prescription       */
/*  upserts the form state here (one draft per user, personal to the     */
/*  author), and the app rehydrates it on next load. The 1-day limit is  */
/*  enforced twice: the select policy hides drafts older than 24h from   */
/*  the moment they expire, and a nightly pg_cron janitor deletes them.  */
/*  updated_at is stamped server-side (client clocks don't get a vote),  */
/*  and every save restarts the clock.                                   */
/* --------------------------------------------------------------------- */

create table if not exists rx_drafts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  clinic_id uuid,
  patient_name text not null default '',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table rx_drafts enable row level security;

-- Freshness lives in the read policy: an expired draft is already
-- invisible before the janitor gets to it.
drop policy if exists "rx_drafts_select" on rx_drafts;
create policy "rx_drafts_select" on rx_drafts for select
  using (user_id = auth.uid() and updated_at > now() - interval '1 day');

drop policy if exists "rx_drafts_insert" on rx_drafts;
create policy "rx_drafts_insert" on rx_drafts for insert
  with check (user_id = auth.uid());

-- Update stays possible on an expired row on purpose — the upsert that
-- replaces yesterday's dead draft with today's new one is an UPDATE.
drop policy if exists "rx_drafts_update" on rx_drafts;
create policy "rx_drafts_update" on rx_drafts for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "rx_drafts_delete" on rx_drafts;
create policy "rx_drafts_delete" on rx_drafts for delete
  using (user_id = auth.uid());

create or replace function rx_drafts_touch()
returns trigger
as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists rx_drafts_touch on rx_drafts;
create trigger rx_drafts_touch
  before insert or update on rx_drafts
  for each row execute function rx_drafts_touch();

-- Saving goes through a definer RPC: the freshness SELECT policy makes an
-- EXPIRED row unreachable even to its owner (RLS applies SELECT visibility
-- to upsert-conflicts and delete targets alike — verified empirically), so
-- a plain client upsert would bounce off yesterday's dead draft. The RPC
-- replaces whatever is there; the janitor reaps what nobody replaces.
create or replace function save_rx_draft(p_clinic uuid, p_patient text, p_payload jsonb)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to save a draft.';
  end if;
  insert into rx_drafts (user_id, clinic_id, patient_name, payload)
  values (auth.uid(), p_clinic, coalesce(p_patient, ''), coalesce(p_payload, '{}'::jsonb))
  on conflict (user_id) do update
    set clinic_id = excluded.clinic_id,
        patient_name = excluded.patient_name,
        payload = excluded.payload;
end;
$$;

-- Nightly janitor, 01:30 Muscat. cron.schedule by name is an upsert in
-- pg_cron — safe to re-run.
select cron.schedule(
  'rx-drafts-cleanup',
  '30 21 * * *',
  $job$ delete from rx_drafts where updated_at < now() - interval '1 day' $job$
);

/* --------------------------------------------------------------------- */
/*  Phase 61 — real STL + PDF uploads (desktop and phone-QR)             */
/*                                                                       */
/*  Scans were metadata-only since day one ("STL real uploads" open      */
/*  item). They now upload to the same private case-photos bucket as     */
/*  clinical photos — same folders, same Phase 50 signed-URL rules, and  */
/*  can_read_case_photo() already matches ANY prescription.files entry   */
/*  by url regardless of kind, so no policy changes are needed. The      */
/*  only server-side change is the bucket contract: Phase 50 pinned it   */
/*  to images at 10 MB, which would reject every STL/PDF. Both upload    */
/*  paths (desktop client and the mobile-upload Edge Function) send a    */
/*  normalized contentType — model/stl or application/pdf — so the      */
/*  allowlist stays exact, no octet-stream catch-all. 50 MB covers real  */
/*  intraoral scanner exports; per-kind caps (photos 10 MB, scans 50 MB) */
/*  are enforced in both clients and in the Edge Function.               */
/* --------------------------------------------------------------------- */

update storage.buckets
   set file_size_limit = 52428800,
       allowed_mime_types = array[
         'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
         'model/stl', 'application/pdf'
       ]
 where id = 'case-photos';
