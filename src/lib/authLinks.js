// Keep invitation context through confirmation in another tab or a later visit.
// The RPC still validates expiry, status, account type and the signed-in email.
const INVITE_KEY = 'drcrown.clinic-invite';
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;

export function readClinicInvite(browser, now = Date.now()) {
  const token = new URL(browser.location.href).searchParams.get('clinic_invite')?.trim();
  try {
    if (token) {
      browser.localStorage.setItem(INVITE_KEY, JSON.stringify({ token, savedAt: now }));
      return token;
    }
    const saved = JSON.parse(browser.localStorage.getItem(INVITE_KEY) || 'null');
    if (typeof saved?.token === 'string' && typeof saved.savedAt === 'number' &&
        now >= saved.savedAt && now - saved.savedAt < MAX_AGE) return saved.token;
    browser.localStorage.removeItem(INVITE_KEY);
  } catch { /* Links still work when browser storage is unavailable. */ }
  return token || '';
}

export function clearClinicInvite(browser) {
  try { browser.localStorage.removeItem(INVITE_KEY); } catch { /* unavailable */ }
  const url = new URL(browser.location.href);
  url.searchParams.delete('clinic_invite');
  browser.history.replaceState({}, '', url.pathname + url.search + url.hash);
}

export function invitationRedirect(origin, base, token) {
  const url = new URL(base, origin);
  if (token) url.searchParams.set('clinic_invite', token);
  return url.href;
}

// Consume failed callbacks BEFORE constructing Supabase, so an expected link
// failure never enters its session parser. Never show provider-supplied text.
export function consumeAuthLinkError(browser) {
  const url = new URL(browser.location.href);
  const hash = new URLSearchParams(url.hash.slice(1));
  if (!hash.has('error') && !hash.has('error_code')) return '';
  const expired = hash.get('error_code') === 'otp_expired';
  browser.history.replaceState({}, '', url.pathname + url.search);
  return expired
    ? 'This link has expired — request a new one.'
    : 'This email link could not be used — request a new one.';
}
