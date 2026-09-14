-- Additive review notifications. No historic backfill or signup trigger.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table public.registration_review_settings (
 id boolean primary key default true check(id),
 enabled boolean not null default false,
 recipient text not null,
 starts_at timestamptz not null default now()
);
insert into public.registration_review_settings(recipient)
 values (nullif(current_setting('app.registration_review_recipient',true),''));
do $$ begin
 if (select count(*) from public.registration_review_settings)<>1 then raise exception 'Expected one configured review recipient'; end if;
end $$;
create table public.registration_review_events (
 id uuid primary key default gen_random_uuid(), user_id uuid not null,
 kind text not null check(kind in ('signup','setup')),
 payload jsonb not null, created_at timestamptz not null default now(),
 first_attempt_at timestamptz, lease_until timestamptz, attempts integer not null default 0,
 sent_at timestamptz, last_error text,
 unique(user_id,kind)
);
alter table public.registration_review_settings enable row level security;
alter table public.registration_review_events enable row level security;
revoke all on public.registration_review_settings,public.registration_review_events from public,anon,authenticated;
grant all on public.registration_review_settings,public.registration_review_events to service_role;
create function public.claim_registration_reviews() returns setof public.registration_review_events
language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from registration_review_settings where enabled) then return; end if;
 -- Polling is recoverable and never participates in an account or clinical write.
 insert into registration_review_events(user_id,kind,payload)
 select u.id,'signup',jsonb_build_object('email',u.email,'registered_at',u.created_at,'email_verified',u.email_confirmed_at is not null)
 from auth.users u,registration_review_settings s
 where u.created_at>=s.starts_at and u.email is not null
 on conflict(user_id,kind) do nothing;
 insert into registration_review_events(user_id,kind,payload)
 select u.id,'setup',jsonb_build_object('email',u.email,'registered_at',u.created_at,'email_verified',u.email_confirmed_at is not null,
 'name',p.name,'account_type',p.role,'phone',p.phone,
 'organization',coalesce(c.name,l.name),'organization_email',coalesce(c.email,l.email),
 'organization_contact',coalesce(c.contact,l.contact),'governorate',coalesce(c.governorate,l.governorate),'wilayat',coalesce(c.wilayat,l.wilayat))
 from auth.users u join profiles p on p.id=u.id left join clinics c on c.id=p.clinic_id left join labs l on l.id=p.lab_id,registration_review_settings s
 where u.created_at>=s.starts_at and u.email is not null
 on conflict(user_id,kind) do nothing;
 return query
 with batch as (
 select id from registration_review_events where sent_at is null and attempts<8
 and (first_attempt_at is null or first_attempt_at>now()-interval '23 hours')
 and (lease_until is null or lease_until<now()) order by created_at,id limit 10 for update skip locked
 ) update registration_review_events e set attempts=e.attempts+1,first_attempt_at=coalesce(e.first_attempt_at,now()),lease_until=now()+interval '5 minutes'
 from batch where e.id=batch.id returning e.*;
end $$;
revoke all on function public.claim_registration_reviews() from public,anon,authenticated;
grant execute on function public.claim_registration_reviews() to service_role;
create function private.run_registration_reviews() returns void
language plpgsql security definer set search_path=public,private as $$
declare secret text; public_token text;
begin
 if not exists(select 1 from registration_review_settings where enabled) then return; end if;
 select value into secret from private.webhook_config where key='case_notify_secret';
 if coalesce(trim(secret),'')='' then raise exception 'Registration webhook is not configured'; end if;
 select value into public_token from private.webhook_config where key='registration_public_anon_token';
 if coalesce(trim(public_token),'')='' then raise exception 'Registration public token is not configured'; end if;
 perform net.http_post(url:='https://mtxkushcxczjwypwoxdh.supabase.co/functions/v1/registration-notify',
 headers:=jsonb_build_object('Content-Type','application/json','x-webhook-secret',secret,'Authorization','Bearer '||public_token),body:='{}'::jsonb,timeout_milliseconds:=30000);
end $$;
revoke all on function private.run_registration_reviews() from public,anon,authenticated;
select cron.schedule('registration-review-minute','* * * * *',$$select private.run_registration_reviews()$$);
commit;
notify pgrst, 'reload schema';
