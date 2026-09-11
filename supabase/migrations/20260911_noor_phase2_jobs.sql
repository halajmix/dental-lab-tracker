/* =====================================================================
   Noor Phase 2 — scheduled jobs. Run AFTER the `noor` Edge Function is
   deployed (Verify JWT OFF; it authenticates with CASE_NOTIFY_SECRET).
   The poster no-ops while noor.global is off, so scheduling early is
   harmless but pointless. cron.schedule by name is an upsert.
   ===================================================================== */
create or replace function private.run_noor(p_trigger text)
returns void
security definer
set search_path = public, private
as $$
declare secret text;
begin
  if not exists (select 1 from public.feature_flags where key = 'noor.global' and enabled) then return; end if;
  select value into secret from private.webhook_config where key = 'case_notify_secret';
  if coalesce(trim(secret), '') = '' then raise exception 'Noor webhook secret is missing'; end if;
  perform net.http_post(
    url := 'https://mtxkushcxczjwypwoxdh.supabase.co/functions/v1/noor',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', secret),
    body := jsonb_build_object('source', 'pg_cron', 'trigger', p_trigger),
    timeout_milliseconds := 60000);
end;
$$ language plpgsql;

select cron.schedule('noor-watch-30min',  '*/30 * * * *', $$select private.run_noor('scheduled_watch')$$);
select cron.schedule('noor-brief-hourly', '30 * * * *',   $$select private.run_noor('scheduled_brief')$$);
select cron.schedule('noor-patterns-weekly', '0 3 * * 0', $$select private.run_noor('scheduled_patterns')$$);

select jobname, schedule from cron.job where jobname like 'noor-%' order by jobname;
