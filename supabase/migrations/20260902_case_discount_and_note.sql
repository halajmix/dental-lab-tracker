/* =====================================================================
   Phase 64 — lab discounts + an invoice note
   =====================================================================

   discount (numeric) — a flat OMR amount the lab knocks off a case.

   `total_price` REMAINS THE PAYABLE AMOUNT (already net of the discount),
   because clinic_statements sum total_price and nothing recomputes a
   statement's stored total afterwards. Keeping the payable in the column
   it has always been in means statements, aging, exports and reminders
   need no change at all. The gross is derived for display as
   total_price + discount, never stored, so it cannot drift.

   Run this whole file in the Supabase SQL editor. Idempotent.
   ===================================================================== */

alter table cases add column if not exists discount numeric not null default 0;

/* billing_note (text) — a short line the technician types, printed under
   the work items on the receipt and the invoice. Lab-side only; it is NOT
   part of the prescription and never alters the clinical order. */
alter table cases add column if not exists billing_note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cases_discount_nonneg') then
    alter table cases add constraint cases_discount_nonneg check (discount >= 0);
  end if;
end $$;

/* ---- the discount is a LAB field -----------------------------------
   Same rule as total_price: anyone who is not the case's lab gets their
   write to this column silently reverted. Adding it to the existing
   guard is the whole change. */
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
    new.discount := old.discount;
    new.billing_note := old.billing_note;
  end if;
  return new;
end;
$$ language plpgsql;

/* ---- repricing must not wipe the discount --------------------------
   price_case() fires on any prescription/remake/lab_id change and
   rewrites total_price. Without this it would recompute the GROSS and
   silently undo the discount, so the subtraction moves into the engine.
   Everything above the final assignment is unchanged from Phase 17. */
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
  -- NEW: the lab's flat discount comes off last and never goes below zero.
  new.total_price := greatest(0, round(
    base - (base * disc / 100.0) - credit - coalesce(new.discount, 0), 3));
  return new;
exception when others then
  return new;
end;
$$ language plpgsql;

/* ---- make PostgREST see the new columns -----------------------------
   Without this the API can keep serving its cached schema and reject
   writes to discount/billing_note with PGRST204 even though the ALTER
   succeeded — which looks exactly like the value silently vanishing. */
notify pgrst, 'reload schema';

/* ---- proof ---------------------------------------------------------- */
select
  (select count(*) from information_schema.columns
    where table_name = 'cases' and column_name = 'discount') as has_discount,
  (select count(*) from information_schema.columns
    where table_name = 'cases' and column_name = 'billing_note') as has_billing_note,
  (select count(*) from cases where discount > 0)            as discounted_cases;
