-- Summary-only mail. No patient or individual user fields leave the database.
begin;
set local lock_timeout='5s'; set local statement_timeout='30s';
create table public.platform_digest_settings(id boolean primary key default true check(id),enabled boolean not null default false,recipient text not null,starts_at timestamptz not null default now());
insert into public.platform_digest_settings(recipient) select recipient from public.registration_review_settings where id;
create table public.platform_digest_runs(id text primary key,payload jsonb not null,recipient text not null,first_attempt_at timestamptz not null default now(),lease_until timestamptz,attempts integer not null default 0,sent_at timestamptz,last_error text);
alter table public.platform_digest_settings enable row level security;
alter table public.platform_digest_runs enable row level security;
revoke all on public.platform_digest_settings,public.platform_digest_runs from public,anon,authenticated;
grant all on public.platform_digest_settings,public.platform_digest_runs to service_role;
create function public.platform_activity_summary(p_start timestamptz,p_end timestamptz) returns jsonb
language sql stable security definer set search_path=public as $$
select jsonb_build_object(
 'window_start',p_start,'window_end',p_end,
 'new_users',(select count(*) from auth.users where created_at>=p_start and created_at<p_end),
 'new_profiles',(select count(*) from profiles where created_at>=p_start and created_at<p_end),
 'new_clinics',(select count(*) from clinics where created_at>=p_start and created_at<p_end),
 'new_labs',(select count(*) from labs where created_at>=p_start and created_at<p_end),
 'cases_sent',(select count(*) from cases where created_at>=p_start and created_at<p_end and lab_id is not null),
 'cases_updated',(select count(*) from cases where updated_at>=p_start and updated_at<p_end),
 'followups_created',(select count(*) from case_rounds where created_at>=p_start and created_at<p_end),
 'invites_created',(select count(*) from clinic_invitations where created_at>=p_start and created_at<p_end),
 'active_users',(select count(distinct user_id) from login_events where created_at>=p_start and created_at<p_end),
 'signins',(select count(*) from login_events where created_at>=p_start and created_at<p_end and action='sign-in'),
 'stage_advances',(select count(*) from login_events where created_at>=p_start and created_at<p_end and action='advanced case stage'),
 'stage_reversals',(select count(*) from login_events where created_at>=p_start and created_at<p_end and action='reverted case stage'),
 'print_views',(select count(*) from login_events where created_at>=p_start and created_at<p_end and action in ('opened Rx print sheet','opened invoice print sheet','opened 80mm receipt sheet')),
 'other_activity',(select count(*) from login_events where created_at>=p_start and created_at<p_end and action not in ('sign-in','advanced case stage','reverted case stage','opened Rx print sheet','opened invoice print sheet','opened 80mm receipt sheet')),
 'client_errors',(select count(*) from client_errors where at>=p_start and at<p_end),
 'users_with_errors',(select count(distinct user_id) from client_errors where at>=p_start and at<p_end),
 'error_categories',(select coalesce(jsonb_object_agg(category,n),'{}'::jsonb) from (
 select case when message ilike '%print%' then 'Printing' when message ~* '(fetch|network|load failed|timeout)' then 'Connection / loading' when message ~* '(TypeError|ReferenceError|undefined)' then 'Application runtime' else 'Other recorded errors' end as category,count(*) n
 from client_errors where at>=p_start and at<p_end group by 1)t),
 'noor_runs',(select count(*) from agent_runs where started_at>=p_start and started_at<p_end),
 'noor_failures',(select count(*) from agent_runs where started_at>=p_start and started_at<p_end and (outcome='failed' or error is not null)),
 'noor_shadow_runs',(select count(*) from agent_runs where started_at>=p_start and started_at<p_end and shadow),
 'registration_emails_sent',(select count(*) from registration_review_events where sent_at>=p_start and sent_at<p_end),
 'registration_emails_failed',(select count(*) from registration_review_events where sent_at is null and last_error is not null),
 'waiting_pickup',(select count(*) from cases where stage_index=0 and coalesce(cancel_status,'none')<>'cancelled'),
 'waiting_over_day',(select count(*) from cases where stage_index=0 and coalesce(cancel_status,'none')<>'cancelled' and created_at<p_end-interval '24 hours'),
 'open_followups',(select count(*) from case_rounds where status='open')
);
$$;
revoke all on function public.platform_activity_summary(timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.platform_activity_summary(timestamptz,timestamptz) to service_role;
create function public.claim_platform_digest(p_preview boolean default false) returns setof public.platform_digest_runs
language plpgsql security definer set search_path=public as $$
declare s platform_digest_settings%rowtype; finish timestamptz; run_id text;
begin
 select * into s from platform_digest_settings where id;
 if not found or not s.enabled then return; end if;
 finish:=((now() at time zone 'Asia/Muscat')::date+time '23:00') at time zone 'Asia/Muscat';
 if finish>now() then finish:=finish-interval '1 day'; end if;
 if p_preview then finish:=now(); elsif finish<s.starts_at then return; end if;
 run_id:=(case when p_preview then 'preview-' else 'daily-' end)||(finish at time zone 'Asia/Muscat')::date::text;
 insert into platform_digest_runs(id,payload,recipient) values(run_id,platform_activity_summary(finish-interval '24 hours',finish),s.recipient) on conflict(id) do nothing;
 return query update platform_digest_runs set attempts=attempts+1,lease_until=now()+interval '5 minutes'
 where id=run_id and sent_at is null and attempts<12 and first_attempt_at>now()-interval '23 hours' and (lease_until is null or lease_until<now()) returning *;
end $$;
revoke all on function public.claim_platform_digest(boolean) from public,anon,authenticated;
grant execute on function public.claim_platform_digest(boolean) to service_role;
create function private.run_platform_digest() returns void language plpgsql security definer set search_path=public,private as $$
declare secret text; public_token text;
begin
 if not exists(select 1 from platform_digest_settings where enabled) then return; end if;
 select value into secret from private.webhook_config where key='case_notify_secret';
 select value into public_token from private.webhook_config where key='registration_public_anon_token';
 if coalesce(secret,'')='' or coalesce(public_token,'')='' then raise exception 'Digest authentication is not configured'; end if;
 perform net.http_post(url:='https://mtxkushcxczjwypwoxdh.supabase.co/functions/v1/platform-digest',headers:=jsonb_build_object('Content-Type','application/json','x-webhook-secret',secret,'Authorization','Bearer '||public_token),body:='{}'::jsonb,timeout_milliseconds:=30000);
end $$;
revoke all on function private.run_platform_digest() from public,anon,authenticated;
-- UTC 19:00 = Oman 23:00. Retry checks every 5 minutes for one hour.
select cron.schedule('platform-digest-nightly','*/5 19 * * *',$$select private.run_platform_digest()$$);
commit;
notify pgrst, 'reload schema';
