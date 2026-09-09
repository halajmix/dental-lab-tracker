-- Deploy pickup-digest first, with Verify JWT OFF. It authenticates with
-- the existing CASE_NOTIFY_SECRET and uses the existing RESEND_API_KEY.
begin;
create table if not exists public.pickup_digest_settings (
  id boolean primary key default true check(id),
  enabled boolean not null default true,
  recipient text not null
);
create table if not exists public.pickup_digest_runs (
  day date primary key,
  payload jsonb not null,
  sent_at timestamptz
);
alter table public.pickup_digest_settings enable row level security;
alter table public.pickup_digest_runs enable row level security;
revoke all on public.pickup_digest_settings, public.pickup_digest_runs from anon, authenticated;
grant select on public.pickup_digest_settings, public.pickup_digest_runs to authenticated;
grant all on public.pickup_digest_settings, public.pickup_digest_runs to service_role;
drop policy if exists pickup_settings_admin on public.pickup_digest_settings;
create policy pickup_settings_admin on public.pickup_digest_settings for select using (is_admin());
drop policy if exists pickup_runs_admin on public.pickup_digest_runs;
create policy pickup_runs_admin on public.pickup_digest_runs for select using (is_admin());
-- Use the sole existing platform admin account, never a clinic/lab recipient.
do $$ begin
  if not exists (select 1 from public.pickup_digest_settings) then
    if (select count(*) from public.profiles p join auth.users u on u.id=p.id where p.role='admin' and u.email is not null) <> 1 then
      raise exception 'Expected one platform admin. Configure the digest recipient explicitly.';
    end if;
    insert into public.pickup_digest_settings(id,recipient)
      select true,u.email from public.profiles p join auth.users u on u.id=p.id where p.role='admin';
  end if;
end $$;
create or replace function private.run_pickup_digest()
returns void language plpgsql security definer set search_path=public,private as $$
declare secret text;
begin
  if not exists(select 1 from public.pickup_digest_settings where enabled) then return; end if;
  select value into secret from private.webhook_config where key='case_notify_secret';
  if coalesce(trim(secret),'')='' then raise exception 'Pickup digest webhook secret is missing'; end if;
  perform net.http_post(
    url:='https://mtxkushcxczjwypwoxdh.supabase.co/functions/v1/pickup-digest',
    headers:=jsonb_build_object('Content-Type','application/json','x-webhook-secret',secret),
    body:='{}'::jsonb,timeout_milliseconds:=15000);
end $$;
revoke all on function private.run_pickup_digest() from public,anon,authenticated;
-- 14:00 UTC = 18:00 Oman, every day. Named scheduling is idempotent.
select cron.schedule('pickup-digest-daily','0 14 * * *',$$select private.run_pickup_digest()$$);
commit;
notify pgrst, 'reload schema';
