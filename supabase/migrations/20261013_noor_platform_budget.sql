-- One shared Noor allowance for the entire platform, reset in Oman time.
begin;
create table if not exists public.noor_platform_budget (
  id boolean primary key default true check(id),
  monthly_limit_usd numeric not null default 15 check(monthly_limit_usd>0 and monthly_limit_usd<=15)
);
insert into public.noor_platform_budget(id,monthly_limit_usd) values(true,15) on conflict(id) do update set monthly_limit_usd=15;
create table if not exists public.noor_monthly_usage (
  month_start date primary key,
  spent_usd numeric not null default 0,
  reserved_usd numeric not null default 0,
  legacy_hold_usd numeric not null default 0
);
alter table public.noor_usage_reservations add column if not exists month_start date;
update public.noor_usage_reservations set month_start=date_trunc('month',created_at at time zone 'Asia/Muscat')::date where month_start is null;
-- Import existing metered spend and retain all uncertain reservations.
-- Older unmetered Haiku runs lack cache telemetry: hold up to $0.50 each,
-- conservatively covering its entire 200K context. Unknown models hold $15.
insert into public.noor_monthly_usage(month_start,spent_usd,reserved_usd,legacy_hold_usd)
select m.month_start,
  coalesce(r.spent,0)+coalesce(a.spent,0),coalesce(r.held,0)+coalesce(a.held,0),coalesce(a.held,0)
from (select distinct month_start from noor_usage_reservations union select date_trunc('month',started_at at time zone 'Asia/Muscat')::date from agent_runs) m
left join (select month_start,sum(coalesce(actual_usd,0)) spent,sum(case when settled_at is null then amount_usd else 0 end) held from noor_usage_reservations group by month_start) r using(month_start)
left join (
  select date_trunc('month',started_at at time zone 'Asia/Muscat')::date month_start,
  sum(greatest(estimated_cost_usd,(input_tokens+output_tokens*5+cache_read_tokens*0.1+cache_creation_tokens*1.25)/1000000.0)) spent,
  sum(greatest(0,(case when model like 'claude-haiku-4-5%' then 0.5 else 15 end)-greatest(estimated_cost_usd,(input_tokens+output_tokens*5+cache_read_tokens*0.1+cache_creation_tokens*1.25)/1000000.0))) held
  from agent_runs a where (input_tokens>0 or output_tokens>0) and not exists(select 1 from noor_usage_reservations r where r.trace_id=a.trace_id)
  group by 1
) a using(month_start)
on conflict(month_start) do nothing;
alter table public.noor_platform_budget enable row level security;
alter table public.noor_monthly_usage enable row level security;
revoke all on public.noor_platform_budget,public.noor_monthly_usage from public,anon,authenticated;
grant all on public.noor_platform_budget,public.noor_monthly_usage to service_role;

create or replace function public.noor_platform_budget_status()
returns jsonb language sql security definer set search_path=public as $$
  select jsonb_build_object('month',m.month_day,'limit_usd',b.monthly_limit_usd,
    'spent_usd',coalesce(u.spent_usd,0),'reserved_usd',coalesce(u.reserved_usd,0),
    'remaining_usd',greatest(0,b.monthly_limit_usd-coalesce(u.spent_usd,0)-coalesce(u.reserved_usd,0)))
  from noor_platform_budget b cross join (select date_trunc('month',now() at time zone 'Asia/Muscat')::date as month_day) m
  left join noor_monthly_usage u on u.month_start=m.month_day where b.id=true;
$$;
create or replace function public.noor_reserve_budget(p_lab uuid,p_day date,p_amount numeric,p_trace text)
returns uuid language plpgsql security definer set search_path=public as $$
declare cap numeric; monthly_cap numeric; u noor_daily_usage; m noor_monthly_usage;
  month_day date:=date_trunc('month',now() at time zone 'Asia/Muscat')::date; reservation uuid;
begin
  if p_amount is null or p_amount<=0 then raise exception 'Invalid reservation'; end if;
  select monthly_limit_usd into monthly_cap from noor_platform_budget where id=true;
  if monthly_cap is null then return null; end if;
  insert into noor_monthly_usage(month_start) values(month_day) on conflict do nothing;
  select * into m from noor_monthly_usage where month_start=month_day for update;
  if m.spent_usd+m.reserved_usd+p_amount>monthly_cap then return null; end if;
  select daily_budget_usd into cap from noor_pilot_settings where lab_id=p_lab;
  cap:=coalesce(cap,2);
  insert into noor_daily_usage(lab_id,day) values(p_lab,p_day) on conflict do nothing;
  select * into u from noor_daily_usage where lab_id=p_lab and day=p_day for update;
  if u.paused or u.spent_usd+u.reserved_usd+p_amount>cap then
    update noor_daily_usage set paused=true where lab_id=p_lab and day=p_day;
    return null;
  end if;
  update noor_monthly_usage set reserved_usd=reserved_usd+p_amount where month_start=month_day;
  update noor_daily_usage set reserved_usd=reserved_usd+p_amount where lab_id=p_lab and day=p_day;
  insert into noor_usage_reservations(lab_id,day,month_start,amount_usd,trace_id) values(p_lab,p_day,month_day,p_amount,p_trace) returning id into reservation;
  return reservation;
end $$;
create or replace function public.noor_settle_budget(p_reservation uuid,p_actual numeric)
returns void language plpgsql security definer set search_path=public as $$
declare r noor_usage_reservations;
begin
  if p_actual is null or p_actual<0 then raise exception 'Invalid cost'; end if;
  select * into r from noor_usage_reservations where id=p_reservation for update;
  if r.id is null or r.settled_at is not null then return; end if;
  update noor_monthly_usage set reserved_usd=greatest(legacy_hold_usd,reserved_usd-r.amount_usd),spent_usd=spent_usd+p_actual where month_start=r.month_start;
  update noor_daily_usage set reserved_usd=greatest(0,reserved_usd-r.amount_usd),spent_usd=spent_usd+p_actual where lab_id=r.lab_id and day=r.day;
  update noor_usage_reservations set actual_usd=p_actual,settled_at=now() where id=r.id;
end $$;
revoke all on function public.noor_platform_budget_status() from public,anon,authenticated;
grant execute on function public.noor_platform_budget_status() to service_role;
notify pgrst,'reload schema';
commit;
