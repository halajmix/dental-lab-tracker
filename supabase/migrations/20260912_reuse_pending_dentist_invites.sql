-- Adding a dentist must not depend on accepting an existing email invitation.
begin;
create or replace function public.add_clinic_dentist(p_clinic uuid,p_name text,p_email text)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
 normalized_email text := lower(trim(p_email));
 dentist_name text := trim(p_name);
 inv clinic_invitations%rowtype;
 d clinic_dentists%rowtype;
begin
 if auth.uid() is null or not coalesce(has_clinic_role(p_clinic,array['admin','receptionist']),false) then
   raise exception 'Only this clinic''s admins and receptionists can add dentists.';
 end if;
 if dentist_name is null or length(dentist_name) not between 1 and 160 then
   raise exception 'Enter the dentist name (up to 160 characters).';
 end if;
 if normalized_email is null or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
   raise exception 'Enter a valid dentist email.';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_clinic::text || ':' || normalized_email,0));
 select * into d from clinic_dentists where clinic_id=p_clinic and lower(email)=normalized_email and active for update;
 if found then
   return jsonb_build_object('id',d.invitation_id,'dentist_id',d.id,'reused',true);
 end if;
 -- Lock the existing invitation so acceptance/revocation cannot race the roster repair.
 select * into inv from clinic_invitations
 where clinic_id=p_clinic and lower(trim(email))=normalized_email and status='pending'
 order by created_at desc limit 1 for update;
 if found then
   if inv.role <> 'doctor' then
     raise exception 'This email has an invitation for another clinic role. Manage that invitation in Settings.';
   end if;
   -- Older invitations have no dentist_name. Use the supplied name for the
   -- clinic roster, retaining the original invitation, token and expiry.
   insert into clinic_dentists(clinic_id,name,email,invitation_id)
   values(p_clinic,dentist_name,normalized_email,inv.id)
   on conflict (clinic_id,lower(email)) do update
     set name=excluded.name,invitation_id=excluded.invitation_id,active=true,user_id=null
   returning * into d;
   return jsonb_build_object('id',inv.id,'dentist_id',d.id,'reused',true);
 end if;
 -- A new dentist follows the existing invitation/email trigger path.
 insert into clinic_invitations(clinic_id,email,dentist_name,role,invited_by)
 values(p_clinic,normalized_email,dentist_name,'doctor',auth.uid())
 returning * into inv;
 select * into d from clinic_dentists where invitation_id=inv.id;
 if d.id is null then raise exception 'The dentist could not be added. Please try again.'; end if;
 return jsonb_build_object('id',inv.id,'dentist_id',d.id,'reused',false);
end $$;
revoke all on function public.add_clinic_dentist(uuid,text,text) from public,anon;
grant execute on function public.add_clinic_dentist(uuid,text,text) to authenticated;
notify pgrst, 'reload schema';
commit;
