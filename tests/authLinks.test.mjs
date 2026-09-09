import test from 'node:test';
import assert from 'node:assert/strict';
import { readClinicInvite, clearClinicInvite, invitationRedirect, consumeAuthLinkError } from '../src/lib/authLinks.js';
function browser(href, storage = new Map()) {
  const b = {
    location: { href },
    localStorage: {
      getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k),
    },
    history: { replaceState: (_, __, path) => { b.location.href = new URL(path, b.location.href).href; } },
  };
  return b;
}
test('invitation survives confirmation in another tab and a later bare visit', () => {
  const storage = new Map();
  const first = browser('https://example.test/?clinic_invite=fictional-token', storage);
  assert.equal(readClinicInvite(first, 100), 'fictional-token');
  const callback = invitationRedirect('https://example.test', '/app/', readClinicInvite(first, 101));
  assert.equal(new URL(callback).searchParams.get('clinic_invite'), 'fictional-token');
  assert.equal(new URL(callback).pathname, '/app/');
  assert.equal(readClinicInvite(browser(callback), 102), 'fictional-token');
  const later = browser('https://example.test/', storage);
  assert.equal(readClinicInvite(later, 103), 'fictional-token');
  clearClinicInvite(later);
  assert.equal(readClinicInvite(later, 104), '');
});
test('new explicit invite replaces old context; cached invitations expire', () => {
  const b = browser('https://example.test/?clinic_invite=first');
  readClinicInvite(b, 100);
  b.location.href = 'https://example.test/?clinic_invite=second';
  assert.equal(readClinicInvite(b, 101), 'second');
  b.location.href = 'https://example.test/';
  assert.equal(readClinicInvite(b, 101 + 7 * 86400000), '');
});
test('storage denial still allows explicit invitations', () => {
  const b = browser('https://example.test/?clinic_invite=fictional');
  Object.defineProperty(b, 'localStorage', { get() { throw Error('denied'); } });
  assert.equal(readClinicInvite(b), 'fictional');
  clearClinicInvite(b);
  assert.equal(readClinicInvite(b), '');
});
test('failed callbacks are consumed without losing invitation or reflecting provider text', () => {
  const b = browser('https://example.test/?clinic_invite=fictional#error=access_denied&error_code=otp_expired&error_description=private');
  assert.equal(consumeAuthLinkError(b), 'This link has expired — request a new one.');
  assert.equal(new URL(b.location.href).hash, '');
  assert.equal(readClinicInvite(b), 'fictional');
});
test('valid recovery callbacks remain intact', () => {
  const b = browser('https://example.test/#access_token=fictional&type=recovery');
  assert.equal(consumeAuthLinkError(b), '');
  assert.match(b.location.href, /type=recovery/);
});
