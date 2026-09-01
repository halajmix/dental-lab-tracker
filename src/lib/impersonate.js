import { supabase } from "./supabaseClient.js";
import { adminGetImpersonationToken } from "./data.js";

/**
 * Super Admin "View as" — reuses the app's normal auth machinery instead of
 * threading a second Supabase client through every component: the admin's
 * own session tokens are stashed in sessionStorage, then the SAME shared
 * `supabase` client is switched (via setSession, not signOut+signIn) to a
 * real session for the target user, obtained through the admin-actions Edge
 * Function's one-time magic-link token (never their password — admins never
 * see or need it). useAuth's existing onAuthStateChange listener picks up
 * the swap automatically, so AuthGate just renders that user's own real
 * dashboard, fully interactive, no special-casing needed anywhere else.
 *
 * Session-only (sessionStorage, not localStorage): closing the tab always
 * drops back to a normal logged-out/admin state rather than leaving a stuck
 * impersonation across restarts.
 */
const STASH_KEY = "dr_crown_admin_stash";
const CHANGE_EVENT = "dr-crown-impersonation-change";

export function isImpersonating() {
  return !!sessionStorage.getItem(STASH_KEY);
}

export async function startImpersonation(userId) {
  const { hashedToken, email } = await adminGetImpersonationToken(userId);

  const { data: adminSessionData } = await supabase.auth.getSession();
  const adminSession = adminSessionData.session;
  if (!adminSession) throw new Error("No admin session to stash");

  sessionStorage.setItem(
    STASH_KEY,
    JSON.stringify({ access_token: adminSession.access_token, refresh_token: adminSession.refresh_token }),
  );

  const { error } = await supabase.auth.verifyOtp({ token_hash: hashedToken, type: "magiclink" });
  if (error) {
    sessionStorage.removeItem(STASH_KEY);
    throw error;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return email;
}

export async function stopImpersonation() {
  const raw = sessionStorage.getItem(STASH_KEY);
  if (!raw) return;
  sessionStorage.removeItem(STASH_KEY);
  window.dispatchEvent(new Event(CHANGE_EVENT));
  const tokens = JSON.parse(raw);
  const { error } = await supabase.auth.setSession(tokens);
  if (error) {
    // Stash is gone either way — surfacing this would strand the admin on a
    // dead-end screen with no way back; signing out fully at least gets
    // them to a working login screen to re-authenticate.
    console.error("Failed to restore admin session, signing out instead", error);
    await supabase.auth.signOut();
  }
}

// Drop the stash WITHOUT restoring the admin session — for a full sign-out
// while impersonating: the admin wants out entirely, not back in as admin,
// and leaving the stash would strand the violet banner over the login
// screen (and over the next sign-in).
export function clearImpersonationStash() {
  if (!sessionStorage.getItem(STASH_KEY)) return;
  sessionStorage.removeItem(STASH_KEY);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function onImpersonationChange(handler) {
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}
