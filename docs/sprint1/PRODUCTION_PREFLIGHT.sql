-- Read-only release preflight. Returns schema definitions, not patient/user rows.
-- Run in the production SQL editor immediately before reviewing the release.
begin read only;
set local statement_timeout = '15s';
select current_database(), current_user, now() as inspected_at;
select n.nspname as schema_name,p.proname,p.prosecdef as security_definer,
       pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
 ('guard_lab_financial_columns','guard_invite_claim','sync_invited_dentist',
  'is_admin','is_lab_admin','my_lab_id','guard_case_lab_binding',
  'guard_clinic_platform_columns','guard_lab_platform_columns','guard_lab_member_tenant');
select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_policies where schemaname='public' and tablename in ('cases','lab_members','clinics','labs');
select event_object_schema,event_object_table,trigger_name,action_timing,event_manipulation,action_statement
from information_schema.triggers
where event_object_schema in ('public','auth')
 and event_object_table in ('cases','lab_members','clinics','labs','users');
select table_schema,table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns
where table_schema='public' and table_name in
 ('cases','clinics','labs','lab_members','sprint1_onboarding','sprint1_onboarding_settings')
order by table_name,ordinal_position;
commit;
