/**
 * Case email notifications: fired by a Supabase Database Webhook on the
 * `cases` table (NOT called directly from the browser) —
 *   INSERT             → email the LAB a new case was sent to it
 *   UPDATE into "Work Complete" → email the CLINIC the case is ready
 *
 * Wired this way (DB webhook → this function) rather than from client code
 * so it fires no matter which screen/action changed the row, instead of
 * needing every future client mutation path to remember to call it.
 *
 * Deploy:
 *   Supabase Dashboard → Edge Functions → New function → name it exactly
 *   "case-notify" (type the name yourself — don't accept an auto-generated
 *   slug, that's how station-session ended up deployed as "super-processor")
 *   → paste this file.
 *
 * Then wire the trigger (Dashboard → Database → Webhooks → Create a new
 * hook): table "cases", events INSERT + UPDATE, type "Edge Function",
 * target this function, HTTP header  Authorization: Bearer <anon key>
 * (the anon key is safe to put there — it's already public in the client
 * bundle; never put the service role key in that header field).
 *
 * Secrets reused from the existing station-session function — no new ones
 * to set: RESEND_API_KEY, OTP_FROM_EMAIL (kept that name for continuity;
 * it's really just "from" address for any transactional email this app
 * sends, not OTP-specific).
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Mirrors STAGE_INDEX in src/LifecycleEngine.jsx — keep in sync if the
// pipeline's stage order ever changes there.
const WORK_COMPLETE_INDEX = 3;

const APP_URL = "https://dr-crown.com";

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) {
    console.warn("RESEND_API_KEY not set — case notification not emailed");
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        // Fixed sender: OTP_FROM_EMAIL is "Dr-Crown Security <...>" (set for the
        // old device-OTP flow) — wrong voice for case/invite emails.
        from: "Dr-Crown <noreply@dr-crown.com>",
        to: [to],
        subject,
        html,
      }),
    });
    if (!res.ok) console.error("case-notify: Resend responded", res.status, await res.text());
    return res.ok;
  } catch (err) {
    console.error("case-notify: email send failed", err);
    return false;
  }
}

function emailShell(title: string, bodyHtml: string): string {
  return `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px">
      <h2 style="margin:0 0 12px">${title}</h2>
      ${bodyHtml}
      <p style="margin:20px 0 0">
        <a href="${APP_URL}" style="color:#2563eb;text-decoration:none;font-weight:600">Open Dr-Crown &rarr;</a>
      </p>
    </div>`;
}

function caseSummaryRows(record: Record<string, unknown>): string {
  const rx = (record.prescription ?? {}) as Record<string, unknown>;
  const row = (label: string, value: unknown) =>
    value ? `<tr><td style="padding:2px 12px 2px 0;color:#94a3b8">${label}</td><td style="color:#1e293b;font-weight:600">${value}</td></tr>` : "";
  return `
    <table style="font-size:13px;border-collapse:collapse;margin:12px 0">
      ${row("Patient", record.patient_name)}
      ${row("Restoration", rx.category)}
      ${row("Material", rx.material && rx.material !== "Refer to notes" ? rx.material : "")}
      ${row("Deliver by", record.appointment_date)}
    </table>`;
}

/* ------------------------------------------------------------------ */

/**
 * Shared-secret gate. FAIL-CLOSED: a missing, blank or mismatched secret
 * refuses the request. The old logic skipped the check when the function
 * secret was unset ("so notifications don't stop before setup") — but this
 * endpoint runs with Verify-JWT OFF, so an unset secret meant the whole
 * internet could make the platform send mail. A misconfiguration must break
 * loudly (500) instead of quietly opening the door.
 *
 * Comparison is length-checked then constant-time, so a caller can't probe
 * the secret one character at a time by measuring response latency.
 */
function secretGate(req: Request): Response | null {
  const expected = Deno.env.get("CASE_NOTIFY_SECRET");
  if (!expected || expected.trim() === "") {
    console.error("CASE_NOTIFY_SECRET is not set — refusing every request until it is configured.");
    return json({ error: "Server misconfigured" }, 500);
  }
  const provided = req.headers.get("x-webhook-secret");
  if (!provided || !timingSafeEqual(provided, expected)) {
    return json({ error: "Unauthorized" }, 401);
  }
  return null; // caller is trusted
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // This function runs with "Verify JWT" OFF (the pg_net trigger can't mint
  // a platform-accepted JWT on this project's new signing keys), which makes
  // the endpoint publicly reachable — without this check, anyone could POST
  // a fabricated webhook payload and have the platform email real labs and
  // clinics with attacker-chosen content. The trigger sends a shared secret
  // (read from the private.webhook_config table, NOT hardcoded in the
  // public schema.sql) which must match the CASE_NOTIFY_SECRET function
  // secret — see secretGate above, which fails closed if it isn't set.
  const denied = secretGate(req);
  if (denied) return denied;

  let payload: {
    type?: string;
    table?: string;
    record?: Record<string, unknown>;
    old_record?: Record<string, unknown>;
  };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { type, record, old_record } = payload;
  const table = payload.table ?? "cases";
  if (!record) return json({ ok: true, skipped: "no record" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    // ---------------- staff invitations (lab_members INSERTs) ----------------
    if (table === "lab_members") {
      if (type !== "INSERT" || record.user_id || !record.email) {
        return json({ ok: true, skipped: "not an unclaimed invite" });
      }
      // A dual-role invite inserts TWO rows (lab_admin + lab_tech) in one
      // statement, firing this webhook twice. Only the lab_tech row sends
      // the email; a lone lab_admin invite (no tech sibling) sends its own.
      if (record.role === "lab_admin") {
        const { data: sibling } = await admin
          .from("lab_members")
          .select("id")
          .eq("lab_id", record.lab_id)
          .is("user_id", null)
          .eq("role", "lab_tech")
          .ilike("email", String(record.email))
          .maybeSingle();
        if (sibling) return json({ ok: true, skipped: "dual-role invite — tech row emails" });
      }

      const [{ data: lab }, { data: roleRows }] = await Promise.all([
        admin.from("labs").select("name").eq("id", record.lab_id).maybeSingle(),
        admin
          .from("lab_members")
          .select("role")
          .eq("lab_id", record.lab_id)
          .is("user_id", null)
          .ilike("email", String(record.email)),
      ]);
      const labName = lab?.name ?? "a dental lab";
      const roles =
        (roleRows ?? [])
          .map((r) => (r.role === "lab_admin" ? "Lab Admin" : "Technician"))
          .join(" + ") || "Technician";
      const link = `${APP_URL}/?invite_email=${encodeURIComponent(String(record.email))}`;

      const emailed = await sendEmail(
        String(record.email),
        `You're invited to join ${labName} on Dr-Crown`,
        emailShell(
          `Join ${labName} on Dr-Crown`,
          `<p style="color:#475569">You've been invited to join <b>${labName}</b> as <b>${roles}</b>.</p>
           <p style="color:#475569">Create your account with <b>this email address</b> and choose a password &mdash;
           the invitation is linked to it, so after confirming your email you'll be offered to join
           ${labName} automatically.</p>
           <p style="margin:16px 0">
             <a href="${link}" style="background:#2563eb;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Create your account</a>
           </p>`,
        ),
      );
      return json({ ok: true, emailed });
    }

    // ---------------- case notifications (cases table) ----------------
    if (type === "INSERT") {
      // A new case was sent to a lab — email the lab.
      if (!record.lab_id) return json({ ok: true, skipped: "no lab assigned" });

      const [{ data: lab }, { data: clinic }] = await Promise.all([
        // notify_email: the recipient the lab admin designated in Lab
        // Settings (themselves or a technician); empty = general lab email.
        admin.from("labs").select("name, email, notify_email").eq("id", record.lab_id).maybeSingle(),
        admin.from("clinics").select("name").eq("id", record.clinic_id).maybeSingle(),
      ]);
      const recipient = (lab?.notify_email ?? "").trim() || lab?.email;
      if (!recipient) return json({ ok: true, skipped: "lab has no email on file" });

      // Dentist ticked "Request a lab pick-up" on the Rx form.
      const rxData = (record.prescription ?? {}) as Record<string, unknown>;
      const pickupLine = rxData.pickupRequested
        ? `<p style="margin:10px 0;padding:8px 12px;background:#eff6ff;border-radius:8px;color:#1d4ed8;font-weight:600">&#128666; Pick-up requested &mdash; the clinic asks you to collect this case.</p>`
        : "";

      const emailed = await sendEmail(
        recipient,
        `New case from ${clinic?.name ?? "a clinic"}: ${record.patient_name}${rxData.pickupRequested ? " (pick-up requested)" : ""}`,
        emailShell(
          `New case sent to ${lab.name}`,
          `<p style="color:#475569">${clinic?.name ?? "A clinic"} just sent you a new case, case ID <b>${record.id}</b>.</p>${pickupLine}${caseSummaryRows(record)}`,
        ),
      );
      return json({ ok: true, emailed });
    }

    if (type === "UPDATE") {
      const wasComplete = typeof old_record?.stage_index === "number" && (old_record.stage_index as number) >= WORK_COMPLETE_INDEX;
      const isComplete = typeof record.stage_index === "number" && (record.stage_index as number) >= WORK_COMPLETE_INDEX;
      // Only the crossing INTO complete, not every update while already complete/beyond.
      if (wasComplete || !isComplete) return json({ ok: true, skipped: "not a new completion" });

      const [{ data: clinic }, { data: lab }] = await Promise.all([
        admin.from("clinics").select("name, email").eq("id", record.clinic_id).maybeSingle(),
        admin.from("labs").select("name").eq("id", record.lab_id).maybeSingle(),
      ]);
      if (!clinic?.email) return json({ ok: true, skipped: "clinic has no email on file" });

      const emailed = await sendEmail(
        clinic.email,
        `${lab?.name ?? "Your lab"} marked ${record.patient_name}'s case complete`,
        emailShell(
          "Case complete: ready for pickup",
          `<p style="color:#475569">${lab?.name ?? "Your lab"} finished case <b>${record.id}</b> and it's ready to collect.</p>${caseSummaryRows(record)}`,
        ),
      );
      return json({ ok: true, emailed });
    }

    return json({ ok: true, skipped: `unhandled type ${type}` });
  } catch (err) {
    console.error("case-notify error", err);
    // 200, not 500: a failed notification must never make Supabase treat the
    // underlying case write as failed or retry-storm the webhook.
    return json({ ok: false, error: "Internal error" });
  }
});
