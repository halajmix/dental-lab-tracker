-- Device credentials are separate from the browser-readable connection status.
begin;
create table if not exists public.attendance_connections (
  id uuid primary key default gen_random_uuid(),
  lab_id uuid not null references public.labs(id),
  device_name text not null,
  device_serial text not null,
  enabled boolean not null default false,
  employee_ids text[] not null default '{}',
  last_received_at timestamptz,
  created_at timestamptz not null default now(),
  unique(id,lab_id), unique(lab_id,device_serial)
);
create table if not exists public.attendance_device_secrets (
  connection_id uuid primary key references public.attendance_connections(id),
  token_hash text not null unique check(length(token_hash)=64)
);
create table if not exists public.attendance_punches (
  id bigint generated always as identity primary key,
  connection_id uuid not null,
  lab_id uuid not null,
  event_key text not null,
  employee_id text not null check(length(employee_id) between 1 and 64),
  employee_name text not null default '' check(length(employee_name)<=200),
  punched_at timestamptz not null,
  punch_state text not null default 'unspecified' check(length(punch_state)<=64),
  received_at timestamptz not null default now(),
  foreign key(connection_id,lab_id) references public.attendance_connections(id,lab_id),
  unique(connection_id,event_key)
);
create index if not exists attendance_punches_lab_time on public.attendance_punches(lab_id,punched_at desc);
alter table public.attendance_connections enable row level security;
alter table public.attendance_device_secrets enable row level security;
alter table public.attendance_punches enable row level security;
revoke all on public.attendance_device_secrets from anon,authenticated;
revoke all on public.attendance_connections,public.attendance_punches from anon,authenticated;
grant select on public.attendance_connections,public.attendance_punches to authenticated;
grant all on public.attendance_connections,public.attendance_device_secrets,public.attendance_punches to service_role;
grant usage,select on sequence public.attendance_punches_id_seq to service_role;
drop policy if exists attendance_connections_read on public.attendance_connections;
create policy attendance_connections_read on public.attendance_connections for select to authenticated
  using(is_admin() or (lab_id=my_lab_id() and is_lab_admin()));
drop policy if exists attendance_punches_read on public.attendance_punches;
create policy attendance_punches_read on public.attendance_punches for select to authenticated
  using(is_admin() or (lab_id=my_lab_id() and is_lab_admin()));
-- This setup is limited to the lab and terminal inspected in this session.
insert into public.attendance_connections(lab_id,device_name,device_serial,employee_ids)
select id,'Attendance','DS-K1T321MFWX20241227V030920ENGM9635172',array['1','2','3']
from public.labs where id='fb7401df-c26f-4f53-ab5a-a508ec490047'
on conflict(lab_id,device_serial) do nothing;
commit;
notify pgrst,'reload schema';
