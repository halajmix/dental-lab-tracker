/**
 * Read-only schema probe: prints the COLUMN NAMES of one table, nothing else.
 *
 * Exists so "did that migration actually land?" can be answered without
 * running a full backup (which downloads every STL in storage). Prints no
 * row values and no PII — just the keys.
 *
 * Usage: node scripts/schema-probe.mjs [table]     (default: cases)
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { serviceKey } from "./lib/serviceKey.mjs";

const SUPABASE_URL = "https://mtxkushcxczjwypwoxdh.supabase.co";
const table = process.argv[2] ?? "cases";

const key = serviceKey();

const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

const rows = await res.json();
if (!rows.length) {
  console.log(`${table}: no rows to read columns from`);
} else {
  console.log(`${table} columns:\n  ${Object.keys(rows[0]).sort().join("\n  ")}`);
}
