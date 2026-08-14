import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, recoveryDetectedEarly } from "./supabaseClient.js";
import { clinicFromRow, labFromRow } from "./data.js";

/**
 * Session + profile/org loader. `profile` carries the role; `clinic`/`lab`
 * carry the org row that role belongs to. `undefined` means "still loading",
 * `null` means "loaded, doesn't exist yet" (drives the Onboarding screen).
 */
export function useAuth() {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(undefined);
  const [clinic, setClinic] = useState(null);
  const [lab, setLab] = useState(null);
  const [loading, setLoading] = useState(true);
  // True once Supabase reports a PASSWORD_RECOVERY event (user clicked a
  // "reset password" email link) — the recovery link signs them in with a
  // temporary session, so we must gate the app behind a "set new password"
  // screen rather than dropping them straight into the dashboard. Seeded
  // from recoveryDetectedEarly in case the event already fired before this
  // component ever mounted (see supabaseClient.js for why that happens).
  const [recovery, setRecovery] = useState(recoveryDetectedEarly);

  // Which auth user the currently shown profile belongs to, and a sequence
  // number so a slow, superseded load can never overwrite a newer one
  // (Supabase fires auth events in bursts — token refresh, tab focus).
  const loadedUserRef = useRef(null);
  const loadSeqRef = useRef(0);

  const loadProfile = useCallback(async (userId) => {
    const seq = ++loadSeqRef.current;
    const fresh = () => seq === loadSeqRef.current;

    const { data: prof } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (!fresh()) return;
    setProfile(prof ?? null);
    loadedUserRef.current = userId;

    if (prof?.clinic_id) {
      const { data: c } = await supabase.from("clinics").select("*").eq("id", prof.clinic_id).maybeSingle();
      if (!fresh()) return;
      setClinic(c ? clinicFromRow(c) : null);
    } else {
      setClinic(null);
    }

    if (prof?.lab_id) {
      const { data: l } = await supabase.from("labs").select("*").eq("id", prof.lab_id).maybeSingle();
      if (!fresh()) return;
      setLab(l ? labFromRow(l) : null);
    } else {
      setLab(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session ?? null);
      if (data.session?.user) {
        loadProfile(data.session.user.id).finally(() => !cancelled && setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (cancelled) return;
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      setSession(next);
      if (next?.user) {
        // Same signed-in user (routine token refresh / tab refocus — fires
        // constantly on phones): refresh the profile silently. Toggling
        // `loading` here made AuthGate unmount the whole app and flash the
        // full-screen spinner on every refocus. A genuinely different user
        // (sign-in, impersonation swap) still gets the loading gate.
        if (next.user.id === loadedUserRef.current) {
          loadProfile(next.user.id);
        } else {
          setLoading(true);
          loadProfile(next.user.id).finally(() => !cancelled && setLoading(false));
        }
      } else {
        loadedUserRef.current = null;
        setProfile(null);
        setClinic(null);
        setLab(null);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const refreshProfile = useCallback(() => {
    if (session?.user) return loadProfile(session.user.id);
  }, [session, loadProfile]);

  const signOut = () => supabase.auth.signOut();

  // Called once the user has set a new password, to leave recovery mode and
  // drop into the normal signed-in app (or Onboarding, if profile is null).
  const clearRecovery = () => setRecovery(false);

  return { session, profile, clinic, lab, loading, recovery, refreshProfile, signOut, clearRecovery };
}
