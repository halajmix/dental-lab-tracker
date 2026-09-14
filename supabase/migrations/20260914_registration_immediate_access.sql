-- Apply only after notification worker and queue are verified.
-- New organizations only. Preserve existing pending/suspended/active records.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$ begin
 if not exists(select 1 from public.registration_review_settings where enabled) then
 raise exception 'Enable and verify registration notifications first'; end if;
end $$;
alter table public.clinics alter column status set default 'active';
alter table public.labs alter column status set default 'active';
commit;
notify pgrst, 'reload schema';
