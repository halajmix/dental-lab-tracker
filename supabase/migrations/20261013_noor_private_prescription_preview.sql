begin;
insert into public.feature_flags(key,enabled) values('noor.prescription_admin_preview',false) on conflict(key) do nothing;
notify pgrst,'reload schema';
commit;
