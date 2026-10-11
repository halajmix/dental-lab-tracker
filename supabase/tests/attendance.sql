begin;
-- Fixtures exist only inside this rolled-back transaction.
insert into attendance_punches(connection_id,lab_id,event_key,employee_id,employee_name,punched_at)
select id,lab_id,'transaction-only-attendance-test','2','TEST ONLY','2000-01-01T00:00:00Z'
from attendance_connections where lab_id='fb7401df-c26f-4f53-ab5a-a508ec490047';
insert into attendance_punches(connection_id,lab_id,event_key,employee_id,employee_name,punched_at)
select id,lab_id,'transaction-only-attendance-test','2','TEST ONLY','2000-01-01T00:00:00Z'
from attendance_connections where lab_id='fb7401df-c26f-4f53-ab5a-a508ec490047'
on conflict(connection_id,event_key) do nothing;
do $$ begin
  if (select count(*) from attendance_punches where event_key='transaction-only-attendance-test')<>1 then raise exception 'Replay deduplication failed'; end if;
  if has_table_privilege('authenticated','public.attendance_device_secrets','SELECT') then raise exception 'Device secrets exposed'; end if;
  if has_table_privilege('authenticated','public.attendance_punches','INSERT') then raise exception 'Client can fabricate punches'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"6b731874-763e-4754-8847-d68918e38f84","role":"authenticated"}',true);
do $$ begin
  if (select count(*) from attendance_punches where event_key='transaction-only-attendance-test')<>1 then raise exception 'Lab owner cannot read attendance'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"a2dbdf0f-68f7-4cbf-ab1b-c17999ed2b9b","role":"authenticated"}',true);
do $$ begin
  if exists(select 1 from attendance_punches) then raise exception 'Technician can read attendance'; end if;
  if exists(select 1 from attendance_connections) then raise exception 'Technician can read device connection'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"c873e739-22d2-43d7-ae0b-5b22c095a4d3","role":"authenticated"}',true);
do $$ begin
  if exists(select 1 from attendance_punches) then raise exception 'Accountant can read attendance'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
do $$ begin
  if exists(select 1 from attendance_punches) then raise exception 'Unrelated user can read attendance'; end if;
end $$;
reset role;
rollback;
select 'Attendance isolation and replay checks passed; test records rolled back' as result;
