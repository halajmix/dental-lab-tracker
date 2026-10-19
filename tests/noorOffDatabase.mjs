// Disposable fictional database only. Exercise the production off-switch
// functions alongside ordinary case notifications; never contact Supabase.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite();
try {
 await db.exec(`create schema private;create schema net;
 create table feature_flags(key text primary key,enabled boolean);
 insert into feature_flags values('noor.global',false);
 create table private.webhook_config(key text,value text);
 create table webhook_attempts(id int);
 create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int) returns bigint language plpgsql as $$begin insert into webhook_attempts values(1);return 1;end$$;
 create table cases(id text primary key,stage_index int,remake jsonb,delivery_time text);
 create table case_rounds(id text primary key,kind text);
 create table case_clarifications(id text primary key,answered_at timestamptz);
 create table ordinary_notifications(case_id text);
 create function ordinary_case_notification() returns trigger language plpgsql as $$begin insert into ordinary_notifications values(new.id);return new;end$$;
 create trigger ordinary_notify after insert or update on cases for each row execute function ordinary_case_notification();`);
 const jobs=readFileSync(new URL('../supabase/migrations/20260911_noor_phase2_jobs.sql',import.meta.url),'utf8');
 await db.exec(jobs.slice(jobs.indexOf('create or replace function private.run_noor'),jobs.indexOf('select cron.schedule')));
 const hotfix=readFileSync(new URL('../supabase/migrations/20260912_noor_trigger_hotfix.sql',import.meta.url),'utf8');
 await db.exec(hotfix.slice(hotfix.indexOf('create or replace function public.notify_noor_webhook'),hotfix.indexOf('-- Proof:')));
 await db.exec(`create trigger noor_cases after insert or update on cases for each row execute function notify_noor_webhook();
 create trigger noor_rounds after insert on case_rounds for each row execute function notify_noor_webhook();
 create trigger noor_clarifications after update on case_clarifications for each row execute function notify_noor_webhook();
 insert into cases values('FICTIONAL-CASE',0,'{}','Morning');
 update cases set stage_index=1,delivery_time='Afternoon' where id='FICTIONAL-CASE';
 insert into case_rounds values('FICTIONAL-ROUND','remake');
 insert into case_clarifications values('FICTIONAL-QUESTION',null);
 update case_clarifications set answered_at=now();
 select private.run_noor('scheduled_watch');select private.run_noor('scheduled_brief');select private.run_noor('scheduled_patterns');`);
 assert.equal((await db.query('select count(*)::int n from webhook_attempts')).rows[0].n,0,'No Noor event or scheduled HTTP requests');
 assert.equal((await db.query('select count(*)::int n from ordinary_notifications')).rows[0].n,2,'Ordinary case notifications still execute');
 assert.deepEqual((await db.query('select stage_index,delivery_time from cases')).rows,[{stage_index:1,delivery_time:'Afternoon'}]);
 console.log('PASS: Noor off blocks scheduled/event webhooks; case creation/stage changes, remakes, clarification answers and ordinary notification triggers continue.');
} finally {await db.close();}
