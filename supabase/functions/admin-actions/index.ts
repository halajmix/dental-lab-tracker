/**
 * Privileged Super Admin actions — anything that needs the service role
 * (deleting a login, listing raw auth.users, generating an impersonation
 * session) can't be done from the browser even with RLS, since none of
 * that is exposed through PostgREST. Every action here re-checks the
 * caller is a role='admin' profile before doing anything; RLS still
 * protects the rest of the app independently of this function.
 *
 * Deploy: Supabase Dashboard -> Edge Functions -> New function -> name it
 * exactly "admin-actions" (type it yourself, don't accept an auto slug).
 *
 * Actions (POST body { action: ... }):
 *   list-users     — every auth.users row (id, email, confirmed, created_at)
 *   impersonate    — { userId } -> a one-time magic-link token for that user
 *   delete-account — { userId } -> deletes the login; profile cascades, and
 *                    if they own a clinic that cascades too (its cases with
 *                    it); a lab they own is deleted explicitly since a lab
 *                    row otherwise survives its owner (re-claimable by design)
 *   delete-org     — { orgType: "clinic"|"lab", id } -> deletes an org row
 *                    directly (for unclaimed/orphaned test rows with no login)
 *   delete-case    — { caseId } -> deletes one case row
 *   set-lab-status — { labId, status: "active"|"suspended" } -> tenant on/off;
 *                    a suspended lab's members lose all data access via
 *                    my_lab_id() until re-activated. Also how a 'pending'
 *                    (Phase 30 signup-approval) lab gets activated.
 *   set-clinic-status — { clinicId, status: "active"|"suspended" } -> same
 *                    lifecycle for clinics via my_clinic_id(); activates
 *                    'pending' new-signup clinics and can suspend one.
 *   set-lab-role   — { userId, labId, roles: ["lab_admin"?, "lab_tech"?] } ->
 *                    sync a member's lab_members rows to exactly those roles
 *                    (e.g. upgrade a tech to dual-role). At least one role
 *                    required — removing someone entirely is a suspension,
 *                    not a row deletion.
 *   transfer-lab-ownership — { labId, newOwnerId } -> hands labs.owner_id to
 *                    another existing member (for labs registered by a
 *                    technician where the real owner signed up later). The
 *                    labs trigger auto-grants the new owner dual-role rows;
 *                    the OLD owner keeps their current roles and becomes a
 *                    normal member — demote them with set-lab-role after.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  // Identify the caller with their own JWT first...
  const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(supabaseUrl, serviceKey);

  // ...then confirm they're actually an admin before anything privileged runs.
  const { data: profile } = await admin.from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
  if (profile?.role !== "admin") return json({ error: "Admin only" }, 403);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  try {
    switch (body.action) {
      case "list-users": {
        const { data, error } = await admin.auth.admin.listUsers({ perPage: 500 });
        if (error) throw error;
        return json({
          ok: true,
          users: data.users.map((u) => ({
            id: u.id,
            email: u.email,
            createdAt: u.created_at,
            emailConfirmedAt: u.email_confirmed_at,
          })),
        });
      }

      case "impersonate": {
        const userId = String(body.userId ?? "");
        if (!userId) return json({ error: "userId required" }, 400);
        const { data: target, error: getErr } = await admin.auth.admin.getUserById(userId);
        if (getErr || !target?.user?.email) return json({ error: "User not found" }, 404);

        const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
          type: "magiclink",
          email: target.user.email,
        });
        if (linkErr) throw linkErr;
        const hashedToken = link.properties?.hashed_token;
        if (!hashedToken) return json({ error: "Could not generate impersonation link" }, 500);
        return json({ ok: true, hashedToken, email: target.user.email });
      }

      case "delete-account": {
        const userId = String(body.userId ?? "");
        if (!userId) return json({ error: "userId required" }, 400);

        // Look up what they own BEFORE deleting the login — deleting a
        // clinic owner cascades their clinic (and its cases) automatically
        // via FK, but labs.owner_id is ON DELETE SET NULL (a lab survives
        // its owner, by design, so it can be re-claimed) — so a lab has to
        // be deleted explicitly to actually go away here.
        const { data: victimProfile } = await admin
          .from("profiles")
          .select("role, lab_id")
          .eq("id", userId)
          .maybeSingle();

        const { error: delErr } = await admin.auth.admin.deleteUser(userId);
        if (delErr) throw delErr;

        if (victimProfile?.role === "lab" && victimProfile.lab_id) {
          await admin.from("labs").delete().eq("id", victimProfile.lab_id);
        }
        return json({ ok: true });
      }

      case "delete-org": {
        const orgType = String(body.orgType ?? "");
        const id = String(body.id ?? "");
        if (!id || (orgType !== "clinic" && orgType !== "lab")) return json({ error: "orgType and id required" }, 400);
        const { error } = await admin.from(orgType === "clinic" ? "clinics" : "labs").delete().eq("id", id);
        if (error) throw error;
        return json({ ok: true });
      }

      case "delete-case": {
        const caseId = String(body.caseId ?? "");
        if (!caseId) return json({ error: "caseId required" }, 400);
        const { error } = await admin.from("cases").delete().eq("id", caseId);
        if (error) throw error;
        return json({ ok: true });
      }

      case "set-lab-status": {
        const labId = String(body.labId ?? "");
        const status = String(body.status ?? "");
        if (!labId || (status !== "active" && status !== "suspended")) {
          return json({ error: "labId and status (active|suspended) required" }, 400);
        }
        const { error } = await admin.from("labs").update({ status }).eq("id", labId);
        if (error) throw error;
        return json({ ok: true });
      }

      case "set-clinic-status": {
        const clinicId = String(body.clinicId ?? "");
        const status = String(body.status ?? "");
        if (!clinicId || (status !== "active" && status !== "suspended")) {
          return json({ error: "clinicId and status (active|suspended) required" }, 400);
        }
        const { error } = await admin.from("clinics").update({ status }).eq("id", clinicId);
        if (error) throw error;
        return json({ ok: true });
      }

      case "set-lab-role": {
        const userId = String(body.userId ?? "");
        const labId = String(body.labId ?? "");
        const roles = Array.isArray(body.roles)
          ? body.roles.filter((r: unknown) => r === "lab_admin" || r === "lab_tech" || r === "accountant")
          : [];
        if (!userId || !labId) return json({ error: "userId and labId required" }, 400);
        if (!roles.length) return json({ error: "at least one role required" }, 400);

        const { data: prof } = await admin.from("profiles").select("lab_id").eq("id", userId).maybeSingle();
        if (prof?.lab_id !== labId) return json({ error: "user is not a member of this lab" }, 400);

        const { data: target } = await admin.auth.admin.getUserById(userId);
        const email = target?.user?.email ?? "";

        const { data: existing } = await admin
          .from("lab_members")
          .select("id, role")
          .eq("lab_id", labId)
          .eq("user_id", userId);
        const have = new Set((existing ?? []).map((r) => r.role));
        for (const r of roles) {
          if (!have.has(r)) {
            const { error } = await admin
              .from("lab_members")
              .insert({ lab_id: labId, user_id: userId, email, role: r, status: "active" });
            if (error) throw error;
          }
        }
        for (const row of existing ?? []) {
          if (!roles.includes(row.role)) {
            const { error } = await admin.from("lab_members").delete().eq("id", row.id);
            if (error) throw error;
          }
        }
        return json({ ok: true });
      }

      case "transfer-lab-ownership": {
        const labId = String(body.labId ?? "");
        const newOwnerId = String(body.newOwnerId ?? "");
        if (!labId || !newOwnerId) return json({ error: "labId and newOwnerId required" }, 400);

        // The new owner must already be a signed-up member of this lab.
        const { data: prof } = await admin.from("profiles").select("lab_id, role").eq("id", newOwnerId).maybeSingle();
        if (prof?.role !== "lab" || prof?.lab_id !== labId) {
          return json({ error: "new owner must be an existing member of this lab" }, 400);
        }

        const { error } = await admin.from("labs").update({ owner_id: newOwnerId }).eq("id", labId);
        if (error) throw error;
        // labs_owner_membership trigger grants the new owner active
        // lab_admin + lab_tech rows automatically; nothing else to do.
        return json({ ok: true });
      }

      default:
        return json({ error: `Unknown action: ${String(body.action)}` }, 400);
    }
  } catch (err) {
    console.error("admin-actions error", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
