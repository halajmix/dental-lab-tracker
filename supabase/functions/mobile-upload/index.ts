/**
 * QR mobile photo upload (Phase 51) — the PUBLIC gatekeeper between an
 * anonymous phone and the PRIVATE case-photos bucket.
 *
 * Deploy: Supabase Dashboard -> Edge Functions -> New function -> name it
 * exactly "mobile-upload" -> paste this file -> turn "Verify JWT with
 * legacy secret" OFF (the phone is anonymous; the session token is the
 * auth, validated fail-closed below).
 *
 * Flow:
 *   - the AUTHENTICATED desktop inserts a mobile_upload_sessions row (RLS)
 *     and shows its id as a QR;
 *   - the phone opens /mobile-upload/<token> (no login) and talks only to
 *     this function:  GET  ?action=info&token=...   validity check
 *                     POST multipart (token + files) the actual upload;
 *   - files land in case-photos/<desktop-uid>/<group>/mob-*.jpg — the same
 *     folder the desktop uploads to itself, so Phase 50 signed-URL access
 *     rules apply unchanged;
 *   - the row's `uploaded` array is appended and status flips to 'used'
 *     (single use); the desktop hears it over Realtime.
 *
 * Fail-closed: no token, unknown token, expired, cancelled or already-used
 * -> refused. Limits: max 10 files per session, 10 MB each, images only
 * (the bucket enforces the same limits platform-side as a second layer).
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const MAX_FILES = 10;
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const BUCKET = "case-photos";

// The mobile page is served from the app's own origins only.
const ORIGINS = new Set(["https://dr-crown.com", "https://www.dr-crown.com", "http://localhost:5173"]);

function cors(origin: string | null): Record<string, string> {
  const allow = origin && ORIGINS.has(origin) ? origin : "https://dr-crown.com";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Validate the token and load its session. Deliberately the same terse
  // error for every failure mode — an anonymous caller learns nothing about
  // WHY a token is bad.
  async function loadSession(token: string | null) {
    if (!token || !UUID_RE.test(token)) return null;
    const { data } = await admin
      .from("mobile_upload_sessions")
      .select("id, user_id, group_id, status, uploaded, expires_at")
      .eq("id", token)
      .maybeSingle();
    if (!data) return null;
    if (data.status !== "pending") return null;
    if (new Date(data.expires_at).getTime() < Date.now()) return null;
    return data;
  }

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      if (url.searchParams.get("action") !== "info") return json({ error: "Unknown action" }, 400, origin);
      const session = await loadSession(url.searchParams.get("token"));
      if (!session) return json({ ok: false }, 401, origin);
      return json({ ok: true, expiresAt: session.expires_at }, 200, origin);
    }

    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);

    const form = await req.formData();
    const session = await loadSession(String(form.get("token") ?? ""));
    if (!session) return json({ error: "This upload link is invalid or has expired." }, 401, origin);

    const files = form.getAll("photos").filter((f): f is File => f instanceof File);
    if (files.length === 0) return json({ error: "No photos attached." }, 400, origin);
    if (files.length > MAX_FILES) return json({ error: `At most ${MAX_FILES} photos per upload.` }, 400, origin);

    const uploaded: { name: string; size: number; url: string; kind: string }[] = [];
    for (const [i, file] of files.entries()) {
      if (file.size > MAX_BYTES) return json({ error: `"${file.name}" is over 10 MB.` }, 400, origin);
      if (!ALLOWED.has(file.type)) return json({ error: `"${file.name}" is not a supported image.` }, 400, origin);
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const path = `${session.user_id}/${session.group_id}/mob-${Date.now().toString(36)}-${i}.${ext}`;
      const { error } = await admin.storage
        .from(BUCKET)
        .upload(path, await file.arrayBuffer(), { contentType: file.type });
      if (error) return json({ error: "Upload failed — please try again." }, 500, origin);
      // Stored in the app's canonical public-URL format: the PATH inside it is
      // what the client's signing layer extracts, same as desktop uploads.
      const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
      uploaded.push({ name: file.name, size: file.size, url: pub.publicUrl, kind: "photo" });
    }

    // Single use: append the batch and burn the token in one write. The
    // desktop's Realtime subscription delivers this row change instantly.
    const { error: updErr } = await admin
      .from("mobile_upload_sessions")
      .update({ uploaded: [...(session.uploaded ?? []), ...uploaded], status: "used" })
      .eq("id", session.id)
      .eq("status", "pending"); // token raced twice -> second write no-ops
    if (updErr) return json({ error: "Upload recorded but session update failed." }, 500, origin);

    return json({ ok: true, count: uploaded.length }, 200, origin);
  } catch (err) {
    console.error("mobile-upload error:", err);
    return json({ error: "Unexpected error." }, 500, origin);
  }
});
