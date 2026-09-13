-- 20260914_guard_lab_financial_columns_restore.sql
-- Candidate migration (staging-verified 2026-09-13; NOT applied to production).
--
-- Regression: the 2026-09-02 rewrite of guard_lab_financial_columns() (case
-- discount + billing note) dropped four columns the previous version (schema.sql
-- Phase ~41, lines 2562-2580) reverted for non-lab writers: statement_id,
-- invoice_number, price_overridden, lab_shade. Reproduced in staging: a clinic
-- owner could PATCH invoice_number / price_overridden / lab_shade / statement_id
-- on their own case through the API (HTTP 200, values changed).
--
-- This restores the union of both versions. Behaviour preserved: service_role
-- writes are untouched; the case's own lab (new.lab_id = my_lab_id()) keeps full
-- write access; discount and billing_note stay protected; statement automation
-- (bill_completed_case et al.) runs as service_role or as the lab.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create or replace function guard_lab_financial_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('role', true) is distinct from 'service_role'
     and (new.lab_id is null or new.lab_id is distinct from my_lab_id()) then
    new.assigned_tech_id := old.assigned_tech_id;
    new.invoice_status   := old.invoice_status;
    new.base_fee         := old.base_fee;
    new.adjustments      := old.adjustments;
    new.total_price      := old.total_price;
    new.discount         := old.discount;
    new.billing_note     := old.billing_note;
    new.statement_id     := old.statement_id;
    new.invoice_number   := old.invoice_number;
    new.price_overridden := old.price_overridden;
    new.lab_shade        := old.lab_shade;
  end if;
  return new;
end;
$$;
-- structural proof: the trigger still binds this function
do $$ begin
  if not exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
                 where t.tgrelid = 'public.cases'::regclass and p.proname = 'guard_lab_financial_columns' and not t.tgisinternal) then
    raise exception 'cases financial guard trigger is missing';
  end if;
end $$;
commit;
notify pgrst, 'reload schema';
