/**
 * Lab Station device session + IP audit + anomaly step-up.
 *
 * Runs on Supabase Edge Functions (Deno). This exists because the app itself
 * is a static SPA on GitHub Pages — there is no other server in the stack
 * that can see a real client IP. The browser is never trusted to report its
 * own IP; it is read here from proxy headers only.
 *
 * Actions (POST body { action: ... }):
 *   heartbeat  — upsert this device's session, audit IP, run anomaly checks
 *   verify-otp — validate a step-up code, trust the IP, restore ACTIVE
 *
 * Deploy:
 *   npx supabase functions deploy station-session --project-ref <ref>
 */

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

/* ------------------------------------------------------------------ */
/*  Request context                                                    */
/* ------------------------------------------------------------------ */

/**
 * Resolve the real client IP through however many proxies sit in front.
 * Order matters: Cloudflare's header is authoritative when present, then
 * the LEFTMOST x-forwarded-for entry (the original client — later entries
 * are the proxy chain and are trivially spoofable by prepending).
 */
function clientIp(req: Request): string | null {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();

  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }

  return req.headers.get("x-real-ip")?.trim() ?? null;
}

/**
 * Coarse network identity for "same place?" comparisons: /24 for IPv4,
 * /64 for IPv6. Deliberately coarse — a bench on DHCP legitimately moves
 * within its subnet all day and must not trigger a challenge for it.
 */
function subnetOf(ip: string): string | null {
  if (!ip) return null;
  if (ip.includes(":")) {
    const groups = ip.split(":").filter(Boolean).slice(0, 4);
    return groups.length ? `${groups.join(":")}::/64` : null;
  }
  const octets = ip.split(".");
  if (octets.length !== 4) return null;
  return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
}

/** "iPadOS 17 / Safari"-style label from a User-Agent string. */
function deviceLabel(ua: string): string {
  if (!ua) return "Unknown device";

  let os = "Unknown OS";
  const iOS = ua.match(/(?:iPhone )?OS (\d+)[_\d]* like Mac OS X/);
  if (/iPad/.test(ua)) os = `iPadOS ${iOS?.[1] ?? ""}`.trim();
  else if (/iPhone|iPod/.test(ua)) os = `iOS ${iOS?.[1] ?? ""}`.trim();
  else if (/Android/.test(ua)) os = `Android ${ua.match(/Android (\d+)/)?.[1] ?? ""}`.trim();
  else if (/Windows NT 10/.test(ua)) os = /Windows NT 10\.0.*rv:/.test(ua) ? "Windows 10" : "Windows 11";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Linux/.test(ua)) os = "Linux";

  // Order matters: Edge/Chrome/Safari all claim "Safari" in their UA.
  let browser = "Unknown browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\//.test(ua)) browser = "Opera";
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua)) browser = "Safari";

  return `${os} / ${browser}`;
}

/* ------------------------------------------------------------------ */
/*  OTP                                                                */
/* ------------------------------------------------------------------ */

/** 6 digits from the CSPRNG — never Math.random() for a security code. */
function generateOtp(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 1_000_000).padStart(6, "0");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Best-effort geo enrichment. Anomaly detection never depends on this —
 * subnet comparison is the primary signal — so a rate-limited or down
 * lookup service degrades to "unknown location" instead of locking a
 * technician out of their bench.
 */
async function geoLookup(ip: string): Promise<string> {
  try {
    const res = await fetch(`https://ipapi.co/${ip}/json/`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return "Unknown location";
    const d = await res.json();
    return [d.city, d.region, d.country_name].filter(Boolean).join(", ") || "Unknown location";
  } catch {
    return "Unknown location";
  }
}

async function sendOtpEmail(
  to: string,
  code: string,
  meta: { ip: string; location: string; device: string; when: string; sessionName: string },
): Promise<boolean> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) {
    console.warn("RESEND_API_KEY not set — OTP generated but not emailed");
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Deno.env.get("OTP_FROM_EMAIL") ?? "Dr-Crown <noreply@dr-crown.com>",
        to: [to],
        subject: `Dr-Crown: verify new device (${code})`,
        html: `
          <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px">
            <h2 style="margin:0 0 4px">Verify a new Lab Station device</h2>
            <p style="color:#475569;margin:0 0 16px">
              A device signed in from somewhere new. Enter this code on that device to
              approve it. If this wasn't you, revoke the session in Settings and change
              your password.
            </p>
            <p style="font-size:30px;font-weight:800;letter-spacing:5px;margin:16px 0">${code}</p>
            <p style="color:#64748b;font-size:13px;margin:0 0 16px">Expires in 10 minutes.</p>
            <table style="font-size:13px;color:#334155;border-collapse:collapse">
              <tr><td style="padding:2px 12px 2px 0;color:#94a3b8">Device</td><td>${meta.sessionName} — ${meta.device}</td></tr>
              <tr><td style="padding:2px 12px 2px 0;color:#94a3b8">IP</td><td>${meta.ip}</td></tr>
              <tr><td style="padding:2px 12px 2px 0;color:#94a3b8">Location</td><td>${meta.location}</td></tr>
              <tr><td style="padding:2px 12px 2px 0;color:#94a3b8">Time</td><td>${meta.when}</td></tr>
            </table>
          </div>`,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("OTP email failed", err);
    return false;
  }
}

/**
 * Create an OTP challenge for a session and email it to the account owner.
 * Shared by the new-device and network-change paths.
 */
async function issueChallenge(
  admin: SupabaseClient,
  email: string,
  session: { id: string; session_name: string; device_label: string },
  ip: string | null,
  ua: string,
): Promise<{ emailed: boolean; location: string }> {
  const code = generateOtp();
  await admin.from("device_otp_challenges").insert({
    session_id: session.id,
    code_hash: await sha256(code),
  });

  const location = ip ? await geoLookup(ip) : "Unknown location";
  const emailed = await sendOtpEmail(email, code, {
    ip: ip ?? "unknown",
    location,
    device: session.device_label || deviceLabel(ua),
    when: new Date().toUTCString(),
    sessionName: session.session_name,
  });
  return { emailed, location };
}

/* ------------------------------------------------------------------ */
/*  Handlers                                                           */
/* ------------------------------------------------------------------ */

type Org = { clinic_id: string | null; lab_id: string | null };

async function handleHeartbeat(
  admin: SupabaseClient,
  userId: string,
  email: string,
  org: Org,
  body: { fingerprint?: string; sessionName?: string },
  req: Request,
) {
  const fingerprint = String(body.fingerprint ?? "").slice(0, 128);
  if (!fingerprint) return json({ error: "fingerprint required" }, 400);

  const ip = clientIp(req);
  const subnet = ip ? subnetOf(ip) : null;
  const ua = req.headers.get("user-agent") ?? "";

  const { data: existing } = await admin
    .from("lab_device_sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("device_fingerprint", fingerprint)
    .maybeSingle();

  // A revoked bench stays revoked until it signs in fresh — a heartbeat
  // must never quietly resurrect a session an admin killed.
  if (existing?.status === "REVOKED") {
    return json({ status: "REVOKED", sessionId: existing.id });
  }

  const orgFilter = org.clinic_id
    ? { column: "clinic_id", value: org.clinic_id }
    : { column: "lab_id", value: org.lab_id };

  // Is this IP/subnet already known-good for the org?
  let trusted = false;
  if (ip && orgFilter.value) {
    const { data: trustedRows } = await admin
      .from("lab_trusted_ips")
      .select("ip_address, cidr_subnet")
      .eq(orgFilter.column, orgFilter.value);
    trusted = (trustedRows ?? []).some(
      (r) => r.ip_address === ip || (subnet && r.cidr_subnet === subnet),
    );
  }

  // First time we've seen this device: challenge it, even from a trusted
  // network. Every bench proves mailbox access exactly once; verify-otp
  // then promotes it (and its network) to trusted. This means stolen
  // credentials alone can never silently enroll a new device.
  if (!existing) {
    const { data: created, error } = await admin
      .from("lab_device_sessions")
      .insert({
        user_id: userId,
        clinic_id: org.clinic_id,
        lab_id: org.lab_id,
        session_name: body.sessionName?.slice(0, 60) || deviceLabel(ua),
        device_fingerprint: fingerprint,
        user_agent: ua.slice(0, 400),
        device_label: deviceLabel(ua),
        current_ip: ip,
        last_ip: ip,
        ip_subnet: subnet,
        is_trusted: false,
        status: "CHALLENGE_REQUIRED",
      })
      .select()
      .single();
    if (error) return json({ error: error.message }, 500);

    const { emailed, location } = await issueChallenge(admin, email, created, ip, ua);
    return json({
      status: "CHALLENGE_REQUIRED",
      sessionId: created.id,
      firstSeen: true,
      reason: "NEW_DEVICE",
      emailed,
      location,
    });
  }

  const sameSubnet = !!subnet && subnet === existing.ip_subnet;
  const majorAnomaly = !!ip && !trusted && !sameSubnet && ip !== existing.current_ip;

  if (!majorAnomaly) {
    // Minor shift (or no change): update silently, non-blocking for the UI.
    await admin
      .from("lab_device_sessions")
      .update({
        current_ip: ip ?? existing.current_ip,
        last_ip: existing.current_ip,
        ip_subnet: subnet ?? existing.ip_subnet,
        last_active_at: new Date().toISOString(),
        // A challenged session only clears via verify-otp, never by drifting
        // back onto a trusted subnet.
        status: existing.status === "CHALLENGE_REQUIRED" ? "CHALLENGE_REQUIRED" : "ACTIVE",
      })
      .eq("id", existing.id);

    if (ip && trusted && orgFilter.value) {
      await admin
        .from("lab_trusted_ips")
        .update({ last_seen_at: new Date().toISOString() })
        .eq(orgFilter.column, orgFilter.value)
        .eq("ip_address", ip);
    }

    // A still-challenged bench whose code expired unused would otherwise be
    // stranded (its subnet is already stored, so no new anomaly ever fires).
    // Re-issue only when no live challenge remains — a heartbeat every 15
    // minutes must not turn into an email every 15 minutes.
    if (existing.status === "CHALLENGE_REQUIRED") {
      const { data: live } = await admin
        .from("device_otp_challenges")
        .select("id")
        .eq("session_id", existing.id)
        .is("consumed_at", null)
        .gt("expires_at", new Date().toISOString())
        .limit(1);
      if (!live?.length) {
        const { emailed, location } = await issueChallenge(admin, email, existing, ip, ua);
        return json({
          status: "CHALLENGE_REQUIRED",
          sessionId: existing.id,
          reason: existing.is_trusted ? "NETWORK_CHANGE" : "NEW_DEVICE",
          emailed,
          location,
        });
      }
    }

    return json({ status: existing.status, sessionId: existing.id });
  }

  /* Major anomaly — restrict, then challenge. */
  await admin
    .from("lab_device_sessions")
    .update({
      current_ip: ip,
      last_ip: existing.current_ip,
      ip_subnet: subnet,
      is_trusted: false,
      status: "CHALLENGE_REQUIRED",
      last_active_at: new Date().toISOString(),
    })
    .eq("id", existing.id);

  const { emailed, location } = await issueChallenge(admin, email, existing, ip, ua);

  return json({
    status: "CHALLENGE_REQUIRED",
    sessionId: existing.id,
    reason: "NETWORK_CHANGE",
    emailed,
    location,
    // Never return the code itself — it goes to the mailbox only.
  });
}

async function handleVerifyOtp(
  admin: SupabaseClient,
  userId: string,
  body: { sessionId?: string; code?: string },
) {
  const sessionId = String(body.sessionId ?? "");
  const code = String(body.code ?? "").trim();
  if (!sessionId || !/^\d{6}$/.test(code)) {
    return json({ error: "sessionId and a 6-digit code are required" }, 400);
  }

  const { data: session } = await admin
    .from("lab_device_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("user_id", userId) // can only clear a challenge on your own device
    .maybeSingle();
  if (!session) return json({ error: "Session not found" }, 404);

  const { data: challenge } = await admin
    .from("device_otp_challenges")
    .select("*")
    .eq("session_id", sessionId)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!challenge) return json({ error: "Code expired — sign in again to get a new one" }, 400);

  if (challenge.attempts >= 5) {
    return json({ error: "Too many attempts — sign in again to get a new code" }, 429);
  }

  if (challenge.code_hash !== (await sha256(code))) {
    await admin
      .from("device_otp_challenges")
      .update({ attempts: challenge.attempts + 1 })
      .eq("id", challenge.id);
    return json({ error: "Incorrect code" }, 400);
  }

  await admin
    .from("device_otp_challenges")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", challenge.id);

  await admin
    .from("lab_device_sessions")
    .update({ is_trusted: true, status: "ACTIVE", last_active_at: new Date().toISOString() })
    .eq("id", sessionId);

  // Promote the IP that triggered the challenge to trusted, so the same
  // bench isn't challenged again tomorrow from the same place.
  if (session.current_ip) {
    await admin.from("lab_trusted_ips").insert({
      clinic_id: session.clinic_id,
      lab_id: session.lab_id,
      ip_address: session.current_ip,
      cidr_subnet: session.ip_subnet ?? session.current_ip,
      label: "Verified by OTP",
    });
  }

  return json({ status: "ACTIVE", sessionId });
}

/* ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  // Identify the caller with their own JWT (RLS applies)...
  const asUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);
  const user = userData.user;

  // ...then do privileged writes with the service role, so a client can
  // never set its own trust/status columns.
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: profile } = await admin
    .from("profiles")
    .select("clinic_id, lab_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) return json({ error: "No profile for this user" }, 403);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const org: Org = { clinic_id: profile.clinic_id, lab_id: profile.lab_id };

  try {
    switch (body.action) {
      case "heartbeat":
        return await handleHeartbeat(admin, user.id, user.email ?? "", org, body, req);
      case "verify-otp":
        return await handleVerifyOtp(admin, user.id, body);
      default:
        return json({ error: `Unknown action: ${String(body.action)}` }, 400);
    }
  } catch (err) {
    console.error("station-session error", err);
    return json({ error: "Internal error" }, 500);
  }
});
