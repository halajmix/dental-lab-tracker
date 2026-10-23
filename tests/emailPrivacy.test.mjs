import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildCaseEmail } from '../src/lib/caseEmail.js';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workerRoot = process.env.EMAIL_WORKER_ROOT || join(root, 'supabase/functions');
const privateValues = ['FICTIONAL_PATIENT_CANARY', 'FICTIONAL_ID_CANARY', 'FICTIONAL_TREATMENT_CANARY', 'FICTIONAL_MATERIAL_CANARY', 'FICTIONAL_TOKEN_CANARY', 'FICTIONAL_INVOICE_CANARY'];
const record = { id: 'C-FICTIONAL-01', clinic_id: 'clinic-a', lab_id: 'lab-a', patient_name: privateValues[0], patient_id: privateValues[1], appointment_date: '2099-12-31', prescription: { category: privateValues[2], material: privateValues[3], pickupRequested: true }, stage_index: 3 };
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
function assertPrivate(body) { for (const value of [...privateValues, '2099-12-31']) assert(!JSON.stringify(body).includes(value), `Unexpected private value: ${value}`); }

async function withWorker(name, options, run) {
  const dir = mkdtempSync(join(tmpdir(), 'drcrown-email-'));
  const calls = [], mail = [], settings = { CASE_NOTIFY_SECRET: 'fictional-secret', SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fictional-key', RESEND_API_KEY: 'fictional-mail', ...options.env };
  const originalFetch = globalThis.fetch, originalDeno = globalThis.Deno;
  let handler;
  try {
    await build({ entryPoints: [join(workerRoot, name, 'index.ts')], outfile: join(dir, 'worker.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'error', plugins: [{ name: 'local-supabase', setup(b) { b.onResolve({ filter: /^jsr:@supabase\/supabase-js/ }, () => ({ path: require.resolve('@supabase/supabase-js') })); } }] });
    globalThis.Deno = { serve: h => { handler = h; }, env: { get: k => settings[k] } };
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input instanceof Request ? input.url : input);
      const call = { url, ...init }; calls.push(call);
      if (url === 'https://api.resend.com/emails') { mail.push(JSON.parse(init.body)); return response({ id: 'fictional-delivery' }, options.providerFails ? 503 : 200); }
      const u = new URL(url);
      if (u.hostname !== 'fixture.invalid') throw Error('Unexpected outbound request blocked');
      if (u.pathname.endsWith('/labs')) return response(name === 'case-notify' ? { name: 'Fixture Lab', email: 'lab@example.invalid', notify_email: options.override ?? '' } : [{ id: 'lab-a', name: 'Fixture Lab', email: 'lab@example.invalid', payment_reminders_enabled: options.remindersEnabled !== false }]);
      if (u.pathname.endsWith('/clinics')) return response(name === 'case-notify' ? { name: 'Fixture Clinic', email: 'clinic@example.invalid' } : [{ id: 'clinic-a', name: 'Fixture Clinic', email: 'clinic@example.invalid' }]);
      if (u.pathname.endsWith('/profiles')) return response({ name: 'Fixture Inviter' });
      if (u.pathname.endsWith('/lab_members')) return response(options.sibling ? { id: 'sibling' } : null);
      if (u.pathname.endsWith('/cases')) return response(options.empty ? [] : [{ ...record, total_price: 12.5, invoice_number: privateValues[5] }, { ...record, total_price: null }]);
      if (u.pathname.endsWith('/client_errors')) return response(init.method === 'PATCH' ? null : [{ id: 1, at: '2026-10-23T10:00:00Z', message: privateValues[0], url: `https://fixture.invalid/?token=${privateValues[4]}` }]);
      throw Error('Unexpected fixture route blocked: ' + u.pathname);
    };
    await import(pathToFileURL(join(dir, 'worker.mjs')).href);
    const invoke = (payload, headers = { 'x-webhook-secret': 'fictional-secret' }, method = 'POST') => handler(new Request('https://fixture.invalid/worker', { method, headers, ...(method === 'POST' ? { body: JSON.stringify(payload) } : {}) }));
    await run({ invoke, calls, mail, settings });
  } finally { globalThis.fetch = originalFetch; globalThis.Deno = originalDeno; rmSync(dir, { recursive: true, force: true }); }
}

test('case notifications retain routing, case reference, pickup and completion without clinical details', async () => {
  await withWorker('case-notify', { override: 'designated@example.invalid' }, async ({ invoke, mail }) => {
    assert.equal((await (await invoke({ type: 'INSERT', record })).json()).emailed, true);
    assert.deepEqual(mail[0].to, ['designated@example.invalid']);
    assert(mail[0].subject.includes(record.id)); assert(mail[0].html.includes('Pick-up requested'));
    assert(mail[0].html.includes('https://dr-crown.com')); assertPrivate(mail[0]);
    assert.equal((await (await invoke({ type: 'UPDATE', record, old_record: { stage_index: 2 } })).json()).emailed, true);
    assert.deepEqual(mail[1].to, ['clinic@example.invalid']); assert(mail[1].html.includes('ready to collect')); assertPrivate(mail[1]);
    await invoke({ type: 'UPDATE', record, old_record: { stage_index: 3 } });
    await invoke({ type: 'INSERT', record: { ...record, lab_id: null } });
    assert.equal(mail.length, 2, 'No repeats on post-completion edits or missing-lab cases');
  });
});

test('both real notification workers retain fail-closed secret gates and POST-only handling', async () => {
  for (const name of ['case-notify', 'payment-reminders']) await withWorker(name, {}, async ({ invoke, mail, calls, settings }) => {
    assert.equal((await invoke({}, {}, 'GET')).status, 405);
    assert.equal((await invoke({}, {})).status, 401);
    assert.equal((await invoke({}, { 'x-webhook-secret': 'wrong-secret' })).status, 401);
    settings.CASE_NOTIFY_SECRET = '';
    assert.equal((await invoke({})).status, 500);
    assert.equal(mail.length, 0); assert.equal(calls.length, 0);
  });
});

test('clinic invitations retain their necessary account-scoped acceptance link', async () => {
  await withWorker('case-notify', {}, async ({ invoke, mail }) => {
    await invoke({ type: 'INSERT', table: 'clinic_invitations', record: { email: 'invitee@example.invalid', token: 'fictional-invite-token', clinic_id: 'clinic-a', status: 'pending', role: 'doctor' } });
    assert.equal(mail.length, 1); assert.deepEqual(mail[0].to, ['invitee@example.invalid']); assert(mail[0].html.includes('clinic_invite=fictional-invite-token')); assertPrivate(mail[0]);
  });
});

test('dual-role lab invitations still skip the admin sibling email', async () => {
  await withWorker('case-notify', { sibling: true }, async ({ invoke, mail }) => {
    const result = await (await invoke({ type: 'INSERT', table: 'lab_members', record: { email: 'invitee@example.invalid', lab_id: 'lab-a', role: 'lab_admin' } })).json();
    assert(result.skipped.includes('dual-role')); assert.equal(mail.length, 0);
  });
});

test('payment email preserves aggregate amount, count and reply-to without querying or rendering patient-linked line items', async () => {
  await withWorker('payment-reminders', {}, async ({ invoke, calls, mail }) => {
    assert.deepEqual(await (await invoke({})).json(), { ok: true, groups: 1, emailed: 1 });
    assert.deepEqual(mail[0].to, ['clinic@example.invalid']); assert.equal(mail[0].reply_to, 'lab@example.invalid');
    assert(mail[0].html.includes('2 outstanding invoices')); assert(mail[0].html.includes('12.5 OMR')); assertPrivate(mail[0]);
    const q = new URL(calls.find(c => new URL(c.url).pathname.endsWith('/cases')).url);
    assert.equal(q.searchParams.get('select'), 'total_price,clinic_id,lab_id');
    assert.equal(q.searchParams.get('invoice_status'), 'eq.issued');
  });
});

test('disabled reminders and no invoices still send no email', async () => {
  for (const options of [{ remindersEnabled: false }, { empty: true }]) await withWorker('payment-reminders', options, async ({ invoke, mail }) => {
    assert.equal((await (await invoke({})).json()).emailed, 0); assert.equal(mail.length, 0);
  });
});

test('error digest contains no raw messages, patient values, URLs or tokens and acknowledges only accepted delivery', async () => {
  for (const providerFails of [false, true]) await withWorker('payment-reminders', { providerFails }, async ({ invoke, calls, mail }) => {
    const result = await (await invoke({ task: 'error-digest' })).json();
    assert.equal(result.emailed, !providerFails); assertPrivate(mail[0]); assert(mail[0].html.includes('https://dr-crown.com'));
    assert(!mail[0].html.includes('fixture.invalid'));
    const read = calls.find(c => new URL(c.url).pathname.endsWith('/client_errors') && c.method !== 'PATCH');
    assert.equal(new URL(read.url).searchParams.get('select'), 'id,at');
    assert.equal(calls.some(c => c.method === 'PATCH'), !providerFails);
  });
});

test('provider rejection does not report delivery as successful', async () => {
  await withWorker('case-notify', { providerFails: true }, async ({ invoke }) => {
    assert.equal((await (await invoke({ type: 'INSERT', record })).json()).emailed, false);
  });
});

test('manual email includes only reference, deliberate message and business signature; subject is single-line', () => {
  const mail = buildCaseEmail('C-FICTIONAL-01\r\nBcc: injected', 'Please check the case in Dr-Crown.', 'Fixture Dentist / Fixture Clinic');
  assert(!/[\r\n]/.test(mail.subject)); assertPrivate(mail);
  assert(mail.body.includes('Please check the case in Dr-Crown.')); assert(mail.body.includes('https://dr-crown.com/'));
});

test('rendered Contact Lab email excludes automatic patient/clinical context while WhatsApp preserves its existing context', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drcrown-contact-'));
  try {
    await build({ stdin: { contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import Contact from './src/ContactLab.jsx'; export const render = p => renderToStaticMarkup(React.createElement(Contact,p));`, resolveDir: root, loader: 'jsx' }, outfile: join(dir, 'contact.cjs'), bundle: true, platform: 'node', format: 'cjs', logLevel: 'error', plugins: [{ name: 'context-helpers', setup(b) {
      b.onResolve({ filter: /\/(PrescriptionForm|LifecycleEngine)\.jsx$/ }, a => ({ path: a.path, namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: a.path.includes('PrescriptionForm') ? `export const SHADE_BY_LAB='lab';export const toothSummary=()=> '21';` : `export const STAGES=[{label:'Fixture stage',pct:0}];` }));
    } }] });
    const { render } = require(join(dir, 'contact.cjs'));
    const html = render({ open: true, caseObj: { id: record.id, patientName: privateValues[0], patientId: privateValues[1], stageIndex: 0, appointmentDate: record.appointment_date, prescription: record.prescription }, clinic: { name: 'Fixture Clinic', dentist: 'Fixture Dentist' }, lab: { name: 'Fixture Lab', email: 'lab@example.invalid', contact: '+96800000000' } });
    const mailHref = html.match(/href="(mailto:[^"]*\?subject=[^"]*)"/)[1].replaceAll('&amp;', '&');
    const query = new URL(mailHref).searchParams;
    assertPrivate({ subject: query.get('subject'), body: query.get('body') });
    assert.equal(query.get('subject'), 'Dr-Crown case C-FICTIONAL-01');
    assert(html.includes('Email includes the case reference'));
    assert(html.includes(privateValues[0]), 'On-screen/WhatsApp context is preserved');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
