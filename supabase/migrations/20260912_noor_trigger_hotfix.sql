/* =====================================================================
   HOTFIX — notify_noor_webhook() broke every write to `cases`
   =====================================================================
   The 20260911 version tested `new.kind` (a case_rounds column) inside a
   function that also runs on `cases`. PL/pgSQL resolves `new.<field>`
   against the firing table's row type BEFORE evaluating the boolean, so
   short-circuiting on TG_TABLE_NAME did not help: every insert/update on
   cases raised 'record "new" has no field "kind"' the moment the global
   flag was on. Dentists could not submit, labs could not advance stages.

   Fix: read fields through to_jsonb(new), which is valid for any row.
   Behaviour is otherwise identical. Run this, then re-enable the flag.
   ===================================================================== */
create or replace function public.notify_noor_webhook()
returns trigger
security definer
set search_path = public, private
as $$
declare
  secret text;
  n jsonb := to_jsonb(new);
  o jsonb := case when TG_OP = 'UPDATE' then to_jsonb(old) else null end;
begin
  if not exists (select 1 from public.feature_flags where key = 'noor.global' and enabled) then
    return new;
  end if;
  if TG_TABLE_NAME = 'cases' and TG_OP = 'UPDATE'
     and (n->>'stage_index') is not distinct from (o->>'stage_index')
     and (n->'remake') is not distinct from (o->'remake') then
    return new;
  end if;
  if TG_TABLE_NAME = 'case_rounds' and (TG_OP <> 'INSERT' or (n->>'kind') is distinct from 'remake') then
    return new;
  end if;
  if TG_TABLE_NAME = 'case_clarifications'
     and (TG_OP <> 'UPDATE' or (n->>'answered_at') is null or (o->>'answered_at') is not null) then
    return new;
  end if;
  select value into secret from private.webhook_config where key = 'case_notify_secret';
  perform net.http_post(
    url := 'https://mtxkushcxczjwypwoxdh.supabase.co/functions/v1/noor',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', coalesce(secret, '')),
    body := jsonb_build_object('type', TG_OP, 'table', TG_TABLE_NAME, 'schema', TG_TABLE_SCHEMA, 'record', n, 'old_record', o),
    timeout_milliseconds := 30000);
  return new;
exception when others then
  -- Notifying Noor must NEVER block a clinical or billing write. Log and
  -- let the original statement succeed; the watcher will catch up.
  raise warning 'notify_noor_webhook: % (table %, op %)', sqlerrm, TG_TABLE_NAME, TG_OP;
  return new;
end;
$$ language plpgsql;

-- Proof: with the flag ON, a no-op update on a real case must succeed.
-- (Wrapped so the flag is restored even if the update fails.)
do $$
declare v_id text; v_ok boolean := false;
begin
  update public.feature_flags set enabled = true where key = 'noor.global';
  select id into v_id from public.cases limit 1;
  update public.cases set delivery_time = delivery_time where id = v_id;
  v_ok := true;
  update public.feature_flags set enabled = false where key = 'noor.global';
  raise notice 'trigger fired safely on cases with the flag on: %', v_ok;
exception when others then
  update public.feature_flags set enabled = false where key = 'noor.global';
  raise;
end $$;

select (select enabled from public.feature_flags where key = 'noor.global') as flag_left_off_for_you_to_enable;
