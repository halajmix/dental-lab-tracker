-- Onboarding is disposable account metadata, not a reason to block account deletion.
-- Existing accounts and onboarding rows are unchanged by this migration.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
alter table public.sprint1_onboarding
  drop constraint sprint1_onboarding_user_id_fkey,
  add constraint sprint1_onboarding_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade;
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sprint1_onboarding'::regclass
      and conname = 'sprint1_onboarding_user_id_fkey'
      and confrelid = 'auth.users'::regclass
      and confdeltype = 'c'
      and convalidated
  ) then
    raise exception 'Onboarding account-deletion cleanup was not installed';
  end if;
end $$;
commit;
