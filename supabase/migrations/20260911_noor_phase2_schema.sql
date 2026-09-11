/* =====================================================================
   Noor Phase 2 — schema (ADDITIVE ONLY; nothing here changes existing
   business behaviour until noor.global is switched on)
   =====================================================================
   Adds the state Noor needs: clarifications, flags, escalations, the
   agent audit trail, the kill switch, rate-limit and idempotency tables,
   language/timezone/escalation columns, structured reasons on remake
   rounds, and the webhook trigger that posts case events to the `noor`
   Edge Function. Deploy the function BEFORE running the jobs migration.

   Every new column is nullable or defaulted; every new table is empty.
   Rolling the feature back never requires a schema rollback — the flag
   is enough. Idempotent: safe to re-run.
   ===================================================================== */
begin;

/* ---- kill switch + per-tenant enablement ------------------------------ */
create table if not exists public.feature_flags (
  key        text primary key,
  enabled    boolean not null default false,
  tenant_ids uuid[]  null,                 -- null = applies to all tenants
  updated_at timestamptz not null default now()
);
insert into public.feature_flags (key, enabled) values ('noor.global', false)
  on conflict (key) do nothing;

alter table public.labs
  add column if not exists noor_enabled       boolean not null default false,
  add column if not exists language           text    not null default 'en' check (language in ('en','ar')),
  add column if not exists timezone           text    not null default 'Asia/Muscat',
  add column if not exists escalation_user_id uuid    null references auth.users(id) on delete set null,
  add column if not exists brief_hour_local   integer not null default 7 check (brief_hour_local between 0 and 23);

alter table public.clinics
  add column if not exists language text not null default 'en' check (language in ('en','ar'));

alter table public.profiles
  add column if not exists language text not null default 'en' check (language in ('en','ar'));

/* ---- structured reason on remake rounds (G2) --------------------------- */
alter table public.case_rounds
  add column if not exists reason_class text null check (reason_class in ('clinical','laboratory')),
  add column if not exists reason_code  text null check (reason_code in (
    'margin_distortion_unclear_prep','insufficient_occlusal_clearance','impression_drag',
    'incorrect_shade_selection','open_margin_on_die','proximal_contacts','shade_mismatch',
    'framework_fitting_error','porcelain_fracture','other')),
  add column if not exists reason_text  text null;

/* ---- Noor may write case notes (G10) ---------------------------------- */
alter table public.case_notes drop constraint if exists case_notes_author_role_check;
alter table public.case_notes
  add constraint case_notes_author_role_check check (author_role in ('dentist','lab','agent'));

/* ---- clarifications (G1) ----------------------------------------------- */
create table if not exists public.case_clarifications (
  id             uuid primary key default gen_random_uuid(),
  case_id        text not null references public.cases(id) on delete cascade,
  issue          jsonb not null,
  question       text not null,
  language       text not null default 'en' check (language in ('en','ar')),
  asked_at       timestamptz not null default now(),
  nudged_at      timestamptz null,
  answer         text null,
  answered_at    timestamptz null,
  answered_by    uuid null references auth.users(id) on delete set null,
  resolved_value jsonb null,
  status         text not null default 'open' check (status in ('open','answered','expired','escalated')),
  trace_id       text null
);
create unique index if not exists case_clarifications_one_open
  on public.case_clarifications (case_id) where status = 'open';
create index if not exists case_clarifications_case_idx on public.case_clarifications (case_id);

/* ---- flags (G8) -------------------------------------------------------- */
create table if not exists public.case_flags (
  id          uuid primary key default gen_random_uuid(),
  case_id     text not null references public.cases(id) on delete cascade,
  kind        text not null check (kind in ('at_risk','overdue','stale','needs_clarification')),
  reason      text not null,
  visible_to  text not null default 'lab' check (visible_to in ('lab','clinic','both')),
  days_over   integer null,
  created_by  text not null default 'noor',
  created_at  timestamptz not null default now(),
  resolved_at timestamptz null,
  trace_id    text null
);
create unique index if not exists case_flags_one_open_per_kind
  on public.case_flags (case_id, kind) where resolved_at is null;
create index if not exists case_flags_case_idx on public.case_flags (case_id);

/* ---- escalations (G13) ------------------------------------------------- */
create table if not exists public.escalations (
  id               uuid primary key default gen_random_uuid(),
  case_id          text null references public.cases(id) on delete set null,
  lab_id           uuid null references public.labs(id) on delete cascade,
  clinic_id        uuid null references public.clinics(id) on delete set null,
  category         text not null check (category in ('fee_dispute','complaint','clinical_question',
                     'clarification_failed','stale_case','tool_failure','user_requested','pattern_observation')),
  summary          text not null,
  context          jsonb not null default '{}'::jsonb,
  assigned_to      uuid null references auth.users(id) on delete set null,
  assigned_to_name text null,
  status           text not null default 'open' check (status in ('open','acknowledged','resolved')),
  created_at       timestamptz not null default now(),
  acknowledged_at  timestamptz null,
  resolved_at      timestamptz null,
  trace_id         text null
);
create index if not exists escalations_lab_idx on public.escalations (lab_id, status);

/* ---- audit (G7) -------------------------------------------------------- */
create table if not exists public.agent_runs (
  id            uuid primary key default gen_random_uuid(),
  trace_id      text not null unique,
  trigger       text not null,
  lab_id        uuid null,
  clinic_id     uuid null,
  user_id       uuid null,
  case_id       text null,
  model         text null,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz null,
  outcome       text null check (outcome in ('completed','refused','escalated','failed','killed','skipped')),
  shadow        boolean not null default false,
  would_have    jsonb null,
  error         text null
);
create table if not exists public.agent_tool_calls (
  id          uuid primary key default gen_random_uuid(),
  trace_id    text not null references public.agent_runs(trace_id) on delete cascade,
  seq         integer not null,
  tool        text not null,
  input       jsonb null,
  output      jsonb null,
  duration_ms integer null,
  error       text null,
  created_at  timestamptz not null default now()
);
create index if not exists agent_tool_calls_trace_idx on public.agent_tool_calls (trace_id, seq);

/* ---- plumbing: idempotency, rate limits, brief dedupe ------------------- */
create table if not exists public.noor_idempotency (
  key        text primary key,
  created_at timestamptz not null default now()
);
create table if not exists public.noor_rate_limits (
  scope        text not null,
  window_start timestamptz not null,
  count        integer not null default 0,
  primary key (scope, window_start)
);
create table if not exists public.noor_brief_runs (
  lab_id    uuid not null references public.labs(id) on delete cascade,
  day       date not null,
  sent_at   timestamptz null,
  resend_id text null,
  primary key (lab_id, day)
);

/* ---- RLS --------------------------------------------------------------- */
alter table public.feature_flags       enable row level security;
alter table public.case_clarifications enable row level security;
alter table public.case_flags          enable row level security;
alter table public.escalations         enable row level security;
alter table public.agent_runs          enable row level security;
alter table public.agent_tool_calls    enable row level security;
alter table public.noor_idempotency    enable row level security;
alter table public.noor_rate_limits    enable row level security;
alter table public.noor_brief_runs     enable row level security;

revoke all on public.feature_flags, public.case_clarifications, public.case_flags, public.escalations,
  public.agent_runs, public.agent_tool_calls, public.noor_idempotency, public.noor_rate_limits,
  public.noor_brief_runs from anon, authenticated;
grant select on public.case_clarifications, public.case_flags, public.escalations,
  public.agent_runs, public.agent_tool_calls to authenticated;
grant update (answer, answered_at, answered_by, status) on public.case_clarifications to authenticated;
grant update (status, acknowledged_at, resolved_at) on public.escalations to authenticated;
grant all on public.feature_flags, public.case_clarifications, public.case_flags, public.escalations,
  public.agent_runs, public.agent_tool_calls, public.noor_idempotency, public.noor_rate_limits,
  public.noor_brief_runs to service_role;

-- Clarifications: same visibility as case_notes; only the clinic side may answer.
drop policy if exists case_clarifications_select on public.case_clarifications;
create policy case_clarifications_select on public.case_clarifications for select
  using (exists (select 1 from public.cases c where c.id = case_clarifications.case_id
                   and (clinic_case_visible(c.clinic_id, c.created_by) or c.lab_id = my_lab_id() or is_admin())));
drop policy if exists case_clarifications_answer on public.case_clarifications;
create policy case_clarifications_answer on public.case_clarifications for update
  using  (exists (select 1 from public.cases c where c.id = case_clarifications.case_id
                    and clinic_case_visible(c.clinic_id, c.created_by)))
  with check (status in ('open','answered'));

-- Flags: lab sees all of its cases' flags; clinic sees only clinic-visible ones.
drop policy if exists case_flags_select on public.case_flags;
create policy case_flags_select on public.case_flags for select
  using (exists (select 1 from public.cases c where c.id = case_flags.case_id
                   and ((c.lab_id = my_lab_id())
                        or (clinic_case_visible(c.clinic_id, c.created_by) and case_flags.visible_to in ('clinic','both'))
                        or is_admin())));

-- Escalations: the lab's admins and the platform admin. Never the other party.
drop policy if exists escalations_select on public.escalations;
create policy escalations_select on public.escalations for select
  using ((lab_id = my_lab_id() and lab_write_allowed()) or is_admin());
drop policy if exists escalations_update on public.escalations;
create policy escalations_update on public.escalations for update
  using ((lab_id = my_lab_id() and lab_write_allowed()) or is_admin())
  with check (status in ('open','acknowledged','resolved'));

-- Audit: platform admin only.
drop policy if exists agent_runs_admin on public.agent_runs;
create policy agent_runs_admin on public.agent_runs for select using (is_admin());
drop policy if exists agent_tool_calls_admin on public.agent_tool_calls;
create policy agent_tool_calls_admin on public.agent_tool_calls for select using (is_admin());

/* ---- webhook: case events → noor ---------------------------------------
   Mirrors notify_invite_webhook. Filters in SQL so the function is not
   woken by every price or note write: INSERTs, stage changes, remake
   changes, and clarification answers only. Skips entirely while the
   global flag is off, so an undeployed function is never called. */
create or replace function public.notify_noor_webhook()
returns trigger
security definer
set search_path = public, private
as $$
declare
  secret text;
  payload jsonb;
begin
  if not exists (select 1 from public.feature_flags where key = 'noor.global' and enabled) then
    return new;
  end if;
  if TG_TABLE_NAME = 'cases' and TG_OP = 'UPDATE'
     and new.stage_index = old.stage_index
     and new.remake is not distinct from old.remake then
    return new;
  end if;
  if TG_TABLE_NAME = 'case_rounds' and (TG_OP <> 'INSERT' or new.kind <> 'remake') then
    return new;
  end if;
  if TG_TABLE_NAME = 'case_clarifications'
     and (TG_OP <> 'UPDATE' or new.answered_at is null or old.answered_at is not null) then
    return new;
  end if;
  select value into secret from private.webhook_config where key = 'case_notify_secret';
  payload := jsonb_build_object(
    'type', TG_OP, 'table', TG_TABLE_NAME, 'schema', TG_TABLE_SCHEMA,
    'record', to_jsonb(new),
    'old_record', case when TG_OP = 'UPDATE' then to_jsonb(old) else null end);
  perform net.http_post(
    url := 'https://mtxkushcxczjwypwoxdh.supabase.co/functions/v1/noor',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', coalesce(secret, '')),
    body := payload,
    timeout_milliseconds := 30000);
  return new;
end;
$$ language plpgsql;

drop trigger if exists cases_noor_webhook on public.cases;
create trigger cases_noor_webhook after insert or update on public.cases
  for each row execute function public.notify_noor_webhook();
drop trigger if exists case_rounds_noor_webhook on public.case_rounds;
create trigger case_rounds_noor_webhook after insert on public.case_rounds
  for each row execute function public.notify_noor_webhook();
drop trigger if exists case_clarifications_noor_webhook on public.case_clarifications;
create trigger case_clarifications_noor_webhook after update on public.case_clarifications
  for each row execute function public.notify_noor_webhook();

commit;
notify pgrst, 'reload schema';

select
  (select enabled from public.feature_flags where key = 'noor.global')                     as noor_global_on,
  (select count(*) from public.labs where noor_enabled)                                     as labs_enabled,
  (select count(*) from information_schema.tables where table_name in
     ('case_clarifications','case_flags','escalations','agent_runs','agent_tool_calls'))   as new_tables;
