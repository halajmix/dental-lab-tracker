// Isolated PostgreSQL regression: provide PGLITE_MODULE if PGlite is installed elsewhere.
// Never connects to Supabase or deletes production accounts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
try {
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key);
    create table public.sprint1_onboarding (
      user_id uuid primary key references auth.users(id),
      created_at timestamptz not null default now(), dismissed_at timestamptz
    );
    create table public.clinics (id text primary key, owner_id uuid not null references auth.users(id) on delete cascade);
    create table public.cases (id text primary key, clinic_id text references public.clinics(id) on delete cascade);
    insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
    insert into public.sprint1_onboarding(user_id) select id from auth.users;
    insert into public.clinics values ('fictional-a', '00000000-0000-0000-0000-000000000001'), ('fictional-b', '00000000-0000-0000-0000-000000000002');
    insert into public.cases values ('fictional-case-a','fictional-a'), ('fictional-case-b','fictional-b');
  `);
  const deletion = "delete from auth.users where id='00000000-0000-0000-0000-000000000001'";
  await assert.rejects(db.exec(deletion), error => error.code === '23503' && error.constraint === 'sprint1_onboarding_user_id_fkey');
  console.log('PASS: original FK reproduces the user-deletion failure');
  const before = (await db.query('select * from public.sprint1_onboarding order by user_id')).rows;
  await db.exec(readFileSync(new URL('../supabase/migrations/20260918_onboarding_account_delete.sql', import.meta.url), 'utf8'));
  assert.deepEqual((await db.query('select * from public.sprint1_onboarding order by user_id')).rows, before);
  assert.equal((await db.query('select count(*)::int as count from auth.users')).rows[0].count, 2);
  console.log('PASS: installing cleanup preserves every existing account and onboarding row');
  await db.exec(deletion);
  assert.deepEqual((await db.query('select user_id::text from public.sprint1_onboarding')).rows, [{user_id:'00000000-0000-0000-0000-000000000002'}]);
  assert.deepEqual((await db.query('select id from public.clinics')).rows, [{id:'fictional-b'}]);
  assert.deepEqual((await db.query('select id from public.cases')).rows, [{id:'fictional-case-b'}]);
  console.log('PASS: authorized deletion cleans up only the target account; unrelated clinic, case, and onboarding remain');
  await assert.rejects(db.exec("insert into public.sprint1_onboarding(user_id) values('00000000-0000-0000-0000-000000000099')"),e=>e.code==='23503');
  console.log('PASS: orphan onboarding records are still rejected');
} finally { await db.close(); }
