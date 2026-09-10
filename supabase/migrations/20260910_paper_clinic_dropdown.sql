-- Existing same-lab billing clinic names only; no financial totals exposed.
begin;
create or replace function public.paper_work_clinics()
returns table(name text) language plpgsql stable security definer set search_path=public as $$
begin
  if not coalesce(can_record_lab_work(),false) then raise exception 'Only active lab staff may select billing clinics.'; end if;
  return query select distinct coalesce(nullif(btrim(c.name),''),nullif(btrim(s.clinic_name),'')) as name
    from clinic_statements s left join clinics c on c.id=s.clinic_id
    where s.lab_id=my_lab_id() and coalesce(nullif(btrim(c.name),''),nullif(btrim(s.clinic_name),'')) is not null
    order by name;
end;
$$;
revoke all on function public.paper_work_clinics() from public,anon;
grant execute on function public.paper_work_clinics() to authenticated;
create or replace function public.save_manual_lab_work(p_id uuid, p_revision integer, p_entry jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_lab uuid; existing manual_lab_work%rowtype; sid uuid; line jsonb;
  clinic text; inv text; done date; qty numeric; unit_price numeric; amount numeric;
begin
  v_lab:=my_lab_id();
  if not coalesce(can_record_lab_work(),false) then raise exception 'Only active lab staff can record paper work.'; end if;
  if not exists(select 1 from labs where id=v_lab and work_ledger_enabled) then raise exception 'Work ledger is not enabled.'; end if;
  if p_id is null or p_entry is null or jsonb_typeof(p_entry)<>'object' then raise exception 'Invalid work entry.'; end if;
  clinic:=btrim(p_entry->>'clinicName'); inv:=btrim(p_entry->>'invoice');
  if not exists(select 1 from public.paper_work_clinics() where name=clinic) then
    raise exception 'Select an existing clinic from this lab’s billing history.';
  end if;
  done:=(p_entry->>'date')::date; qty:=(p_entry->>'units')::numeric; unit_price:=(p_entry->>'price')::numeric;
  if clinic is null or length(clinic) not between 1 and 200 or inv is null or length(inv) not between 1 and 100
    or length(coalesce(btrim(p_entry->>'patient'),'')) not between 1 and 200
    or length(coalesce(btrim(p_entry->>'dentist'),'')) not between 1 and 200
    or length(coalesce(btrim(p_entry->>'procedure'),'')) not between 1 and 500
    or done is null or done<date '2026-09-01' or done>(now() at time zone 'Asia/Muscat')::date
    or qty is null or qty<=0 or qty>1000 or qty<>trunc(qty)
    or unit_price is null or unit_price<0 or unit_price>100000 or unit_price<>round(unit_price,3)
    then raise exception 'Enter a clinic, invoice, patient, doctor, procedure, completion date, whole units and price (up to 3 decimals).'; end if;
  amount:=round(qty*unit_price,3);
  -- Serializes duplicate checking against both paper saves and imports below.
  perform pg_advisory_xact_lock(hashtextextended(v_lab::text,731));
  select * into existing from manual_lab_work where id=p_id for update;
  if existing.id is not null then
    if existing.lab_id<>v_lab then raise exception 'Work entry access denied.'; end if;
    if existing.entry=p_entry then return existing.id; end if;
    if p_revision is distinct from existing.revision then raise exception 'This entry changed. Reload before editing.'; end if;
    if not is_lab_finance() and existing.created_by<>auth.uid() then raise exception 'Only finance staff or the author may correct this entry.'; end if;
    select id into sid from clinic_statements where id=existing.statement_id for update;
    if exists(select 1 from lab_payments where statement_id=sid and voided_at is null)
       or exists(select 1 from clinic_statements where id=sid and status<>'unpaid') then
      raise exception 'This work has a payment. Ask the accountant to correct the payment before editing work.';
    end if;
  elsif p_revision is not null then raise exception 'Work entry no longer exists.';
  end if;
  if exists(select 1 from clinic_statements s where s.lab_id=v_lab and s.id is distinct from sid
    and s.clinic_id is null and s.kind='work' and s.month=date_trunc('month',done)::date
    and lower(btrim(s.clinic_name))=lower(clinic) and jsonb_array_length(s.line_items)=0) then
    raise exception 'A totals-only paper bill already exists for this clinic/month. Reconcile it before adding work that might already be included.';
  end if;
  if exists(select 1 from cases where lab_id=v_lab and lower(btrim(coalesce(nullif(invoice_number,''),'INV-'||regexp_replace(id,'^C-',''))))=lower(inv))
    or exists(select 1 from clinic_statements s, lateral jsonb_array_elements(s.line_items) l
      where s.lab_id=v_lab and s.id is distinct from sid and lower(btrim(l->>'invoice'))=lower(inv)) then
    raise exception 'This invoice already exists in Dr-Crown or paper billing. Review it instead of adding it twice.';
  end if;
  line:=jsonb_build_object('date',done,'invoice',inv,'patient',btrim(p_entry->>'patient'),'dentist',btrim(p_entry->>'dentist'),
    'procedure',btrim(p_entry->>'procedure'),'units',qty,'price',unit_price,'amount',amount,'manualWorkId',p_id);
  perform set_config('drcrown.manual_work',p_id::text,true);
  if existing.id is null then
    insert into clinic_statements(lab_id,clinic_id,clinic_name,month,total,status,line_items,kind)
      values(v_lab,null,clinic,date_trunc('month',done)::date,amount,'unpaid',jsonb_build_array(line),'work') returning id into sid;
    insert into manual_lab_work(id,lab_id,statement_id,created_by,updated_by,entry)
      values(p_id,v_lab,sid,auth.uid(),auth.uid(),p_entry);
  else
    update clinic_statements set clinic_name=clinic,month=date_trunc('month',done)::date,total=amount,line_items=jsonb_build_array(line) where id=sid;
    update manual_lab_work set entry=p_entry,updated_by=auth.uid(),updated_at=now(),revision=revision+1 where id=p_id;
  end if;
  insert into manual_lab_work_audit(work_id,lab_id,actor_id,revision,entry)
    select id,lab_id,auth.uid(),revision,entry from manual_lab_work where id=p_id;
  return p_id;
end;
$$;
commit;
notify pgrst, 'reload schema';
