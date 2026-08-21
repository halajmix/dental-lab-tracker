// Reprice every draft, non-overridden case against the CURRENT price lists —
// the same mechanism as the app's "Update case prices" button (a no-op
// prescription write that re-fires the cases_price trigger), run with the
// service key for maintenance use. Frozen (issued/paid) and manually priced
// cases are untouched, same as the button. Run: node scripts/reprice.mjs
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const key = readFileSync(`${homedir()}/.drcrown-backup-env`, "utf8").match(/SERVICE_ROLE_KEY=(\S+)/)[1];
const url = readFileSync(join(repo, ".env"), "utf8").match(/VITE_SUPABASE_URL=(\S+)/)[1];
const H = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

const res = await fetch(
  `${url}/rest/v1/cases?select=id,prescription,total_price&invoice_status=eq.draft&price_overridden=eq.false&lab_id=not.is.null`,
  { headers: H }
);
const rows = await res.json();
if (!Array.isArray(rows)) throw new Error(JSON.stringify(rows).slice(0, 200));
console.log(`${rows.length} draft cases to reprice`);

let changed = 0;
for (const c of rows) {
  const r = await fetch(`${url}/rest/v1/cases?id=eq.${encodeURIComponent(c.id)}`, {
    method: "PATCH",
    headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify({ prescription: c.prescription }),
  });
  const out = await r.json();
  const after = Array.isArray(out) ? out[0]?.total_price : out?.total_price;
  const before = c.total_price;
  const moved = String(before) !== String(after);
  if (moved) changed++;
  console.log(`  ${c.id}: ${before ?? "—"} -> ${after ?? "—"}${moved ? "" : " (unchanged)"}`);
}
console.log(`\nDone — ${changed} case price(s) changed.`);
