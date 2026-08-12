import { supabase } from "./supabaseClient.js";

/* ------------------------------------------------------------------ */
/*  Lab Station device session client.                                 */
/*                                                                     */
/*  Talks to the station-session Edge Function, which is the only part */
/*  of this stack that can see a real client IP (the app itself is a   */
/*  static SPA). The browser never sends its own IP — it would be      */
/*  trivially forgeable and is read from proxy headers server-side.    */
/* ------------------------------------------------------------------ */

const FINGERPRINT_KEY = "lab_station_device_id";

// The station-session code was deployed via the dashboard editor, which kept
// its auto-generated name. Supabase functions can't be renamed, so this is the
// deployed slug; if it's ever redeployed as "station-session", update here.
const FUNCTION_NAME = "super-processor";

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

async function callFunction(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, {
    body: { action, fingerprint: getDeviceFingerprint(), ...payload },
  });
  if (error) {
    // supabase-js wraps non-2xx as FunctionsHttpError with the body attached.
    let detail = error.message;
    try {
      const parsed = await error.context?.json?.();
      if (parsed?.error) detail = parsed.error;
    } catch {
      /* keep the generic message */
    }
    throw new Error(detail);
  }
  return data;
}

/**
 * Register/refresh this device's session and run the server-side IP audit.
 * Returns { status: "ACTIVE" | "CHALLENGE_REQUIRED" | "REVOKED", sessionId }.
 *
 * Never throws into the caller's critical path: a heartbeat failure (offline
 * bench, function cold start) must not block a technician from working.
 */
export async function heartbeat(sessionName) {
  try {
    return await callFunction("heartbeat", sessionName ? { sessionName } : {});
  } catch (err) {
    console.warn("Device heartbeat failed (non-fatal):", err.message);
    return null;
  }
}

export function verifyDeviceOtp(sessionId, code) {
  return callFunction("verify-otp", { sessionId, code });
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
