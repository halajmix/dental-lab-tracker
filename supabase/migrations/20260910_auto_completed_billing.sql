-- Completed, priced digital work goes straight to its completion month's bill.
-- Existing statement links and receipts are retained. No work is billed twice.
begin;
alter table public.labs add column if not exists auto_completed_billing boolean not null default false;

create or replace function public.bill_completed_case(p_case text)
returns void language plpgsql security definer set search_path=public as $$
declare c cases%rowtype; completed timestamptz; sid uuid; bill_month date; billed numeric;
begin
  select * into c from cases where id=p_case for update;
  if c.id is null or not exists(select 1 from labs where id=c.lab_id and auto_completed_billing) then return; end if;
  -- Internal trigger/backfill only. Lab finance guards continue to apply.
  if current_setting('role',true) is distinct from 'service_role' and c.lab_id is distinct from my_lab_id() then return; end if;
  sid:=c.statement_id;
  if sid is null then
    if c.stage_index<3 or c.cancel_status='cancelled' or c.total_price is null or c.total_price<=0 or c.invoice_status='paid' then return; end if;
    select min((e->>'at')::timestamptz) into completed from jsonb_array_elements(coalesce(c.history,'[]')) e
      where e->>'action' in ('advance','created') and e->>'toStage'='3' and nullif(e->>'at','') is not null;
    if completed is null or (completed at time zone 'Asia/Muscat')::date<date '2026-09-01' then return; end if;
    bill_month:=date_trunc('month',completed at time zone 'Asia/Muscat')::date;
    insert into clinic_statements(lab_id,clinic_id,month,total,status)
      values(c.lab_id,c.clinic_id,bill_month,0,'unpaid')
      on conflict(lab_id,clinic_id,month) do update set month=excluded.month returning id into sid;
    update cases set statement_id=sid,invoice_status='issued' where id=c.id;
  else
    -- Lock the shared statement before recomputing it against saved receipts.
    perform 1 from clinic_statements where id=sid and lab_id=c.lab_id for update;
    if not found then raise exception 'Case and statement lab do not match.'; end if;
  end if;
  select coalesce(sum(case when cancel_status='cancelled' then coalesce(cancellation_fee,0) else coalesce(total_price,0) end),0)
    into billed from cases where statement_id=sid;
  update clinic_statements set total=billed where id=sid and total is distinct from billed;
  perform statement_recompute(sid);
end;
$$;
revoke all on function public.bill_completed_case(text) from public,anon,authenticated;
grant execute on function public.bill_completed_case(text) to service_role;

-- Attach before the case is returned to the client, so API responses and
-- realtime events contain the same statement link (no stale nested update).
create or replace function public.prepare_completed_case_bill()
returns trigger language plpgsql security definer set search_path=public as $$
declare completed timestamptz; bill_month date; sid uuid;
begin
  if new.statement_id is not null or new.stage_index<3 or new.cancel_status='cancelled'
    or new.total_price is null or new.total_price<=0 or new.invoice_status='paid' then return new; end if;
  if not exists(select 1 from labs where id=new.lab_id and auto_completed_billing) then return new; end if;
  if current_setting('role',true) is distinct from 'service_role' and new.lab_id is distinct from my_lab_id() then return new; end if;
  select min((e->>'at')::timestamptz) into completed from jsonb_array_elements(coalesce(new.history,'[]')) e
    where e->>'action' in ('advance','created') and e->>'toStage'='3' and nullif(e->>'at','') is not null;
  if completed is null or (completed at time zone 'Asia/Muscat')::date<date '2026-09-01' then return new; end if;
  bill_month:=date_trunc('month',completed at time zone 'Asia/Muscat')::date;
  insert into clinic_statements(lab_id,clinic_id,month,total,status) values(new.lab_id,new.clinic_id,bill_month,0,'unpaid')
    on conflict(lab_id,clinic_id,month) do update set month=excluded.month returning id into sid;
  new.statement_id:=sid;new.invoice_status:='issued';
  return new;
end;
$$;
drop trigger if exists zz_prepare_completed_case_bill on public.cases;
-- Runs after the existing pricing and financial guards.
create trigger zz_prepare_completed_case_bill before insert or update of stage_index,history,total_price,cancel_status,cancellation_fee on public.cases
for each row execute function public.prepare_completed_case_bill();

create or replace function public.auto_bill_completed_case()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='UPDATE' and new.statement_id is not null and new.statement_id is not distinct from old.statement_id then
    if new.total_price is not distinct from old.total_price and new.cancel_status is not distinct from old.cancel_status
       and new.cancellation_fee is not distinct from old.cancellation_fee then return new; end if;
  end if;
  perform bill_completed_case(new.id);
  return new;
end;
$$;
drop trigger if exists auto_bill_completed_case on public.cases;
create trigger auto_bill_completed_case after insert or update of stage_index,history,total_price,cancel_status,cancellation_fee on public.cases
for each row execute function public.auto_bill_completed_case();

update public.labs set auto_completed_billing=true;
alter table public.labs alter column auto_completed_billing set default true;
-- Reconcile only completed unbilled work from the new accounting period.
-- Existing linked statements and pre-September work are not rewritten.
set local role service_role;
do $$ declare r record; begin
  for r in select id from public.cases where stage_index>=3 and statement_id is null
    and invoice_status<>'paid' and cancel_status<>'cancelled' and total_price>0
  loop perform public.bill_completed_case(r.id); end loop;
end $$;
reset role;
commit;
notify pgrst, 'reload schema';
