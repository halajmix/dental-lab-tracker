/* =====================================================================
   Remove everything seed-demo-lab.sql created
   =====================================================================

   Deletes the demo cases, the demo price list and the clinic->lab link,
   and returns the demo lab to a normal private lab with no work.

   It does NOT delete the two accounts or the lab/clinic records — those
   were created through the app's signup and are yours to remove from
   the super-admin screen if you want them gone entirely.

   Touches nothing outside the demo lab: every statement below is scoped
   by that one lab_id.
   ===================================================================== */

set role service_role;

do $$
declare
  v_lab    uuid;
  v_clinic uuid;
  v_cases  int;
begin
  -- keyed on the flag, not the name: renaming the demo lab in the app
  -- would otherwise leave its data behind with nothing pointing at it
  select id into v_lab    from labs    where is_demo limit 1;
  select id into v_clinic from clinics where is_demo limit 1;
  if v_lab is null then
    raise notice 'No demo lab found — nothing to remove.';
    return;
  end if;

  select count(*) into v_cases from cases where lab_id = v_lab;

  -- statements first: cases reference them, and a stale statement would
  -- otherwise sit in the billing screen with no lines behind it
  delete from clinic_statements where lab_id = v_lab;
  -- notes, rounds and costs cascade from cases
  delete from cases where lab_id = v_lab;

  delete from price_schedule_items
   where schedule_id in (select id from price_schedules where lab_id = v_lab);
  delete from price_schedules where lab_id = v_lab;

  if v_clinic is not null then
    delete from clinic_lab_access where lab_id = v_lab and clinic_id = v_clinic;
  end if;

  -- leave is_demo set: the orgs keep their "Dummy" badge in super-admin
  -- so an emptied demo lab is still never mistaken for a real customer.
  raise notice 'removed % demo cases and the demo price list', v_cases;
end $$;

reset role;

/* ---- proof: all zeros ------------------------------------------------ */
select l.name,
       (select count(*) from cases c             where c.lab_id = l.id) as cases_left,
       (select count(*) from clinic_statements s where s.lab_id = l.id) as statements_left,
       (select count(*) from price_schedules p   where p.lab_id = l.id) as price_lists_left
  from labs l
 where l.is_demo;
