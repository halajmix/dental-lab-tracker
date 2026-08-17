/**
 * Full data backup: every table + both storage buckets (avatars,
 * case-photos) → ~/Documents/DrCrown-Backups/backup-YYYY-MM-DD-HHMM/.
 * Keeps the newest 8 backups, deletes older ones.
 *
 * Credentials: reads the service-role key from ~/.drcrown-backup-env
 * (a file OUTSIDE the repo so it can never be committed). Format:
 *   SERVICE_ROLE_KEY=eyJ...
 *
 * Run manually:  node scripts/backup.mjs
 * Runs weekly via the com.drcrown.backup LaunchAgent (Sunday 20:00,
 * or on next wake if the laptop was asleep).
 *
 * This is the free safety layer, not a substitute for Supabase Pro's
 * point-in-time recovery — JSON dumps restore data, not exact state.
 */
import { readFileSync, mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SUPABASE_URL = "https://mtxkushcxczjwypwoxdh.supabase.co";
const TABLES = [
  "clinics", "labs", "profiles", "cases", "case_notes", "lab_members",
  "lab_device_sessions", "lab_trusted_ips", "device_otp_challenges",
  "price_schedules", "price_schedule_items", "clinic_price_rules",
];
const BUCKETS = ["avatars", "case-photos"];
const KEEP = 8;

const envPath = join(homedir(), ".drcrown-backup-env");
if (!existsSync(envPath)) {
  console.error(`No credentials file at ${envPath} — create it with SERVICE_ROLE_KEY=<key>`);
  process.exit(1);
}
const key = (readFileSync(envPath, "utf8").match(/SERVICE_ROLE_KEY=(\S+)/) ?? [])[1];
if (!key) {
  console.error("SERVICE_ROLE_KEY not found in ~/.drcrown-backup-env");
  process.exit(1);
}
const headers = { apikey: key, Authorization: `Bearer ${key}` };

const root = join(homedir(), "Documents", "DrCrown-Backups");
const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
const dir = join(root, `backup-${stamp}`);
mkdirSync(join(dir, "tables"), { recursive: true });

let failures = 0;

// ---- tables (paginated PostgREST reads, 1000 rows per page) ----
for (const table of TABLES) {
  try {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
        headers: { ...headers, Range: `${from}-${from + 999}` },
      });
      if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${await res.text()}`);
      const page = await res.json();
      rows.push(...page);
      if (page.length < 1000) break;
    }
    writeFileSync(join(dir, "tables", `${table}.json`), JSON.stringify(rows, null, 1));
    console.log(`✓ ${table}: ${rows.length} rows`);
  } catch (err) {
    failures++;
    console.error(`✗ ${table}:`, err.message);
  }
}

// ---- storage buckets ----
async function listAll(bucket, prefix = "") {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
  });
  if (!res.ok) throw new Error(`list ${bucket}/${prefix}: HTTP ${res.status}`);
  const entries = await res.json();
  const files = [];
  for (const e of entries) {
    const path = prefix ? `${prefix}/${e.name}` : e.name;
    // Folders come back with a null id; recurse into them.
    if (e.id === null) files.push(...(await listAll(bucket, path)));
    else files.push(path);
  }
  return files;
}

for (const bucket of BUCKETS) {
  try {
    const files = await listAll(bucket);
    let saved = 0;
    for (const path of files) {
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, { headers });
      if (!res.ok) {
        failures++;
        console.error(`✗ ${bucket}/${path}: HTTP ${res.status}`);
        continue;
      }
      const out = join(dir, "storage", bucket, path);
      mkdirSync(join(out, ".."), { recursive: true });
      writeFileSync(out, Buffer.from(await res.arrayBuffer()));
      saved++;
    }
    console.log(`✓ bucket ${bucket}: ${saved}/${files.length} files`);
  } catch (err) {
    failures++;
    console.error(`✗ bucket ${bucket}:`, err.message);
  }
}

// ---- retention: newest KEEP backups survive ----
const backups = readdirSync(root).filter((n) => n.startsWith("backup-")).sort();
for (const old of backups.slice(0, Math.max(0, backups.length - KEEP))) {
  rmSync(join(root, old), { recursive: true, force: true });
  console.log(`retention: removed ${old}`);
}

console.log(failures ? `DONE WITH ${failures} FAILURES — check output above` : `Backup complete: ${dir}`);
process.exit(failures ? 1 : 0);
