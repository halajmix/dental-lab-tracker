import type { Db } from "./lib/types.ts";

/* Kill switch, per-lab enablement, idempotency, rate limits. All table-backed
   so they hold across function instances. Fail CLOSED: any read error means
   "disabled". */

export async function noorEnabled(admin: Db, labId?: string | null): Promise<boolean> {
  const { data, error } = await admin.from("feature_flags").select("enabled,tenant_ids").eq("key", "noor.global").maybeSingle();
  if (error || !data?.enabled) return false;
  if (labId) {
    if (Array.isArray(data.tenant_ids) && data.tenant_ids.length && !data.tenant_ids.includes(labId)) return false;
    const { data: lab, error: e2 } = await admin.from("labs").select("noor_enabled").eq("id", labId).maybeSingle();
    if (e2 || !lab?.noor_enabled) return false;
  }
  return true;
}

/** True if this key was not seen before (and is now claimed). */
export async function claimIdempotency(admin: Db, key: string): Promise<boolean> {
  const { error } = await admin.from("noor_idempotency").insert({ key });
  return !error;
}

export async function withinRateLimit(admin: Db, scope: string, limit: number, windowMs: number, now: Date): Promise<boolean> {
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs).toISOString();
  const { data } = await admin.from("noor_rate_limits").select("count").eq("scope", scope).eq("window_start", windowStart).maybeSingle();
  const count = (data?.count ?? 0) + 1;
  if (count > limit) return false;
  await admin.from("noor_rate_limits").upsert({ scope, window_start: windowStart, count }, { onConflict: "scope,window_start" });
  return true;
}

export const idempotencyKeyFor = (trigger: string, parts: Array<string | number | null | undefined>): string =>
  [trigger, ...parts.map((p) => String(p ?? ""))].join(":");
