// Read-only full-platform audit for Dr-Crown. Prints PASS/WARN/FAIL lines;
// changes nothing. Run: node scripts/audit.mjs
// Needs the service key in ~/.drcrown-backup-env (same as backup.mjs).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const key = readFileSync(`${homedir()}/.drcrown-backup-env`, "utf8").match(/SERVICE_ROLE_KEY=(\S+)/)[1];
const url = readFileSync(join(repo, ".env"), "utf8").match(/VITE_SUPABASE_URL=(\S+)/)[1];
const H = { apikey: key, Authorization: `Bearer ${key}` };
const get = async (p) => {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${url}/rest/v1/${p}${p.includes("?") ? "&" : "?"}limit=1000&offset=${from}`, { headers: H });
    const page = await r.json();
    if (!Array.isArray(page)) throw new Error(p + " -> " + JSON.stringify(page).slice(0, 120));
    all.push(...page);
    if (page.length < 1000) return all;
  }
};
const say = (level, label, extra = "") => console.log(`${level.padEnd(5)} ${label}${extra ? " — " + extra : ""}`);

// Must mirror price_case()'s appliance list (Phase 34).
const APPLIANCE = new Set(["Removable denture","Michigan splint","Orthodontics splint","Single layer splint - soft","Double layer splint - soft","Double layer splint - outer hard, inner soft","Others - refer to notes"]);

const [labs, clinics, cases, schedules, items, rules, statements, payments, expenses, profiles, members, logins] = await Promise.all([
  get("labs?select=id,name,status,owner_id"),
  get("clinics?select=id,name,status,owner_id"),
  get("cases?select=id,clinic_id,lab_id,prescription,invoice_status,statement_id,total_price,price_overridden,cancel_status,cancellation_fee,remake,stage_index,created_at,lab_shade"),
  get("price_schedules?select=id,lab_id,name,is_default"),
  get("price_schedule_items?select=schedule_id,category,base_price"),
  get("clinic_price_rules?select=lab_id,clinic_id,price_schedule_id,discount_pct"),
  get("clinic_statements?select=id,lab_id,clinic_id,clinic_name,month,total,status"),
  get("lab_payments?select=id,lab_id,statement_id,amount,method,cleared,received_date"),
  get("lab_expenses?select=id,lab_id,amount,expense_date"),
  get("profiles?select=id,name,role,clinic_id,lab_id"),
  get("lab_members?select=id,lab_id,user_id,email,role,status"),
  get("login_events?select=id,action,created_at&order=created_at.desc"),
]);
console.log(`Loaded: ${labs.length} labs, ${clinics.length} clinics, ${cases.length} cases, ${statements.length} statements, ${payments.length} payments, ${expenses.length} expenses, ${profiles.length} profiles, ${logins.length} activity rows\n`);

// ---------- 1. pricing correctness on live cases ----------
const itemsBySched = new Map();
for (const it of items) {
  if (!itemsBySched.has(it.schedule_id)) itemsBySched.set(it.schedule_id, new Map());
  itemsBySched.get(it.schedule_id).set(it.category, Number(it.base_price));
}
const defaultSched = new Map(schedules.filter((s) => s.is_default).map((s) => [s.lab_id, s.id]));
const ruleFor = new Map(rules.map((r) => [`${r.lab_id}:${r.clinic_id}`, r]));

let priceOk = 0, priceMismatch = [], unpriceable = 0, overridden = 0, frozen = 0;
for (const c of cases) {
  if (!c.lab_id) continue;
  if (c.invoice_status !== "draft") { frozen++; continue; }
  if (c.price_overridden) { overridden++; continue; }
  const rule = ruleFor.get(`${c.lab_id}:${c.clinic_id}`);
  const schedId = rule?.price_schedule_id ?? defaultSched.get(c.lab_id);
  const sched = itemsBySched.get(schedId);
  if (!sched) { unpriceable++; continue; }
  const rest = c.prescription?.restorations?.length ? c.prescription.restorations : [c.prescription];
  let base = 0, priced = false;
  for (const r of rest) {
    const p = sched.get(r?.category);
    if (p == null) continue;
    const units = APPLIANCE.has(r.category) ? 1 : Math.max(r?.teeth?.length ?? 0, 1);
    base += p * units;
    priced = true;
  }
  if (!priced) { unpriceable++; continue; }
  const disc = Number(rule?.discount_pct ?? 0);
  let expected = base - (base * disc) / 100;
  if (c.remake?.cost > 0) expected -= Number(c.remake.cost);
  expected = Math.max(0, Math.round(expected * 1000) / 1000);
  const actual = c.total_price != null ? Number(c.total_price) : null;
  if (actual !== null && Math.abs(actual - expected) < 0.001) priceOk++;
  else priceMismatch.push(`${c.id}: stored=${actual} expected=${expected} (${rest.map((r) => r?.category).join(",")})`);
}
say(priceMismatch.length ? "WARN" : "PASS", `case pricing: ${priceOk} correct, ${priceMismatch.length} mismatched, ${overridden} manual, ${frozen} invoiced/frozen, ${unpriceable} no matching price list`);
priceMismatch.slice(0, 10).forEach((m) => say("WARN", "  " + m));
if (priceMismatch.length) say("INFO", '  fix: correct the price list, then press "Update case prices" on any price-list card');

// ---------- 2. statement/payment consistency ----------
const paidBy = new Map();
for (const p of payments) if (p.statement_id) paidBy.set(p.statement_id, (paidBy.get(p.statement_id) ?? 0) + Number(p.amount));
let stOk = 0, stBad = [];
for (const s of statements) {
  const paid = Math.round((paidBy.get(s.id) ?? 0) * 1000) / 1000;
  const total = Number(s.total);
  const want = paid <= 0 ? "unpaid" : paid + 0.0005 >= total ? "paid" : "partial";
  if (s.status === want) stOk++;
  else stBad.push(`${s.clinic_name || s.clinic_id} ${s.month.slice(0, 7)}: status=${s.status} but paid ${paid}/${total}`);
  if (paid > total + 0.01) stBad.push(`${s.clinic_name} ${s.month.slice(0, 7)}: OVERPAID ${paid}/${total}`);
}
say(stBad.length ? "WARN" : "PASS", `statements: ${stOk}/${statements.length} status consistent with payments`);
stBad.slice(0, 8).forEach((m) => say("WARN", "  " + m));

// ---------- 3. hygiene ----------
const labIds = new Set(labs.map((l) => l.id));
const clinicIds = new Set(clinics.map((c) => c.id));
const badProfiles = profiles.filter((p) => (p.lab_id && !labIds.has(p.lab_id)) || (p.clinic_id && !clinicIds.has(p.clinic_id)));
say(badProfiles.length ? "FAIL" : "PASS", `profiles -> org pointers valid (${badProfiles.length} dangling)`);
const pendingOrgs = [...clinics, ...labs].filter((o) => o.status === "pending");
say("INFO", `pending activations awaiting the super admin: ${pendingOrgs.length}`, pendingOrgs.map((o) => o.name).join(", ") || "none");
const cancelPending = cases.filter((c) => c.cancel_status === "requested");
say("INFO", `cancellation requests awaiting lab: ${cancelPending.length}`, cancelPending.map((c) => c.id).join(", ") || "none");
const openInvites = members.filter((m) => !m.user_id && m.status === "invited");
say("INFO", `staff invites not yet claimed: ${openInvites.length}`, openInvites.map((m) => `${m.email} (${m.role})`).join(", ") || "none");
const shadeNeeded = cases.filter((c) => {
  const rest = c.prescription?.restorations?.length ? c.prescription.restorations : [c.prescription];
  return c.invoice_status === "draft" && !c.lab_shade && rest.some((r) => r?.shadeGuide === "Shade by Lab" || r?.vitaShade === "Shade by Lab");
});
say("INFO", `Shade-by-Lab cases missing a lab shade: ${shadeNeeded.length}`, shadeNeeded.map((c) => c.id).join(", ") || "none");

// ---------- 4. activity log flowing ----------
const dayAgo = Date.now() - 86400000;
const recent = logins.filter((e) => new Date(e.created_at).getTime() > dayAgo);
say(recent.length ? "PASS" : "INFO", `activity log: ${recent.length} events in last 24h (${logins.length} total)`, recent.slice(0, 3).map((e) => e.action).join(", "));

// ---------- 5. default price lists ----------
for (const l of labs.filter((x) => x.owner_id)) {
  const def = defaultSched.get(l.id);
  const n = def ? (itemsBySched.get(def)?.size ?? 0) : 0;
  say(n ? "PASS" : "WARN", `lab "${l.name}": default price list ${def ? `has ${n} items` : "MISSING"}`, n === 0 && def ? "empty — clinics without their own list get NO auto-pricing" : "");
}

// ---------- 6. client crash reports ----------
const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
const errors = await get(`client_errors?select=at,message,stack,url,alerted&at=gte.${weekAgo}&order=at.desc`);
const errDay = errors.filter((e) => new Date(e.at).getTime() > dayAgo);
const unalerted = errors.filter((e) => !e.alerted);
say(errDay.length ? "WARN" : "PASS", `client errors: ${errDay.length} in last 24h, ${errors.length} in last 7d, ${unalerted.length} awaiting the hourly digest`);
const groups = new Map();
for (const e of errors) {
  const msg = (e.message || "").replace(/\s+/g, " ").slice(0, 100);
  const g = groups.get(msg) ?? { n: 0, latest: e };
  g.n++;
  groups.set(msg, g);
}
for (const [msg, g] of [...groups].sort((a, b) => b[1].n - a[1].n).slice(0, 6)) {
  say("WARN", `  ${g.n}x, latest ${g.latest.at.slice(0, 16)}Z: ${msg}`);
  const frames = (g.latest.stack || "").split("\n").slice(1).filter((l) => l.trim());
  frames.slice(0, 2).forEach((f) => say("WARN", `      ${f.trim().slice(0, 110)}`));
}
console.log("\nAudit complete.");
