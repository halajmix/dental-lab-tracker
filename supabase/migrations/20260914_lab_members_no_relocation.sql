-- 20260914_lab_members_no_relocation.sql
-- Candidate migration (staging-verified 2026-09-13; NOT applied to production).
--
-- Reproduced cross-tenant escalation: lab_members_update_admin (USING only, so
-- its implicit WITH CHECK equals its USING) is OR-combined with the permissive
-- lab_members_claim_invite policy whose WITH CHECK is (user_id = auth.uid()).
-- For a lab admin's OWN membership row that clause is true, so PATCH
-- {lab_id: <other lab>} passes RLS. can_join_lab(<other lab>) then sees the
-- caller "already on its roster", the profile can be repointed, and my_lab_id()
-- returns the other lab: its cases became readable (3 rows in staging).
-- An invite row (user_id null) cannot be moved this way: the claim policy's
-- USING fails after the move and the admin policy's implicit check fails on
-- the new lab_id (HTTP 403 in staging); a combined lab_id+user_id PATCH is
-- rejected by guard_invite_claim (HTTP 400).
--
-- Fix, defence in depth:
--   1. a BEFORE UPDATE trigger: membership rows never change lab; user_id, once
--      set, never changes (a claim from null is still allowed); service_role
--      (admin-actions set-lab-role / transfer-lab-ownership) is exempt;
--   2. an explicit WITH CHECK on the admin policy so it no longer inherits USING.
-- Legitimate writes preserved: same-lab role/status/email edits by a lab admin,
-- invite claiming (user_id null -> self, pinned by guard_invite_claim),
-- inserts/deletes by lab admins, all service_role operations.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create or replace function guard_lab_member_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('role', true) is distinct from 'service_role' then
    if new.lab_id is distinct from old.lab_id then
      raise exception 'A membership row cannot be moved to another lab.';
    end if;
    if old.user_id is not null and new.user_id is distinct from old.user_id then
      raise exception 'A claimed membership cannot be reassigned to another user.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists lab_members_guard_tenant on lab_members;
create trigger lab_members_guard_tenant
  before update on lab_members
  for each row execute function guard_lab_member_tenant();

alter policy lab_members_update_admin on lab_members
  using (lab_id = my_lab_id() and is_lab_admin())
  with check (lab_id = my_lab_id() and is_lab_admin());
commit;
notify pgrst, 'reload schema';
