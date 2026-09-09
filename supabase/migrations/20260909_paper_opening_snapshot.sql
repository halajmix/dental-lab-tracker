-- Owner confirmed that the imported pending sheet contains all unpaid PAPER
-- work through 31 August, excluding Dr-Crown digital cases. Preserve every
-- historical bill; the app excludes covered paper bills from receivables.
begin;
alter table public.labs add column if not exists paper_balance_as_of date;
update public.labs set paper_balance_as_of = date '2026-08-31'
where id = 'fb7401df-c26f-4f53-ab5a-a508ec490047';

-- Block duplicate collection through either old clients or direct API calls.
-- Existing finance permissions are unchanged. Voiding a mistaken receipt
-- remains possible; no historical payments or statements are deleted.
create or replace function public.guard_statement_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare target clinic_statements%rowtype; cutoff date;
begin
  if (tg_op = 'INSERT' and new.voided_at is not null) or
     (tg_op = 'UPDATE' and new.voided_at is distinct from old.voided_at and
      current_setting('drcrown.payment_correction', true) is distinct from new.statement_id::text) then
    raise exception 'Use the payment correction action to void a payment.';
  end if;
  if tg_op = 'UPDATE' and (new.statement_id is distinct from old.statement_id or new.lab_id is distinct from old.lab_id) then
    raise exception 'A payment cannot be moved to another statement or lab.';
  end if;
  if new.statement_id is not null then
    select * into target from clinic_statements where id = new.statement_id for update;
    if target.id is null or target.lab_id is distinct from new.lab_id or target.clinic_id is distinct from new.clinic_id then
      raise exception 'Payment and statement must belong to the same lab and clinic.';
    end if;
    select paper_balance_as_of into cutoff from labs where id = target.lab_id;
    if cutoff is not null and target.clinic_id is null and target.kind <> 'opening_balance'
       and target.month <= date_trunc('month', cutoff)::date and new.voided_at is null then
      raise exception 'This paper bill is included in the opening balance. Record payment against the opening balance instead.';
    end if;
  end if;
  return new;
end;
$$;
commit;
notify pgrst, 'reload schema';
