begin;
insert into public.feature_flags(key,enabled) values('noor.prescription_assist',false) on conflict(key) do nothing;
notify pgrst,'reload schema';
commit;
