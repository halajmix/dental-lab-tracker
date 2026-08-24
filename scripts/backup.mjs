/**
 * Full data backup: every exposed table + both storage buckets (avatars,
 * case-photos) → ~/DrCrown-Backups/backup-YYYY-MM-DD-HHMM/.
 * Keeps the newest 8 backups, deletes older ones.
 *
 * The backup root deliberately lives in the home folder, NOT ~/Documents:
 * macOS TCC blocks launchd background jobs from ~/Documents (EPERM) unless
 * node is granted Full Disk Access, which we don't want to require.
 *
 * Tables are discovered from PostgREST's OpenAPI root at run time, so new
 * schema phases are picked up automatically — no list to keep in sync.
 *
 * Credentials: reads the service-role key from ~/.drcrown-backup-env
 * (a file OUTSIDE the repo so it can never be committed). Format:
 *   SERVICE_ROLE_KEY=eyJ...
 *
 * Run manually:  node scripts/backup.mjs
 * Runs weekly via the com.drcrown.backup LaunchAgent (Sunday 20:00, or on
 * next wake if the laptop was asleep — it waits up to 10 min for network).
 *
 * This is the free safety layer, not a substitute for Supabase Pro's
 * point-in-time recovery — JSON dumps restore data, not exact state.
 */
import { readFileSync, mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const SUPABASE_URL = "https://mtxkushcxczjwypwoxdh.supabase.co";
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

const errText = (err) => err.cause ? `${err.message} (${err.cause.code ?? err.cause.message ?? err.cause})` : err.message;

// ---- wait for network: launchd fires this on wake, often before Wi-Fi is up ----
let spec = null;
for (let attempt = 1; ; attempt++) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/`, { headers });
    if (!res.ok) throw new Error(`OpenAPI root: HTTP ${res.status}`);
    spec = await res.json();
    break;
  } catch (err) {
    if (attempt >= 20) {
      console.error(`No network after ${attempt} attempts (~10 min) — giving up this run. Last error: ${errText(err)}`);
      process.exit(1);
    }
    console.log(`network not ready (attempt ${attempt}/20): ${errText(err)} — retrying in 30s`);
    await new Promise((r) => setTimeout(r, 30_000));
  }
}

// ---- table discovery: every table/view PostgREST exposes in the public schema ----
const TABLES = Object.keys(spec.definitions ?? {}).sort();
if (!TABLES.length) {
  console.error("PostgREST OpenAPI root listed no tables — aborting rather than writing an empty backup.");
  process.exit(1);
}
console.log(`Discovered ${TABLES.length} tables: ${TABLES.join(", ")}`);

const root = join(homedir(), "DrCrown-Backups");
const now = new Date();
const p2 = (n) => String(n).padStart(2, "0");
// Local time parts, not toISOString(): in Oman (UTC+4) the UTC stamp names an
// evening backup with the wrong hour and can even land on the previous day.
const stamp = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}`;
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
    console.error(`✗ ${table}:`, errText(err));
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
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, Buffer.from(await res.arrayBuffer()));
      saved++;
    }
    console.log(`✓ bucket ${bucket}: ${saved}/${files.length} files`);
  } catch (err) {
    failures++;
    console.error(`✗ bucket ${bucket}:`, errText(err));
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
