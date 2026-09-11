import type { Caller, CaseRow, ToolContext } from "./lib/types.ts";

/* The authorization boundary for WRITE tools. Read tools run under the
   caller's JWT and RLS answers visibility; writes need the service role, so
   tenancy is re-derived here from the database, in code the model cannot
   reach. Scheduled runs have no user: they are scoped to one lab id. */

export class AuthzError extends Error {
  constructor(msg: string) { super(msg); this.name = "AuthzError"; }
}

export async function loadCaseForAuthz(ctx: ToolContext, caseId: string): Promise<CaseRow> {
  const { data, error } = await ctx.admin.from("cases").select("*").eq("id", caseId).maybeSingle();
  if (error) throw new Error(`cases read failed: ${error.message}`);
  if (!data) throw new AuthzError("case not found");
  return data as CaseRow;
}

/** Caller may act on this case: member of its clinic, member of its lab,
    platform admin, or a scheduled job iterating exactly this lab. */
export function assertCanAct(caller: Caller, row: CaseRow): void {
  if (caller.kind === "system") {
    if (!caller.jobLabId || caller.jobLabId !== row.lab_id) throw new AuthzError("job is not scoped to this case's lab");
    return;
  }
  if (caller.role === "admin") return;
  if (caller.labId && caller.labId === row.lab_id) return;
  if (caller.clinicIds?.includes(row.clinic_id)) return;
  throw new AuthzError("not visible to this account or does not exist");
}

export const isClinicCaller = (caller: Caller, row: CaseRow): boolean =>
  caller.kind === "user" && !!caller.clinicIds?.includes(row.clinic_id);
