-- Apply manually in the Supabase SQL editor. No bills, expenses or payments
-- are deleted. Enables the history workspace for the requested lab only.
begin;

alter table public.labs add column if not exists finance_history_before date;
update public.labs set finance_history_before = date '2026-08-19'
where id = 'fb7401df-c26f-4f53-ab5a-a508ec490047';

alter table public.lab_payments add column if not exists voided_at timestamptz;

create table if not exists public.statement_payment_corrections (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references public.clinic_statements(id),
  lab_id uuid not null references public.labs(id),
  actor_id uuid not null,
  previous_status text not null,
  reason text not null,
  voided_payment_ids uuid[] not null default '{}',
  at timestamptz not null default now()
);
alter table public.statement_payment_corrections enable row level security;
revoke all on public.statement_payment_corrections from anon, authenticated;
grant select on public.statement_payment_corrections to authenticated;
drop policy if exists corrections_select on public.statement_payment_corrections;
create policy corrections_select on public.statement_payment_corrections for select
using (is_admin() or (lab_id = my_lab_id() and is_lab_finance()));

-- Keep the existing lab boundary. Only configured labs gain full finance
-- history for accountants; unrelated labs retain the rolling window.
drop policy if exists statements_select on public.clinic_statements;
create policy statements_select on public.clinic_statements for select using (
  is_admin() or (lab_id = my_lab_id() and (is_lab_admin() or
    (is_lab_accountant() and (month >= accountant_cutoff() or status <> 'paid' or
      exists (select 1 from public.labs l where l.id = lab_id and l.finance_history_before is not null)))))
);
drop policy if exists payments_select on public.lab_payments;
create policy payments_select on public.lab_payments for select using (
  voided_at is null and (is_admin() or (lab_id = my_lab_id() and (is_lab_admin() or
    (is_lab_accountant() and (received_date >= accountant_cutoff() or
      exists (select 1 from public.labs l where l.id = lab_id and l.finance_history_before is not null))))))
);
drop policy if exists expenses_select on public.lab_expenses;
create policy expenses_select on public.lab_expenses for select using (
  is_admin() or (lab_id = my_lab_id() and (is_lab_admin() or
    (is_lab_accountant() and (expense_date >= accountant_cutoff() or
      exists (select 1 from public.labs l where l.id = lab_id and l.finance_history_before is not null)))))
);

-- Serialize payments and corrections on the statement. Also reject a payment
-- linked to another lab's bill, even when posted directly through the API.
create or replace function public.guard_statement_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare target clinic_statements%rowtype;
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
  end if;
  return new;
end;
$$;
drop trigger if exists guard_statement_payment on public.lab_payments;
create trigger guard_statement_payment before insert or update on public.lab_payments
for each row execute function public.guard_statement_payment();

create or replace function public.statement_recompute(p_sid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_total numeric; v_paid numeric; v_status text;
begin
  select total into v_total from clinic_statements where id = p_sid for update;
  if v_total is null then return; end if;
  select coalesce(sum(amount), 0) into v_paid from lab_payments where statement_id = p_sid and voided_at is null;
  v_status := case when v_paid <= 0 then 'unpaid'
    when v_paid >= v_total and v_total > 0 then 'paid' else 'partial' end;
  update clinic_statements set status = v_status where id = p_sid and status is distinct from v_status;
  if v_status = 'paid' then
    update cases set invoice_status = 'paid' where statement_id = p_sid and invoice_status = 'issued';
  end if;
end;
$$;
-- Internal helper: otherwise any authenticated/anonymous caller could use it
-- to reset a historical settled bill that has no payment records.
revoke execute on function public.statement_recompute(uuid) from public, anon, authenticated;

create or replace function public.reopen_clinic_statement(p_statement uuid, p_expected_status text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare st clinic_statements%rowtype; payment_ids uuid[];
begin
  if auth.uid() is null or not coalesce(is_lab_finance(), false) then
    raise exception 'Only the lab admin or accountant can correct payments.';
  end if;
  select * into st from clinic_statements where id = p_statement and lab_id = my_lab_id() for update;
  if st.id is null then raise exception 'Statement not found or access denied.'; end if;
  if st.status is distinct from p_expected_status then raise exception 'This statement changed. Refresh and try again.'; end if;
  if st.status not in ('paid', 'partial') then raise exception 'This statement is already unpaid.'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 or length(p_reason) > 500 then
    raise exception 'Enter a correction reason between 3 and 500 characters.';
  end if;
  select coalesce(array_agg(id), '{}'::uuid[]) into payment_ids
    from lab_payments where statement_id = st.id and voided_at is null;
  insert into statement_payment_corrections(statement_id, lab_id, actor_id, previous_status, reason, voided_payment_ids)
    values (st.id, st.lab_id, auth.uid(), st.status, trim(p_reason), payment_ids);
  perform set_config('drcrown.payment_correction', st.id::text, true);
  update lab_payments set voided_at = now() where id = any(payment_ids);
  perform set_config('drcrown.payment_correction', '', true);
  update clinic_statements set status = 'unpaid' where id = st.id;
  update cases set invoice_status = 'issued' where statement_id = st.id and invoice_status = 'paid';
end;
$$;
revoke all on function public.reopen_clinic_statement(uuid, text, text) from public, anon;
grant execute on function public.reopen_clinic_statement(uuid, text, text) to authenticated;

commit;
notify pgrst, 'reload schema';
