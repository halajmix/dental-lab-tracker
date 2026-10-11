-- Attendance is an owner-only HR view, not a lab-admin or finance view.
begin;
drop policy if exists attendance_connections_read on public.attendance_connections;
create policy attendance_connections_read on public.attendance_connections for select to authenticated
  using(lab_id=my_lab_id() and exists(
    select 1 from public.labs l where l.id=lab_id and l.owner_id=auth.uid()
  ));
drop policy if exists attendance_punches_read on public.attendance_punches;
create policy attendance_punches_read on public.attendance_punches for select to authenticated
  using(lab_id=my_lab_id() and exists(
    select 1 from public.labs l where l.id=lab_id and l.owner_id=auth.uid()
  ));
commit;
notify pgrst,'reload schema';
