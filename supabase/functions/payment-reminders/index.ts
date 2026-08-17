/**
 * Monthly payment reminders: fired by a pg_cron job (schema.sql Phase 23)
 * on the 25th of each month — NOT called from the browser and NOT a row
 * webhook. For every (lab, clinic) pair with ISSUED-but-unpaid invoices,
 * emails the clinic one summary of what it owes that lab. Cases whose
 * invoice_status is still "draft" are deliberately never mentioned — you
 * can't dun someone for an invoice that was never issued.
 *
 * Deploy:
 *   Supabase Dashboard → Edge Functions → New function → name it exactly
 *   "payment-reminders" (type the name yourself — don't accept an
 *   auto-generated slug) → paste this file → in the function's Settings
 *   turn "Verify JWT with legacy secret" OFF (same as case-notify; the
 *   pg_net caller can't mint a platform JWT on this project's signing keys).
 *
 * Secrets: reuses RESEND_API_KEY, OTP_FROM_EMAIL and CASE_NOTIFY_SECRET —
 * nothing new to set.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const APP_URL = "https://dr-crown.com";

const fmtOMR = (n: number) =>
  `${n.toLocaleString("en", { minimumFractionDigits: 0, maximumFractionDigits: 3 })} OMR`;

async function sendEmail(to: string, replyTo: string | undefined, subject: string, html: string): Promise<boolean> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) {
    console.warn("RESEND_API_KEY not set — payment reminder not emailed");
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Deno.env.get("OTP_FROM_EMAIL") ?? "Dr-Crown <noreply@dr-crown.com>",
        to: [to],
        ...(replyTo ? { reply_to: replyTo } : {}),
        subject,
        html,
      }),
    });
    if (!res.ok) console.error("payment-reminders: Resend responded", res.status, await res.text());
    return res.ok;
  } catch (err) {
    console.error("payment-reminders: email send failed", err);
    return false;
  }
}

type CaseRow = {
  id: string;
  invoice_number: string | null;
  patient_name: string | null;
  total_price: number | null;
  clinic_id: string;
  lab_id: string;
};

function invoiceTable(rows: CaseRow[]): { html: string; total: number } {
  let total = 0;
  const tr = rows
    .map((c) => {
      const amount = typeof c.total_price === "number" ? c.total_price : null;
      if (amount !== null) total += amount;
      return `<tr>
        <td style="padding:4px 12px 4px 0;color:#1e293b;font-weight:600">${c.invoice_number || c.id}</td>
        <td style="padding:4px 12px 4px 0;color:#475569">${c.patient_name ?? ""}</td>
        <td style="padding:4px 0;color:#1e293b;text-align:right">${amount !== null ? fmtOMR(amount) : "—"}</td>
      </tr>`;
    })
    .join("");
  const html = `
    <table style="font-size:13px;border-collapse:collapse;margin:12px 0;width:100%">
      <tr>
        <th style="text-align:left;color:#94a3b8;font-weight:600;padding-right:12px">Invoice</th>
        <th style="text-align:left;color:#94a3b8;font-weight:600;padding-right:12px">Patient</th>
        <th style="text-align:right;color:#94a3b8;font-weight:600">Amount</th>
      </tr>
      ${tr}
      <tr>
        <td colspan="2" style="padding:8px 12px 0 0;color:#1e293b;font-weight:700;border-top:1px solid #e2e8f0">Total outstanding</td>
        <td style="padding:8px 0 0;color:#1e293b;font-weight:700;text-align:right;border-top:1px solid #e2e8f0">${fmtOMR(total)}</td>
      </tr>
    </table>`;
  return { html, total };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Same public-endpoint reasoning as case-notify: Verify JWT is OFF, so the
  // shared secret is the only gate. Without it, anyone could make the
  // platform dun real clinics on demand.
  const expected = Deno.env.get("CASE_NOTIFY_SECRET");
  if (expected && req.headers.get("x-webhook-secret") !== expected) {
    return json({ error: "Unauthorized" }, 401);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const { data: unpaid, error } = await admin
      .from("cases")
      .select("id, invoice_number, patient_name, total_price, clinic_id, lab_id")
      .eq("invoice_status", "issued");
    if (error) throw error;
    if (!unpaid?.length) return json({ ok: true, groups: 0, emailed: 0 });

    // Group by lab+clinic pair — a clinic owing two labs gets two emails,
    // each from the right lab's perspective.
    const groups = new Map<string, CaseRow[]>();
    for (const c of unpaid as CaseRow[]) {
      const k = `${c.lab_id}:${c.clinic_id}`;
      groups.set(k, [...(groups.get(k) ?? []), c]);
    }

    const labIds = [...new Set(unpaid.map((c) => c.lab_id))];
    const clinicIds = [...new Set(unpaid.map((c) => c.clinic_id))];
    const [{ data: labs }, { data: clinics }] = await Promise.all([
      admin.from("labs").select("id, name, email").in("id", labIds),
      admin.from("clinics").select("id, name, email").in("id", clinicIds),
    ]);
    const labById = new Map((labs ?? []).map((l) => [l.id, l]));
    const clinicById = new Map((clinics ?? []).map((c) => [c.id, c]));

    let emailed = 0;
    for (const [key, rows] of groups) {
      const [labId, clinicId] = key.split(":");
      const lab = labById.get(labId);
      const clinic = clinicById.get(clinicId);
      if (!clinic?.email) continue; // surfaced in the lab's dashboard as "no email — can't be reminded"

      const { html, total } = invoiceTable(rows);
      const ok = await sendEmail(
        clinic.email,
        lab?.email || undefined,
        `Payment reminder — ${rows.length} outstanding invoice${rows.length === 1 ? "" : "s"} with ${lab?.name ?? "your lab"} (${fmtOMR(total)})`,
        `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px">
          <h2 style="margin:0 0 12px">Outstanding invoices with ${lab?.name ?? "your dental lab"}</h2>
          <p style="color:#475569">Dear ${clinic.name ?? "clinic"}, the following invoices are still unpaid.
          If you've already settled them, please ask ${lab?.name ?? "the lab"} to mark them paid — replying
          to this email reaches them directly.</p>
          ${html}
          <p style="margin:20px 0 0">
            <a href="${APP_URL}" style="color:#2563eb;text-decoration:none;font-weight:600">Open Dr-Crown &rarr;</a>
          </p>
        </div>`,
      );
      if (ok) emailed++;
    }

    return json({ ok: true, groups: groups.size, emailed });
  } catch (err) {
    console.error("payment-reminders error", err);
    // 200 so pg_net never retry-storms; the cron just tries again next month.
    return json({ ok: false, error: "Internal error" });
  }
});
