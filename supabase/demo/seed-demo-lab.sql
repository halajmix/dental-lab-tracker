/* =====================================================================
   DEMO DATA for filming — private demo lab, clinic and patients
   =====================================================================

   Creates a self-contained showcase inside the production database:
   one lab, one clinic, a price list and 12 patients whose cases span
   every lifecycle stage, with realistic pricing, invoices and a discount.

   SAFETY
     - the demo lab is is_public = FALSE, so it is invisible to all real
       clinics and no real dentist can send it a case
     - every row created here belongs to that one lab_id / clinic_id, so
       no real lab's queue, statements or receivables are touched
     - the outbound email trigger is disabled while seeding, so none of
       these fake cases send a notification to anyone
     - fully reversible: run teardown-demo-lab.sql

   BEFORE RUNNING — two accounts must exist, created by you through the
   app's normal signup (I don't create accounts or set passwords):

     1. dr-crown.com -> "Register your clinic or lab" -> register a LAB
        named exactly:     Muscat Precision Dental Lab
     2. Same again, register a CLINIC named exactly:
                            Al Noor Dental Clinic

   Use email addresses you control. Then paste this whole file into the
   Supabase SQL editor and Run. It is idempotent — re-running replaces
   the demo cases rather than duplicating them.
   ===================================================================== */

-- Keep the seed silent: no "new case" emails to anybody.
alter table cases disable trigger cases_notify_webhook;

set role service_role;   -- finance columns are guarded against plain postgres

do $$
declare
  v_lab    uuid;
  v_clinic uuid;
  v_sched  uuid;
  v_n      int;
begin
  select id into v_lab    from labs    where name = 'Muscat Precision Dental Lab';
  select id into v_clinic from clinics where name = 'Al Noor Dental Clinic';

  if v_lab is null then
    raise exception 'Lab "Muscat Precision Dental Lab" not found — register it in the app first (see the header of this file).';
  end if;
  if v_clinic is null then
    raise exception 'Clinic "Al Noor Dental Clinic" not found — register it in the app first (see the header of this file).';
  end if;

  /* ---- 1. flag as demo + hide from every real clinic --------------
     is_demo drives the "Dummy lab" badge in super-admin and is what the
     teardown deletes by, so a later rename cannot orphan this data. */
  update labs
     set is_demo = true,
         is_public = false,
         address = 'Ghala Industrial Area',
         wilayat = 'Bawshar',
         governorate = 'Muscat',
         contact = '95000001',
         tat = 5
   where id = v_lab;

  update clinics
     set is_demo = true,
         dentist = coalesce(nullif(dentist, ''), 'Dr Yaqoub Al Lawati'),
         address = 'Al Khuwair',
         wilayat = 'Bawshar',
         governorate = 'Muscat',
         contact = '95000002'
   where id = v_clinic;

  /* ---- 2. the demo clinic may send work to the demo lab ----------- */
  insert into clinic_lab_access (clinic_id, lab_id)
  select v_clinic, v_lab
  where not exists (select 1 from clinic_lab_access
                     where clinic_id = v_clinic and lab_id = v_lab);

  /* ---- 3. a price list, so cases price themselves realistically --- */
  select id into v_sched from price_schedules where lab_id = v_lab and name = 'Demo price list';
  if v_sched is null then
    insert into price_schedules (lab_id, name, is_default)
    values (v_lab, 'Demo price list', true)
    returning id into v_sched;
  end if;

  delete from price_schedule_items where schedule_id = v_sched;
  insert into price_schedule_items (schedule_id, category, base_price) values
    (v_sched, 'Crown - tooth',                 35),
    (v_sched, 'Crown - implant',               45),
    (v_sched, 'Veneer',                        25),
    (v_sched, 'Bridge - tooth (conventional)', 35),
    (v_sched, 'Bridge - implant',              45),
    (v_sched, 'Complete denture',              35),
    (v_sched, 'Removable partial denture',     10),
    (v_sched, 'Night guard',                    8),
    (v_sched, 'Clear retainer',                 8),
    (v_sched, 'Michigan splint',               80);

  /* ---- 4. wipe any previous demo cases (idempotent re-run) -------- */
  delete from cases where lab_id = v_lab and id like 'C-DEMO%';

  /* ---- 5. the patients -------------------------------------------
     stage_index: 0 Still at Clinic · 1 Picked Up · 2 In Progress
                  3 Work Complete  · 4 Clinic Received              */
  insert into cases (id, clinic_id, lab_id, patient_name, patient_id, patient_phone,
                     appointment_date, created_date, stage_index, invoice_number, prescription)
  values
  ('C-DEMO01', v_clinic, v_lab, 'Salim Al Harthy',  'PT-1001', '95110001',
   current_date + 3, current_date - 2, 1, 'INV-DEMO-1001',
   '{"notation":"FDI","included":["Upper impression","Lower impression","Bite registration"],
     "notes":"Contact points light on the distal.",
     "restorations":[{"id":"d1","category":"Crown - implant","material":"Zirconia","shadeGuide":"VITA Classical","vitaShade":"A2","stumpShade":"ND2","implantSystem":"Straumann BLT","abutmentType":"Stock / Straight","abutmentColor":"Yellow","teeth":[{"fdi":24},{"fdi":25}]}]}'::jsonb),

  ('C-DEMO02', v_clinic, v_lab, 'Aisha Al Balushi', 'PT-1002', '95110002',
   current_date + 5, current_date - 4, 2, 'INV-DEMO-1002',
   '{"notation":"FDI","included":["Upper impression","Shade photographs"],
     "notes":"Patient requests a brighter result than the adjacent teeth.",
     "restorations":[{"id":"d1","category":"Veneer","material":"Lithium disilicate (e.max)","shadeGuide":"VITA Bleach","vitaShade":"BL2","teeth":[{"fdi":11,"role":"veneer"},{"fdi":12,"role":"veneer"},{"fdi":21,"role":"veneer"},{"fdi":22,"role":"veneer"}]}]}'::jsonb),

  ('C-DEMO03', v_clinic, v_lab, 'Khalid Al Riyami', 'PT-1003', '95110003',
   current_date + 1, current_date - 6, 3, 'INV-DEMO-1003',
   '{"notation":"FDI","included":["Upper impression","Lower impression","Opposing model"],
     "restorations":[{"id":"d1","category":"Bridge - tooth (conventional)","material":"PFM, non-precious","shadeGuide":"VITA Classical","vitaShade":"A3","stumpShade":"ND3","teeth":[{"fdi":14},{"fdi":15,"role":"pontic"},{"fdi":16}]}]}'::jsonb),

  ('C-DEMO04', v_clinic, v_lab, 'Fatma Al Hinai',   'PT-1004', '95110004',
   current_date - 1, current_date - 12, 4, 'INV-DEMO-1004',
   '{"notation":"FDI","included":["Upper impression","Lower impression","Bite registration","Face-bow record"],
     "restorations":[{"id":"d1","category":"Complete denture","material":"Heat-cured PMMA","shadeGuide":"VITA Classical","vitaShade":"A2","arches":"both"}]}'::jsonb),

  ('C-DEMO05', v_clinic, v_lab, 'Yousuf Al Mamari', 'PT-1005', '95110005',
   current_date + 7, current_date, 0, null,
   '{"notation":"FDI","included":["Upper impression"],
     "restorations":[{"id":"d1","category":"Crown - tooth","material":"Zirconia","shadeGuide":"Shade by Lab","teeth":[{"fdi":36}]}]}'::jsonb),

  ('C-DEMO06', v_clinic, v_lab, 'Mariam Al Zadjali','PT-1006', '95110006',
   current_date + 4, current_date - 3, 2, 'INV-DEMO-1006',
   '{"notation":"FDI","included":["Upper impression","Lower impression"],
     "notes":"Night-time bruxism — build to a flat plane.",
     "restorations":[{"id":"d1","category":"Michigan splint","material":"Hard acrylic","arches":"upper"}]}'::jsonb),

  ('C-DEMO07', v_clinic, v_lab, 'Said Al Habsi',    'PT-1007', '95110007',
   current_date + 2, current_date - 8, 4, 'INV-DEMO-1007',
   '{"notation":"FDI","included":["Upper impression","Lower impression","Bite registration"],
     "restorations":[{"id":"d1","category":"Crown - tooth","material":"Zirconia","shadeGuide":"VITA Classical","vitaShade":"A3.5","stumpShade":"ND4","teeth":[{"fdi":46}]},
                     {"id":"d2","category":"Crown - tooth","material":"Zirconia","shadeGuide":"VITA Classical","vitaShade":"A3.5","teeth":[{"fdi":47}]}]}'::jsonb),

  ('C-DEMO08', v_clinic, v_lab, 'Noor Al Kindi',    'PT-1008', '95110008',
   current_date + 6, current_date - 1, 1, null,
   '{"notation":"FDI","included":["Upper impression","Lower impression"],
     "restorations":[{"id":"d1","category":"Clear retainer","material":"1mm Essix","arches":"both"}]}'::jsonb),

  ('C-DEMO09', v_clinic, v_lab, 'Hamed Al Siyabi',  'PT-1009', '95110009',
   current_date + 9, current_date - 5, 2, 'INV-DEMO-1009',
   '{"notation":"FDI","included":["Upper impression","Lower impression","Opposing model"],
     "restorations":[{"id":"d1","category":"Bridge - implant","material":"Zirconia on titanium bases","shadeGuide":"VITA Classical","vitaShade":"A2","implantSystem":"Nobel Active","abutmentType":"Custom","teeth":[{"fdi":34},{"fdi":35,"role":"pontic"},{"fdi":36}]}]}'::jsonb),

  ('C-DEMO10', v_clinic, v_lab, 'Layla Al Rawahi',  'PT-1010', '95110010',
   current_date - 3, current_date - 15, 4, 'INV-DEMO-1010',
   '{"notation":"FDI","included":["Upper impression","Lower impression"],
     "restorations":[{"id":"d1","category":"Removable partial denture","material":"Cobalt-chrome framework","shadeGuide":"VITA Classical","vitaShade":"A3","arches":"lower"}]}'::jsonb),

  ('C-DEMO11', v_clinic, v_lab, 'Nasser Al Amri',   'PT-1011', '95110011',
   current_date + 8, current_date, 0, null,
   '{"notation":"FDI","included":["Upper impression"],
     "restorations":[{"id":"d1","category":"Night guard","material":"Soft EVA","arches":"upper"}]}'::jsonb),

  ('C-DEMO12', v_clinic, v_lab, 'Huda Al Farsi',    'PT-1012', '95110012',
   current_date + 3, current_date - 7, 3, 'INV-DEMO-1012',
   '{"notation":"FDI","included":["Upper impression","Lower impression","Bite registration","Shade photographs"],
     "notes":"Match the existing central incisor exactly.",
     "restorations":[{"id":"d1","category":"Veneer","material":"Feldspathic","shadeGuide":"VITA Classical","vitaShade":"A1","teeth":[{"fdi":11,"role":"veneer"}]}]}'::jsonb);

  /* ---- 6. give the billing screens something to show -------------- */
  -- delivered work is invoiced; two are settled, one carries a discount
  update cases set invoice_status = 'issued'
   where lab_id = v_lab and id in ('C-DEMO03','C-DEMO09','C-DEMO12');

  update cases set invoice_status = 'paid'
   where lab_id = v_lab and id in ('C-DEMO04','C-DEMO07','C-DEMO10');

  update cases
     set discount = 15,
         total_price = greatest(0, coalesce(total_price, 0) - 15),
         price_overridden = true,
         billing_note = 'Goodwill discount agreed with the clinic.'
   where lab_id = v_lab and id = 'C-DEMO01';

  select count(*) into v_n from cases where lab_id = v_lab and id like 'C-DEMO%';
  raise notice 'demo cases created: %', v_n;
end $$;

reset role;

-- Emails back on.
alter table cases enable trigger cases_notify_webhook;

/* ---- proof ---------------------------------------------------------- */
select l.name                                   as demo_lab,
       l.is_demo                                as badged_as_dummy,
       l.is_public                              as visible_to_real_clinics,
       (select count(*) from cases c where c.lab_id = l.id)                     as demo_cases,
       (select round(sum(c.total_price)) from cases c where c.lab_id = l.id)    as demo_value_omr,
       (select count(*) from price_schedule_items i
          join price_schedules s on s.id = i.schedule_id where s.lab_id = l.id) as price_items
  from labs l
 where l.name = 'Muscat Precision Dental Lab';
