import { supabase } from "./supabaseClient.js";

/* ------------------------------------------------------------------ */
/*  Lab Station device session client.                                 */
/*                                                                     */
/*  The heartbeat/OTP-challenge calls into the station-session Edge    */
/*  Function (deployed as "super-processor") were removed 2026-08-13   */
/*  per explicit user request — see the comment above AuthGate in      */
/*  Auth.jsx for why. What's left here is plain RLS-scoped table       */
/*  access for the Settings → "Signed-in devices" viewer, which still  */
/*  works against whatever rows already exist in lab_device_sessions.  */
/* ------------------------------------------------------------------ */

const FINGERPRINT_KEY = "lab_station_device_id";

/**
 * Stable identifier for "this browser profile on this device".
 *
 * Deliberately a stored random UUID rather than canvas/WebGL fingerprinting:
 * those are unreliable (Safari actively randomises them, which would make
 * every page load look like a brand-new bench) and privacy-hostile. A stored
 * id is exactly as strong as this feature needs — it is an audit/labelling
 * aid, not an authentication factor. Auth is still the Supabase JWT.
 */
export function getDeviceFingerprint() {
  try {
    let id = localStorage.getItem(FINGERPRINT_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(FINGERPRINT_KEY, id);
    }
    return id;
  } catch {
    // Private mode / storage blocked: fall back to a per-tab id so the
    // feature degrades instead of throwing.
    return `ephemeral-${crypto.randomUUID()}`;
  }
}

/* ------------------------------------------------------------------ */
/*  Admin/audit reads — plain RLS-scoped table access, no function.     */
/* ------------------------------------------------------------------ */

const deviceFromRow = (r) => ({
  id: r.id,
  userId: r.user_id,
  fingerprint: r.device_fingerprint,
  sessionName: r.session_name,
  deviceLabel: r.device_label,
  userAgent: r.user_agent,
  currentIp: r.current_ip,
  lastIp: r.last_ip,
  subnet: r.ip_subnet,
  isTrusted: r.is_trusted,
  status: r.status,
  lastActiveAt: r.last_active_at,
  expiresAt: r.expires_at,
  createdAt: r.created_at,
});

export async function fetchDeviceSessions() {
  const { data, error } = await supabase
    .from("lab_device_sessions")
    .select("*")
    .neq("status", "REVOKED")
    .order("last_active_at", { ascending: false });
  if (error) throw error;
  return data.map(deviceFromRow);
}

/** Rename a bench, e.g. "Ceramics Station PC". */
export async function renameDeviceSession(id, sessionName) {
  const { error } = await supabase
    .from("lab_device_sessions")
    .update({ session_name: sessionName.trim().slice(0, 60) })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Revoke a bench. The DB trigger permits a client to set REVOKED (and only
 * REVOKED) — trust/IP columns stay service-role-only.
 */
export async function revokeDeviceSession(id) {
  const { error } = await supabase
    .from("lab_device_sessions")
    .update({ status: "REVOKED" })
    .eq("id", id);
  if (error) throw error;
}
