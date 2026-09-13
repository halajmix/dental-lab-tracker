-- 20260914_tenant_platform_columns_guard.sql
-- Candidate migration (staging-verified 2026-09-13; NOT applied to production).
--
-- Reproduced in staging through the API with an ordinary owner JWT:
--   clinics: owner PATCH status='pending'/'active' and is_exclusive=true -> 200, stored
--            (self-activation bypasses the Phase 30 super-admin approval gate;
--             is_exclusive is documented as a super-admin toggle, schema.sql ~5151)
--   labs:    owner PATCH status, is_public, noor_enabled, work_ledger_enabled,
--            auto_completed_billing, finance_history_before -> 200, stored
--            (platform / owner-applied flags: noor_enabled gates the AI agent,
--             the finance flags change billing behaviour, status is the tenant switch)
-- Cause: clinics_update_own and labs_update_owner_or_creator are USING-only
-- policies (implicit WITH CHECK = USING), and no trigger pins these columns.
--
-- Fix: BEFORE UPDATE triggers that silently revert the platform columns unless
-- the writer is service_role (admin-actions) or a platform admin (is_admin(),
-- which is how the super-admin console's setClinicExclusive / setLabPublic and
-- the status toggles work). Silent revert (not RAISE) mirrors profiles_guard_status
-- so a client that PATCHes a whole object keeps working. Legitimate writes kept:
-- clinic profile edits (name, address, contact, licence, dentist, language),
-- lab settings (contact, tat, procedure_tats, governorate, wilayat, notify_email,
-- payment_reminders_enabled, language, timezone, escalation_user_id, brief_hour_local),
-- claiming an unclaimed lab (owner_id null -> caller) and the creating clinic's
-- placeholder-lab edits. paper_balance_as_of is included because it is an
-- owner-applied finance cutoff.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create or replace function guard_clinic_platform_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('role', true) is distinct from 'service_role' and not is_admin() then
    new.status       := old.status;
    new.is_exclusive := old.is_exclusive;
    if old.owner_id is not null then
      new.owner_id := old.owner_id;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists clinics_guard_platform_columns on clinics;
create trigger clinics_guard_platform_columns
  before update on clinics
  for each row execute function guard_clinic_platform_columns();

create or replace function guard_lab_platform_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('role', true) is distinct from 'service_role' and not is_admin() then
    new.status                 := old.status;
    new.is_public              := old.is_public;
    new.noor_enabled           := old.noor_enabled;
    new.work_ledger_enabled    := old.work_ledger_enabled;
    new.auto_completed_billing := old.auto_completed_billing;
    new.finance_history_before := old.finance_history_before;
    new.paper_balance_as_of    := old.paper_balance_as_of;
    if old.owner_id is not null then
      new.owner_id := old.owner_id;
    end if;
    new.created_by_clinic_id   := old.created_by_clinic_id;
  end if;
  return new;
end;
$$;
drop trigger if exists labs_guard_platform_columns on labs;
create trigger labs_guard_platform_columns
  before update on labs
  for each row execute function guard_lab_platform_columns();
commit;
notify pgrst, 'reload schema';
