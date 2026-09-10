-- Owner-applied migration. No existing work, bills or payments are removed.
begin;
alter table public.labs add column if not exists work_ledger_enabled boolean not null default false;
alter table public.labs alter column finance_history_before set default date '2026-09-01';
update public.labs set finance_history_before=date '2026-09-01', work_ledger_enabled=true;
alter table public.labs alter column work_ledger_enabled set default true;

create table if not exists public.manual_lab_work (
  id uuid primary key,
  lab_id uuid not null references public.labs(id),
  statement_id uuid not null unique references public.clinic_statements(id),
  created_by uuid not null,
  updated_by uuid not null,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  entry jsonb not null
);
create table if not exists public.manual_lab_work_audit (
  id bigint generated always as identity primary key,
  work_id uuid not null references public.manual_lab_work(id),
  lab_id uuid not null references public.labs(id),
  actor_id uuid not null,
  at timestamptz not null default now(),
  revision integer not null,
  entry jsonb not null
);
create or replace function public.can_record_lab_work()
returns boolean language sql stable security definer set search_path=public as $$
  select auth.uid() is not null and my_lab_id() is not null and (
    is_lab_finance() or exists(select 1 from lab_members where user_id=auth.uid()
      and lab_id=my_lab_id() and role='lab_tech' and status='active'));
$$;
alter table public.manual_lab_work enable row level security;
alter table public.manual_lab_work_audit enable row level security;
revoke all on public.manual_lab_work, public.manual_lab_work_audit from anon, authenticated;
grant select on public.manual_lab_work, public.manual_lab_work_audit to authenticated;
grant all on public.manual_lab_work, public.manual_lab_work_audit to service_role;
drop policy if exists manual_work_read on public.manual_lab_work;
create policy manual_work_read on public.manual_lab_work for select using
  (is_admin() or (lab_id=my_lab_id() and can_record_lab_work()));
drop policy if exists manual_work_audit_read on public.manual_lab_work_audit;
create policy manual_work_audit_read on public.manual_lab_work_audit for select using
  (is_admin() or (lab_id=my_lab_id() and is_lab_finance()));

-- Dedicated statement per paper entry. Null clinic_id keeps these separate
-- from generated digital statements (whose totals are recomputed from cases).
-- The clinic name groups the two sources in the finance views, as for Excel.
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
revoke all on function public.save_manual_lab_work(uuid,integer,jsonb) from public,anon;
grant execute on function public.save_manual_lab_work(uuid,integer,jsonb) to authenticated;

-- Prevent direct edits/deletes bypassing the audited save, and reject an Excel
-- re-import containing an existing manual/digital invoice. Existing history
-- is not scanned, merged or rewritten. Aggregate imports cannot prove identity;
-- block a matching clinic/month when manually entered work already exists.
create or replace function public.guard_work_statement()
returns trigger language plpgsql security definer set search_path=public as $$
declare marker text; item jsonb;
begin
  if tg_op<>'INSERT' and exists(select 1 from manual_lab_work where statement_id=old.id) then
    select id::text into marker from manual_lab_work where statement_id=old.id;
    if current_setting('drcrown.manual_work',true) is distinct from marker then
      if tg_op='DELETE' then raise exception 'Paper work is retained. Use an audited correction.'; end if;
      if (new.lab_id,new.clinic_id,new.clinic_name,new.month,new.total,new.line_items,new.kind)
         is distinct from (old.lab_id,old.clinic_id,old.clinic_name,old.month,old.total,old.line_items,old.kind) then
        raise exception 'Use All Work to correct paper work.';
      end if;
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  if tg_op='UPDATE' then
    if (new.lab_id,new.clinic_id,new.clinic_name,new.month,new.total,new.line_items,new.kind)
       is not distinct from (old.lab_id,old.clinic_id,old.clinic_name,old.month,old.total,old.line_items,old.kind) then return new; end if;
  end if;
  if not exists(select 1 from labs where id=new.lab_id and work_ledger_enabled)
    or new.kind='opening_balance' or new.clinic_id is not null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.lab_id::text,731));
  if jsonb_array_length(new.line_items)=0 and exists(
    select 1 from manual_lab_work w join clinic_statements s on s.id=w.statement_id
    where w.lab_id=new.lab_id and lower(btrim(s.clinic_name))=lower(btrim(new.clinic_name)) and s.month=new.month and s.id<>new.id) then
    raise exception 'Paper work is already entered for this clinic/month. Upload only itemized additional work, with distinct invoice numbers.';
  end if;
  for item in select * from jsonb_array_elements(new.line_items) loop
    if item ? 'manualWorkId' and current_setting('drcrown.manual_work',true) is distinct from item->>'manualWorkId' then
      -- Ordinary status/payment updates must remain possible.
      if tg_op='INSERT' then raise exception 'Manual entries must be saved through All Work.'; end if;
      if new.line_items is distinct from old.line_items then raise exception 'Use All Work to correct paper work.'; end if;
    end if;
    if nullif(btrim(item->>'invoice'),'') is not null and (
      exists(select 1 from cases c where c.lab_id=new.lab_id and lower(btrim(coalesce(nullif(c.invoice_number,''),'INV-'||regexp_replace(c.id,'^C-',''))))=lower(btrim(item->>'invoice')))
      or exists(select 1 from manual_lab_work w join clinic_statements s on s.id=w.statement_id,
        lateral jsonb_array_elements(s.line_items) l
        where w.lab_id=new.lab_id and s.id<>new.id and lower(btrim(l->>'invoice'))=lower(btrim(item->>'invoice')))) then
      raise exception 'An invoice in this upload already exists in digital or manually entered work.';
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists guard_work_statement on public.clinic_statements;
create trigger guard_work_statement before insert or update or delete on public.clinic_statements for each row execute function public.guard_work_statement();
-- Also prevent a later digital invoice from reusing a saved paper invoice.
create or replace function public.guard_digital_work_invoice()
returns trigger language plpgsql security definer set search_path=public as $$
declare inv text;
begin
  if tg_op='UPDATE' then
    if new.invoice_number is not distinct from old.invoice_number and new.lab_id is not distinct from old.lab_id then return new; end if;
  end if;
  if new.lab_id is null or not exists(select 1 from labs where id=new.lab_id and work_ledger_enabled) then return new; end if;
  inv:=lower(btrim(coalesce(nullif(new.invoice_number,''),'INV-'||regexp_replace(new.id,'^C-',''))));
  perform pg_advisory_xact_lock(hashtextextended(new.lab_id::text,731));
  if exists(select 1 from clinic_statements s, lateral jsonb_array_elements(s.line_items) l
    where s.lab_id=new.lab_id and s.clinic_id is null and lower(btrim(l->>'invoice'))=inv) then
    raise exception 'This invoice already exists in paper billing. Review it before billing the digital case.';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_digital_work_invoice on public.cases;
create trigger guard_digital_work_invoice before insert or update of invoice_number,lab_id on public.cases
for each row execute function public.guard_digital_work_invoice();
commit;
notify pgrst, 'reload schema';
