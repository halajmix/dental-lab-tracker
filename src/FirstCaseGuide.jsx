import React, { useEffect, useState } from 'react';
import { supabase } from './lib/supabaseClient.js';
import { onboardingGuide } from './lib/onboardingGuide.js';

export default function FirstCaseGuide({ userId, role, onStart, client = supabase }) {
  const [pending, setPending] = useState(false);
  const [hidden, setHidden] = useState(false);
  const guide = onboardingGuide(role);
  useEffect(() => {
    let cancelled = false;
    setPending(false); setHidden(false);
    let dismissed = false;
    try { dismissed = localStorage.getItem(`drcrown:guide:v1:${userId}`) === 'dismissed'; } catch { /* optional */ }
    if (!dismissed) {
      client.rpc('sprint1_onboarding_pending').then(({ data, error }) => {
        if (!cancelled && !error) setPending(data === true);
      }).catch(() => {}); // Missing migration/network must not interrupt work.
    }
    return () => { cancelled = true; };
  }, [userId, client]);
  const dismiss = () => {
    setHidden(true);
    try { localStorage.setItem(`drcrown:guide:v1:${userId}`, 'dismissed'); } catch { /* optional */ }
    void client.rpc('sprint1_dismiss_onboarding').then(() => {}).catch(() => {});
  };
  if (!pending || hidden || !guide) return null;
  return <section aria-label="Getting started" className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
    <div className="flex items-start justify-between gap-4">
      <h2 className="font-semibold text-slate-900">{guide.title}</h2>
      <button type="button" onClick={dismiss} className="text-sm text-slate-600 underline">Skip</button>
    </div>
    <ol className="my-3 list-inside list-decimal space-y-1 text-sm text-slate-700">{guide.steps.map(step => <li key={step}>{step}</li>)}</ol>
    <button type="button" onClick={() => { dismiss(); onStart(); }} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">{guide.action}</button>
  </section>;
}
