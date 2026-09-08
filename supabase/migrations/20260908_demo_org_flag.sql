/* =====================================================================
   Demo-org flag — marks a lab or clinic as advertising/demo data
   =====================================================================

   Adds `is_demo` to labs and clinics. Rows carrying it are real records
   in every technical sense — they price, invoice and print exactly like
   production data, which is the point when filming — but the super-admin
   screen labels them "Dummy lab" / "Dummy clinic" so nobody mistakes
   them for a paying customer, and the demo teardown script uses the flag
   rather than matching on a name (a rename would silently orphan the
   demo data otherwise).

   Defaults to false, so every existing lab and clinic is unaffected.
   ===================================================================== */

alter table labs    add column if not exists is_demo boolean not null default false;
alter table clinics add column if not exists is_demo boolean not null default false;

/* Only the platform owner may set this — same guard the other org-level
   admin fields rely on: the column is written through the admin-actions
   Edge Function (service role) or the SQL editor, never from the client.
   The existing RLS update policies already restrict who can touch these
   tables at all; this comment records the intent. */

notify pgrst, 'reload schema';

select
  (select count(*) from information_schema.columns
    where table_name = 'labs'    and column_name = 'is_demo') as labs_have_flag,
  (select count(*) from information_schema.columns
    where table_name = 'clinics' and column_name = 'is_demo') as clinics_have_flag,
  (select count(*) from labs    where is_demo) as demo_labs,
  (select count(*) from clinics where is_demo) as demo_clinics;
