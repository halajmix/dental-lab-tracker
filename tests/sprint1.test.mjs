import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoginMethods } from '../src/lib/loginMethods.js';
import { onboardingGuide } from '../src/lib/onboardingGuide.js';
test('password adapter preserves password, session result and auth errors', async () => {
  const expected = { data: { session: { access_token: 'fictional' } }, error: null };
  let received;
  const methods = createLoginMethods({ signInWithPassword: async value => { received=value; return expected; } });
  assert.deepEqual(Object.keys(methods), ['password']);
  assert.equal(await methods.password({ email:' test@example.test ', password:' unchanged ' }), expected);
  assert.deepEqual(received, {email:'test@example.test',password:' unchanged '});
  const failed={error:{message:'Invalid login credentials'}};
  assert.equal(await createLoginMethods({signInWithPassword:async()=>failed}).password({email:'a',password:'b'}),failed);
});
test('guidance has distinct clinic roles and no implicit administrator default', () => {
  assert.match(onboardingGuide('receptionist').steps.join(' '), /behalf/);
  assert.match(onboardingGuide('admin').steps.join(' '), /team/);
  assert.match(onboardingGuide('doctor').title, /first case/);
  assert.equal(onboardingGuide(null), null);
  assert.equal(onboardingGuide('lab'), null);
});
