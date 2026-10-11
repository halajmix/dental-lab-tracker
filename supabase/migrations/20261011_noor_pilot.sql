-- Additive pilot controls. Service role owns settings and usage; no patient data.
begin;
alter table public.labs add column if not exists turnaround_by_clinic jsonb not null default '{}';
create table if not exists public.noor_pilot_settings (
  lab_id uuid primary key references public.labs(id) on delete cascade,
  role_modes jsonb not null default '{}',
  emails_enabled boolean not null default false,
  default_tat_days integer not null default 6 check(default_tat_days between 1 and 90),
  clinic_tats jsonb not null default '{}',
  daily_budget_usd numeric not null default 2 check(daily_budget_usd > 0 and daily_budget_usd <= 100),
  updated_at timestamptz not null default now()
);
create table if not exists public.noor_daily_usage (
  lab_id uuid references public.labs(id) on delete cascade,
  day date not null,
  spent_usd numeric not null default 0,
  reserved_usd numeric not null default 0,
  paused boolean not null default false,
  primary key(lab_id, day)
);
create table if not exists public.noor_usage_reservations (
  id uuid primary key default gen_random_uuid(),
  lab_id uuid not null references public.labs(id) on delete cascade,
  day date not null,
  amount_usd numeric not null,
  actual_usd numeric,
  trace_id text not null,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create table if not exists public.noor_feedback (
  trace_id text not null references public.agent_runs(trace_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating text not null check(rating in ('helpful','wrong')),
  created_at timestamptz not null default now(),
  primary key(trace_id,user_id)
);
alter table public.agent_runs add column if not exists cache_read_tokens integer not null default 0,
  add column if not exists cache_creation_tokens integer not null default 0,
  add column if not exists estimated_cost_usd numeric not null default 0,
  add column if not exists fallback_reason text;
alter table public.noor_pilot_settings enable row level security;
alter table public.noor_daily_usage enable row level security;
alter table public.noor_usage_reservations enable row level security;
alter table public.noor_feedback enable row level security;
revoke all on public.noor_pilot_settings,public.noor_daily_usage,public.noor_usage_reservations,public.noor_feedback from anon,authenticated;
grant all on public.noor_pilot_settings,public.noor_daily_usage,public.noor_usage_reservations,public.noor_feedback to service_role;

create or replace function public.noor_take_rate(p_scope text,p_start timestamptz,p_limit integer)
returns boolean language plpgsql security definer set search_path=public as $$
declare n integer;
begin
  insert into noor_rate_limits(scope,window_start,count) values(p_scope,p_start,1)
  on conflict(scope,window_start) do update set count=noor_rate_limits.count+1
  returning count into n;
  return n<=p_limit;
end $$;

create or replace function public.noor_reserve_budget(p_lab uuid,p_day date,p_amount numeric,p_trace text)
returns uuid language plpgsql security definer set search_path=public as $$
declare cap numeric; u noor_daily_usage; reservation uuid;
begin
  if p_amount<=0 then raise exception 'Invalid reservation'; end if;
  select daily_budget_usd into cap from noor_pilot_settings where lab_id=p_lab;
  if cap is null then return null; end if;
  insert into noor_daily_usage(lab_id,day) values(p_lab,p_day) on conflict do nothing;
  select * into u from noor_daily_usage where lab_id=p_lab and day=p_day for update;
  if u.paused or u.spent_usd+u.reserved_usd+p_amount>cap then
    update noor_daily_usage set paused=true where lab_id=p_lab and day=p_day;
    return null;
  end if;
  update noor_daily_usage set reserved_usd=reserved_usd+p_amount where lab_id=p_lab and day=p_day;
  insert into noor_usage_reservations(lab_id,day,amount_usd,trace_id) values(p_lab,p_day,p_amount,p_trace) returning id into reservation;
  return reservation;
end $$;

create or replace function public.noor_settle_budget(p_reservation uuid,p_actual numeric)
returns void language plpgsql security definer set search_path=public as $$
declare r noor_usage_reservations;
begin
  if p_actual<0 then raise exception 'Invalid cost'; end if;
  select * into r from noor_usage_reservations where id=p_reservation for update;
  if r.id is null or r.settled_at is not null then return; end if;
  update noor_daily_usage set reserved_usd=greatest(0,reserved_usd-r.amount_usd),spent_usd=spent_usd+p_actual
    where lab_id=r.lab_id and day=r.day;
  update noor_usage_reservations set actual_usd=p_actual,settled_at=now() where id=r.id;
end $$;
revoke all on function public.noor_take_rate(text,timestamptz,integer),public.noor_reserve_budget(uuid,date,numeric,text),public.noor_settle_budget(uuid,numeric) from public,anon,authenticated;
grant execute on function public.noor_take_rate(text,timestamptz,integer),public.noor_reserve_budget(uuid,date,numeric,text),public.noor_settle_budget(uuid,numeric) to service_role;
create unique index if not exists noor_open_escalation_unique on public.escalations(case_id,category) where case_id is not null and status in ('open','acknowledged');
notify pgrst,'reload schema';
commit;
