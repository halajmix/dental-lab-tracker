/**
 * Read-only production health check. Prints counts and timestamps, never row
 * contents, so it is safe to run and paste anywhere.
 *
 *   node scripts/health-check.mjs
 *
 * Covers: table liveness + row counts, recent client-side crash reports,
 * recent sign-in activity, edge-function deployment, and local backup age.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { serviceKey } from "./lib/serviceKey.mjs";

const URL_BASE = "https://mtxkushcxczjwypwoxdh.supabase.co";
// station-session is deliberately absent: the device-OTP step-up was removed
// 2026-08-13 and nothing in the client calls it. Listing it would report a
// 404 as breakage every run.
const FUNCTIONS = ["case-notify", "payment-reminders", "mobile-upload", "admin-actions"];
const key = serviceKey();
const headers = { apikey: key, Authorization: `Bearer ${key}` };

const count = async (table, filter = "", idCol = "id") => {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?select=${idCol}${filter}`, {
    headers: { ...headers, Prefer: "count=exact", Range: "0-0" },
  });
  if (!res.ok) return `ERROR ${res.status}`;
  return Number(res.headers.get("content-range")?.split("/")[1] ?? 0);
};
const latest = async (table, col = "created_at") => {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?select=${col}&order=${col}.desc&limit=1`, { headers });
  if (!res.ok) return `ERROR ${res.status}`;
  const [row] = await res.json();
  return row?.[col] ?? "never";
};
const ago = (iso) => {
  if (!iso || iso === "never" || String(iso).startsWith("ERROR")) return iso;
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  return `${iso.slice(0, 16).replace("T", " ")}  (${d < 1 ? `${Math.round(d * 24)}h` : `${Math.round(d)}d`} ago)`;
};

console.log("=== data ===");
for (const t of ["labs", "clinics", "profiles", "cases", "case_rounds", "clinic_statements", "lab_payments"]) {
  console.log(`  ${t.padEnd(20)} ${await count(t)}`);
}

console.log("\n=== activity ===");
console.log(`  newest case        ${ago(await latest("cases"))}`);
console.log(`  newest round       ${ago(await latest("case_rounds"))}`);
console.log(`  newest login event ${ago(await latest("login_events"))}`);

console.log("\n=== client crash reports (client_errors) ===");
const week = new Date(Date.now() - 7 * 86400000).toISOString();
console.log(`  total              ${await count("client_errors")}`);
console.log(`  last 7 days        ${await count("client_errors", `&at=gte.${week}`)}`);
console.log(`  newest             ${ago(await latest("client_errors", "at"))}`);

console.log("\n=== housekeeping ===");
console.log(`  open rx drafts     ${await count("rx_drafts", "", "user_id")}`);
console.log(`  upload sessions    ${await count("mobile_upload_sessions")}`);
console.log(`  otp challenges     ${await count("device_otp_challenges")}`);
console.log(`  pending invites    ${await count("clinic_invitations", "&status=eq.pending")}`);

console.log("\n=== edge functions (401/400 = deployed, 404 = missing) ===");
for (const fn of FUNCTIONS) {
  try {
    const res = await fetch(`${URL_BASE}/functions/v1/${fn}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    console.log(`  ${fn.padEnd(20)} HTTP ${res.status}${res.status === 404 ? "  ← NOT DEPLOYED" : ""}`);
  } catch (e) {
    console.log(`  ${fn.padEnd(20)} unreachable: ${e.message}`);
  }
}

console.log("\n=== backups ===");
const dir = join(homedir(), "DrCrown-Backups");
if (!existsSync(dir)) console.log("  no backup directory");
else {
  const dumps = readdirSync(dir)
    .filter((d) => /^backup-\d{4}-\d{2}-\d{2}/.test(d) && statSync(join(dir, d)).isDirectory())
    .sort().reverse();
  const failures = readdirSync(dir).filter((d) => d.startsWith("backup-failure"));
  if (failures.length) console.log(`  failure logs       ${failures.length}  (${failures.sort().pop()})`);
  console.log(`  kept               ${dumps.length}`);
  if (dumps[0]) {
    const age = (Date.now() - statSync(join(dir, dumps[0])).mtimeMs) / 86400000;
    console.log(`  newest             ${dumps[0]}  (${Math.round(age)}d ago)${age > 8 ? "  ← STALE" : ""}`);
  }
}
