import { supabase } from "./supabaseClient.js";
import { isNetworkError } from "./outbox.js";
import { putBlob, allBlobs, deleteBlob } from "./blobstore.js";

/* ------------------------------------------------------------------ */
/*  Row <-> app-object mapping                                         */
/*  The rest of the app (Analytics, PrescriptionForm, LifecycleEngine, */
/*  PrintRx, ContactLab, exportCsv...) all speak the original camelCase */
/*  shapes from the localStorage era. Keeping that boundary here means  */
/*  none of those files needed to change for the Supabase migration.    */
/* ------------------------------------------------------------------ */

export const labFromRow = (r) => ({
  id: r.id,
  name: r.name,
  contact: r.contact ?? "",
  email: r.email ?? "",
  address: r.address ?? "",
  governorate: r.governorate ?? "",
  wilayat: r.wilayat ?? "",
  tat: r.tat,
  procedureTats: r.procedure_tats ?? {},
  ownerId: r.owner_id,
  createdByClinicId: r.created_by_clinic_id,
  status: r.status ?? "active",
  // Phase 58: private labs are visible only to clinics mapped in
  // clinic_lab_access. Default true = pre-58 behavior.
  isPublic: r.is_public ?? true,
  // Who receives new-case emails; "" = the lab's general contact email.
  notifyEmail: r.notify_email ?? "",
  // Monthly unpaid-invoice reminder emails to clinics (Lab Settings toggle).
  paymentRemindersEnabled: r.payment_reminders_enabled ?? true,
});

export const caseFromRow = (r) => ({
  id: r.id,
  clinicId: r.clinic_id,
  patientName: r.patient_name,
  patientId: r.patient_id,
  patientPhone: r.patient_phone ?? "",
  labId: r.lab_id,
  appointmentDate: r.appointment_date,
  deliveryTime: r.delivery_time ?? "Anytime",
  createdDate: r.created_date,
  stageIndex: r.stage_index,
  handover: r.handover ?? null,
  remake: r.remake ?? null,
  prescription: r.prescription ?? {},
  history: r.history ?? [],
  // The lab's own internal billing/job reference — set by the lab, never
  // the dentist. Defaults to "" until the lab fills it in.
  invoiceNumber: r.invoice_number ?? "",
  // Full timestamp of when the case was submitted (created_date above is
  // date-only) — drives the dentist table's "Sent to Lab" column.
  createdAt: r.created_at ?? null,
  // Phase 16 RBAC/financial columns. Fee fields stay null until the
  // Phase 17 pricing trigger prices the case.
  assignedTechId: r.assigned_tech_id ?? null,
  baseFee: r.base_fee ?? null,
  adjustments: r.adjustments ?? [],
  totalPrice: r.total_price ?? null,
  invoiceStatus: r.invoice_status ?? "draft",
  statementId: r.statement_id ?? null,
  cancelStatus: r.cancel_status ?? "none",
  cancellationFee: r.cancellation_fee != null ? Number(r.cancellation_fee) : null,
  priceOverridden: r.price_overridden ?? false,
  // Phase 36: shade determined by the lab when the Rx said "Shade by Lab".
  labShade: r.lab_shade ?? "",
  // Phase 56: which clinic user authored the case (stamped server-side).
  createdBy: r.created_by ?? null,
});

export const clinicFromRow = (r) => ({
  id: r.id,
  name: r.name,
  address: r.address ?? "",
  governorate: r.governorate ?? "",
  wilayat: r.wilayat ?? "",
  contact: r.contact ?? "",
  license: r.license ?? "",
  dentist: r.dentist ?? "",
  dentistLicense: r.dentist_license ?? "",
  email: r.email ?? "",
  ownerId: r.owner_id ?? null,
  // Phase 30 activation gate — rows created before the column existed are active.
  status: r.status ?? "active",
  // Phase 58: an exclusive clinic sees only its super-admin-mapped labs.
  isExclusive: r.is_exclusive ?? false,
});

export async function fetchClinicsByIds(ids) {
  if (!ids.length) return [];
  const { data, error } = await supabase.from("clinics").select("*").in("id", ids);
  if (error) throw error;
  return data.map(clinicFromRow);
}

// Unfiltered — relies entirely on RLS. A normal user's "clinics_select"
// policy only ever matches their own clinic, so this only returns
// everything for a role='admin' profile (see clinics_select_admin).
export async function fetchAllClinics() {
  const { data, error } = await supabase.from("clinics").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(clinicFromRow);
}

// Every clinic this user can act for: owned (always admin) plus Phase 56
// clinic_members rows. Each row carries `myRole` for role-gated UI. The
// membership read fails soft so owners keep working before the Phase 56
// SQL has run (same fail-soft convention as fetchMyLabMemberships).
export async function fetchMyClinics(userId) {
  const [owned, member] = await Promise.all([
    supabase.from("clinics").select("*").eq("owner_id", userId).order("created_at"),
    supabase.from("clinic_members").select("role, clinics(*)").eq("user_id", userId),
  ]);
  if (owned.error) throw owned.error;
  const out = owned.data.map((r) => ({ ...clinicFromRow(r), myRole: "admin" }));
  if (!member.error) {
    for (const m of member.data ?? []) {
      // clinics comes back null when the clinic row is invisible (pending).
      if (m.clinics && !out.some((c) => c.id === m.clinics.id)) {
        out.push({ ...clinicFromRow(m.clinics), myRole: m.role });
      }
    }
  }
  return out;
}

// The caller's Phase 56 role at one clinic (null = no membership row).
export async function fetchMyClinicRole(userId, clinicId) {
  const { data, error } = await supabase
    .from("clinic_members")
    .select("role")
    .eq("user_id", userId)
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (error) throw error;
  return data?.role ?? null;
}

/* ------------------------------------------------------------------ */
/*  Clinic team (Phase 57) — roster, invitations, membership RPCs      */
/* ------------------------------------------------------------------ */

// Roster + pending invitations for the Team panel. Invitations are only
// visible to admins/receptionists under RLS; a doctor's empty read is
// normal (they never see the invite section anyway).
export async function fetchClinicTeam(clinicId) {
  const [members, invites] = await Promise.all([
    supabase.from("clinic_members").select("*").eq("clinic_id", clinicId).order("created_at"),
    supabase.from("clinic_invitations").select("*").eq("clinic_id", clinicId).order("created_at", { ascending: false }),
  ]);
  if (members.error) throw members.error;
  const rows = members.data.map((m) => ({
    id: m.id,
    clinicId: m.clinic_id,
    userId: m.user_id,
    role: m.role,
    email: m.email ?? "",
    createdAt: m.created_at,
  }));
  // Names/avatars via profiles_select_clinic_members.
  const profilesById = {};
  if (rows.length) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, name, avatar_url")
      .in("id", rows.map((m) => m.userId));
    for (const p of profs ?? []) profilesById[p.id] = p;
  }
  return {
    members: rows.map((m) => ({
      ...m,
      name: profilesById[m.userId]?.name ?? "",
      avatarUrl: profilesById[m.userId]?.avatar_url ?? null,
    })),
    invitations: (invites.error ? [] : invites.data).map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      // pending-past-expiry renders as expired; the row itself stays pending.
      status: i.status === "pending" && new Date(i.expires_at) < new Date() ? "expired" : i.status,
      expiresAt: i.expires_at,
      createdAt: i.created_at,
    })),
  };
}

export async function createClinicInvitation(clinicId, invitedBy, { email, role }) {
  const { data, error } = await supabase
    .from("clinic_invitations")
    .insert({ clinic_id: clinicId, email: email.trim(), role, invited_by: invitedBy })
    .select()
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("There is already a pending invitation for that email.");
    throw error;
  }
  return data;
}

export async function revokeClinicInvitation(id) {
  const { data, error } = await supabase
    .from("clinic_invitations")
    .update({ status: "revoked" })
    .eq("id", id)
    .select();
  if (error) throw error;
  // RLS-0-row lesson: an unauthorized update "succeeds" with nothing changed.
  if (!data?.length) throw new Error("Couldn't revoke the invitation — refresh and try again.");
}

export async function updateClinicMemberRole(memberId, role) {
  const { data, error } = await supabase.from("clinic_members").update({ role }).eq("id", memberId).select();
  if (error) throw error;
  if (!data?.length) throw new Error("Couldn't change the role — only clinic admins can, and the owner's role is fixed.");
}

export async function removeClinicMember(clinicId, userId) {
  const { error } = await supabase.rpc("remove_clinic_member", { p_clinic: clinicId, p_user: userId });
  if (error) throw error;
}

/* ------------------------------------------------------------------ */
/*  Clinic↔lab access map (Phase 58). RLS scopes reads: a clinic sees   */
/*  its own mappings, the super admin sees (and writes) everything.     */
/* ------------------------------------------------------------------ */

export async function fetchClinicLabAccess() {
  const { data, error } = await supabase.from("clinic_lab_access").select("clinic_id, lab_id");
  if (error) throw error;
  return data.map((r) => ({ clinicId: r.clinic_id, labId: r.lab_id }));
}

export async function grantClinicLabAccess(clinicId, labId) {
  const { error } = await supabase.from("clinic_lab_access").insert({ clinic_id: clinicId, lab_id: labId });
  if (error && error.code !== "23505") throw error; // already granted = fine
}

export async function revokeClinicLabAccess(clinicId, labId) {
  const { data, error } = await supabase
    .from("clinic_lab_access")
    .delete()
    .eq("clinic_id", clinicId)
    .eq("lab_id", labId)
    .select();
  if (error) throw error;
  if (!data?.length) throw new Error("Couldn't revoke — only the super admin can change lab access.");
}

export async function setClinicExclusive(clinicId, isExclusive) {
  const { data, error } = await supabase
    .from("clinics")
    .update({ is_exclusive: isExclusive })
    .eq("id", clinicId)
    .select();
  if (error) throw error;
  if (!data?.length) throw new Error("Couldn't update the clinic — super admin only.");
}

export async function setLabPublic(labId, isPublic) {
  const { data, error } = await supabase.from("labs").update({ is_public: isPublic }).eq("id", labId).select();
  if (error) throw error;
  if (!data?.length) throw new Error("Couldn't update the lab — super admin only.");
}

// Invite-link landing info ({clinicName, email, role, status} or null).
export async function peekClinicInvitation(token) {
  const { data, error } = await supabase.rpc("peek_clinic_invitation", { p_token: token });
  if (error) throw error;
  return data;
}

export async function acceptClinicInvitation(token, name = null) {
  const { data, error } = await supabase.rpc("accept_clinic_invitation", { p_token: token, p_name: name });
  if (error) throw error;
  return data; // {clinicId, clinicName, role, already?}
}

export async function insertClinic(ownerId, data) {
  const { data: row, error } = await supabase
    .from("clinics")
    .insert({
      owner_id: ownerId,
      name: data.name,
      dentist: data.dentist ?? "",
      contact: data.contact ?? "",
      email: data.email ?? "",
      governorate: data.governorate ?? "",
      wilayat: data.wilayat ?? "",
    })
    .select()
    .single();
  if (error) throw error;
  return clinicFromRow(row);
}

export async function updateClinic(clinicId, patch) {
  const dbPatch = {};
  if (patch.name !== undefined) dbPatch.name = patch.name;
  if (patch.dentist !== undefined) dbPatch.dentist = patch.dentist;
  if (patch.contact !== undefined) dbPatch.contact = patch.contact;
  if (patch.email !== undefined) dbPatch.email = patch.email;
  if (patch.governorate !== undefined) dbPatch.governorate = patch.governorate;
  if (patch.wilayat !== undefined) dbPatch.wilayat = patch.wilayat;
  const { data, error } = await supabase.from("clinics").update(dbPatch).eq("id", clinicId).select().single();
  if (error) throw error;
  return clinicFromRow(data);
}

const caseToRow = (data) => ({
  patient_name: data.patientName,
  patient_id: data.patientId,
  patient_phone: data.patientPhone ?? "",
  lab_id: data.labId ?? null,
  // PrescriptionForm sends the placeholder "—" when no insertion date was
  // picked (fine for a localStorage string field, invalid for a real `date`
  // column) — normalize anything that isn't a real date to null.
  appointment_date: data.appointmentDate && data.appointmentDate !== "—" ? data.appointmentDate : null,
  delivery_time: data.deliveryTime ?? "Anytime",
  created_date: data.createdDate,
  stage_index: data.stageIndex,
  handover: data.handover ?? null,
  remake: data.remake ?? null,
  prescription: data.prescription ?? {},
  history: data.history ?? [],
});

/* ------------------------------------------------------------------ */
/*  Labs                                                               */
/* ------------------------------------------------------------------ */

export async function fetchLabs() {
  const { data, error } = await supabase.from("labs").select("*").order("name");
  if (error) throw error;
  return data.map(labFromRow);
}

// Lab self-service settings (phone, standard TAT, per-procedure TATs).
// RLS: only the owning lab account (or creating clinic) can update.
export async function updateLab(labId, { contact, tat, procedureTats, governorate, wilayat, notifyEmail, paymentRemindersEnabled }) {
  const patch = {};
  if (contact !== undefined) patch.contact = contact;
  if (tat !== undefined) patch.tat = tat;
  if (procedureTats !== undefined) patch.procedure_tats = procedureTats;
  if (governorate !== undefined) patch.governorate = governorate;
  if (wilayat !== undefined) patch.wilayat = wilayat;
  if (notifyEmail !== undefined) patch.notify_email = notifyEmail;
  if (paymentRemindersEnabled !== undefined) patch.payment_reminders_enabled = paymentRemindersEnabled;
  const { data, error } = await supabase.from("labs").update(patch).eq("id", labId).select().single();
  if (error) throw error;
  return labFromRow(data);
}

export async function insertLab(clinicId, data) {
  const { data: row, error } = await supabase
    .from("labs")
    .insert({
      name: data.name,
      contact: data.contact ?? "",
      email: data.email ?? "",
      tat: data.tat,
      created_by_clinic_id: clinicId,
    })
    .select()
    .single();
  if (error) throw error;
  return labFromRow(row);
}

/* ------------------------------------------------------------------ */
/*  Cases                                                               */
/* ------------------------------------------------------------------ */

export async function fetchCases() {
  // Paged for the same 1,000-row PostgREST cap as the finance fetchers —
  // a busy lab's case list crosses it within a couple of years.
  const rows = await fetchAllPages(() =>
    supabase.from("cases").select("*").order("created_at", { ascending: false }).order("id")
  );
  return rows.map(caseFromRow);
}

function genCaseId() {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 4).toUpperCase();
  return `C-${stamp}${rand}`;
}

// Re-read one case to reconcile local state with server truth (used after a
// write the server rejected, so the optimistic UI doesn't stay wrong).
export async function fetchCase(id) {
  const { data, error } = await supabase.from("cases").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? caseFromRow(data) : null;
}

// Generate the case id up front so an offline-created case has a stable id
// shared by its optimistic UI row and its queued insert op.
export function newCaseId() {
  return genCaseId();
}

// Build the app-shaped case object locally (no server), for the optimistic UI
// of an offline-created case — round-trips through the exact row mapping so it
// looks identical to a fetched case.
export function buildLocalCase(id, clinicId, data) {
  const nowIso = new Date().toISOString();
  return caseFromRow({
    id,
    clinic_id: clinicId,
    created_at: nowIso,
    updated_at: nowIso,
    created_date: nowIso.slice(0, 10),
    ...caseToRow(data),
  });
}

export async function insertCase(clinicId, data, id = genCaseId()) {
  const { data: row, error } = await supabase
    .from("cases")
    .insert({ id, clinic_id: clinicId, ...caseToRow(data) })
    .select()
    .single();
  // A duplicate replay of a queued insert (same client id) is a success — the
  // case already landed; return the existing row rather than erroring.
  if (error) {
    if (error.code === "23505" || /duplicate key/i.test(error.message || "")) {
      const existing = await fetchCase(id);
      if (existing) return existing;
    }
    throw error;
  }
  return caseFromRow(row);
}

// Patch keys are the same camelCase names as the app object; only the ones
// present get translated and sent, so callers can send partial updates.
const PATCH_KEY_MAP = {
  // Rx-edit fields (30-minute window, enforced by the cases_guard_prescription
  // trigger — a too-late edit raises, surfaced to the caller as a thrown error).
  prescription: "prescription",
  patientName: "patient_name",
  patientId: "patient_id",
  patientPhone: "patient_phone",
  appointmentDate: "appointment_date",
  deliveryTime: "delivery_time",
  stageIndex: "stage_index",
  handover: "handover",
  remake: "remake",
  history: "history",
  invoiceNumber: "invoice_number",
  assignedTechId: "assigned_tech_id",
  invoiceStatus: "invoice_status",
  cancelStatus: "cancel_status",
  cancellationFee: "cancellation_fee",
  // Phase 32: lab-set final price. totalPrice writes pass the financial
  // guard for lab members; priceOverridden makes them sticky vs repricing.
  totalPrice: "total_price",
  priceOverridden: "price_overridden",
  labShade: "lab_shade",
};

export async function updateCase(id, patch) {
  const dbPatch = {};
  for (const [key, col] of Object.entries(PATCH_KEY_MAP)) {
    if (key in patch) dbPatch[col] = patch[key];
  }
  const { data, error } = await supabase.from("cases").update(dbPatch).eq("id", id).select().single();
  if (error) throw error;
  return caseFromRow(data);
}

// A missing RPC (function not yet created in the DB) so the caller can fall
// back — keeps the app working if it deploys before the Phase 42 SQL is run.
function isMissingFunction(err) {
  const code = err?.code;
  const msg = String(err?.message || "").toLowerCase();
  return code === "PGRST202" || msg.includes("could not find the function") || (msg.includes("function") && msg.includes("does not exist"));
}

// Apply a stage change through the atomic monotonic-merge RPC (Phase 42): the
// case moves to `target` only if it isn't already at/past it in `direction`
// ("advance" | "revert"); otherwise it's a no-op. This is THE conflict rule —
// it makes a replayed offline tap, a duplicate, and a concurrent online
// advance all safe. `entry` is the single history record to append; `history`
// is the full precomputed array used only by the pre-Phase-42 fallback.
export async function applyStage(caseId, { target, direction, entry, history, clearHandover = false }) {
  try {
    const { data, error } = await supabase.rpc("case_apply_stage", {
      p_id: caseId,
      p_target: target,
      p_entry: entry ?? null,
      p_direction: direction,
      p_clear_handover: clearHandover,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("Case not found or you can't modify it");
    return caseFromRow(row);
  } catch (err) {
    if (isMissingFunction(err)) {
      // RPC not present yet — plain (non-atomic) update, current behaviour.
      return updateCase(caseId, { stageIndex: target, history, ...(clearHandover ? { handover: null } : {}) });
    }
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/*  Lab staff RBAC (Phase 16) — a user's membership rows in their lab.  */
/*  Dual-role users have two rows (lab_admin + lab_tech). No rows at    */
/*  all means a legacy owner account, which RLS treats as full access.  */
/* ------------------------------------------------------------------ */

export async function fetchMyLabMemberships(userId, labId) {
  const { data, error } = await supabase
    .from("lab_members")
    .select("role, status")
    .eq("user_id", userId)
    .eq("lab_id", labId);
  if (error) throw error;
  return data ?? [];
}

// Full roster for the Technicians / Staff views — one entry per person,
// dual-role rows collapsed into a roles[] array. Profile names come from
// the profiles_select_lab_members policy (Phase 18).
export async function fetchLabRoster(labId) {
  const { data: members, error } = await supabase
    .from("lab_members")
    .select("*")
    .eq("lab_id", labId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const ids = [...new Set(members.map((m) => m.user_id).filter(Boolean))];
  let profilesById = {};
  if (ids.length) {
    const { data: profs } = await supabase.from("profiles").select("id, name, avatar_url").in("id", ids);
    profilesById = Object.fromEntries((profs ?? []).map((p) => [p.id, p]));
  }

  const byPerson = new Map();
  for (const m of members) {
    const key = m.user_id ?? `invite:${(m.email || "").toLowerCase()}`;
    const entry = byPerson.get(key) ?? {
      userId: m.user_id,
      email: m.email ?? "",
      name: profilesById[m.user_id]?.name || m.email || "—",
      avatarUrl: profilesById[m.user_id]?.avatar_url ?? null,
      roles: [],
      status: m.status,
      memberRowIds: [],
      roleRows: {}, // role -> row id, for per-role grant/revoke
    };
    if (!entry.roles.includes(m.role)) entry.roles.push(m.role);
    entry.memberRowIds.push(m.id);
    entry.roleRows[m.role] = m.id;
    // Any suspended row means the person is locked out — mirror RLS.
    if (m.status === "suspended") entry.status = "suspended";
    byPerson.set(key, entry);
  }
  return [...byPerson.values()];
}

// Fires the pricing trigger on every draft case of the caller's lab.
// Returns how many cases were re-priced.
// Live Rx-form estimate (Phase 33). Best-effort by design: any failure —
// RPC missing, RLS, network — just means "no estimate shown".
export async function estimateCasePrice(labId, clinicId, prescription) {
  try {
    const { data, error } = await supabase.rpc("estimate_case_price", {
      p_lab: labId,
      p_clinic: clinicId,
      p_prescription: prescription,
    });
    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

export async function repriceUnbilledCases() {
  const { data, error } = await supabase.rpc("reprice_unbilled_cases");
  if (error) throw error;
  return data;
}

/* ------------------------------------------------------------------ */
/*  Staff management (Phase 19) — invites + status, all lab_admin-      */
/*  gated by RLS. "Removing" a person = suspending them; only unclaimed */
/*  invites are ever hard-deleted (deleting a member's rows would       */
/*  otherwise change what the RLS fallbacks grant).                     */
/* ------------------------------------------------------------------ */

export async function inviteLabMember(labId, email, roles) {
  const rows = roles.map((role) => ({ lab_id: labId, email: email.trim(), role, status: "invited" }));
  const { error } = await supabase.from("lab_members").insert(rows);
  if (error) throw error;
}

export async function setMemberStatus(memberRowIds, status) {
  const { error } = await supabase.from("lab_members").update({ status }).in("id", memberRowIds);
  if (error) throw error;
}

export async function deleteInviteRows(memberRowIds) {
  const { error } = await supabase.from("lab_members").delete().in("id", memberRowIds);
  if (error) throw error;
}

// Onboarding: invites addressed to this login email (RLS exposes only
// the caller's own-email invites).
export async function fetchMyInvites(email) {
  const { data, error } = await supabase
    .from("lab_members")
    .select("id, lab_id, role, email, labs(name)")
    .is("user_id", null)
    .ilike("email", (email || "").trim());
  if (error) throw error;
  return data ?? [];
}

export async function claimLabInvites(userId, inviteIds) {
  const { error } = await supabase.from("lab_members").update({ user_id: userId }).in("id", inviteIds);
  if (error) throw error;
}

// Grant one extra role to an existing member (dual-role them).
export async function addMemberRole(labId, userId, email, role, status = "active") {
  const { error } = await supabase
    .from("lab_members")
    .insert({ lab_id: labId, user_id: userId, email, role, status });
  if (error) throw error;
}

// Revoke a single role row (the caller keeps the person's other role).
export async function removeMemberRole(rowId) {
  const { error } = await supabase.from("lab_members").delete().eq("id", rowId);
  if (error) throw error;
}

// Fully remove a member from the lab (server-side function: clears their
// membership AND profile so their next sign-in starts at Onboarding).
export async function removeLabMember(userId) {
  const { error } = await supabase.rpc("remove_lab_member", { target_user: userId });
  if (error) throw error;
}

/* ------------------------------------------------------------------ */
/*  Price schedules (Phase 17) — lab price lists + per-clinic rules.    */
/*  All writes are lab_admin-gated by RLS; actual case pricing happens  */
/*  in a DB trigger, never in the client.                               */
/* ------------------------------------------------------------------ */

const priceItemFromRow = (r) => ({
  id: r.id,
  scheduleId: r.schedule_id,
  category: r.category,
  code: r.code ?? "",
  basePrice: Number(r.base_price),
  // Phase 44: denture base + per-tooth fee. null = flat price (old behavior).
  perToothFee: r.per_tooth_fee == null ? null : Number(r.per_tooth_fee),
  // Phase 45: arch appliances — base_price is the SINGLE-arch price and this
  // is the both-arches price. null = one price regardless of arch (old way).
  priceBothArches: r.price_both_arches == null ? null : Number(r.price_both_arches),
});

const priceScheduleFromRow = (r) => ({
  id: r.id,
  labId: r.lab_id,
  name: r.name,
  isDefault: r.is_default,
  items: (r.price_schedule_items ?? [])
    .map(priceItemFromRow)
    .sort((a, b) => a.category.localeCompare(b.category)),
});

const clinicRuleFromRow = (r) => ({
  id: r.id,
  labId: r.lab_id,
  clinicId: r.clinic_id,
  priceScheduleId: r.price_schedule_id,
  discountPct: Number(r.discount_pct ?? 0),
});

export async function fetchPriceSchedules(labId) {
  const { data, error } = await supabase
    .from("price_schedules")
    .select("*, price_schedule_items(*)")
    .eq("lab_id", labId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data.map(priceScheduleFromRow);
}

export async function createPriceSchedule(labId, name, { isDefault = false, items = [] } = {}) {
  const { data: sched, error } = await supabase
    .from("price_schedules")
    .insert({ lab_id: labId, name, is_default: isDefault })
    .select()
    .single();
  if (error) throw error;
  if (items.length) {
    const { error: itemsError } = await supabase.from("price_schedule_items").insert(
      items.map((it) => ({
        schedule_id: sched.id,
        category: it.category,
        code: it.code ?? "",
        base_price: it.basePrice,
      }))
    );
    if (itemsError) throw itemsError;
  }
  return sched.id;
}

export async function addPriceItem(scheduleId, { category, code = "", basePrice, perToothFee, priceBothArches }) {
  const row = { schedule_id: scheduleId, category, code, base_price: basePrice };
  // Keys omitted when unset so inserts still work before the phase SQL runs.
  if (perToothFee !== undefined && perToothFee !== null && perToothFee !== "") row.per_tooth_fee = perToothFee;
  if (priceBothArches !== undefined && priceBothArches !== null && priceBothArches !== "") row.price_both_arches = priceBothArches;
  const { data, error } = await supabase.from("price_schedule_items").insert(row).select().single();
  if (error) throw error;
  return priceItemFromRow(data);
}

export async function updatePriceItem(id, { code, basePrice, perToothFee, priceBothArches }) {
  const patch = {};
  if (code !== undefined) patch.code = code;
  if (basePrice !== undefined) patch.base_price = basePrice;
  // null/"" clears back to the flat behavior; undefined leaves it untouched.
  if (perToothFee !== undefined) patch.per_tooth_fee = perToothFee === "" ? null : perToothFee;
  if (priceBothArches !== undefined) patch.price_both_arches = priceBothArches === "" ? null : priceBothArches;
  const { error } = await supabase.from("price_schedule_items").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deletePriceItem(id) {
  const { error } = await supabase.from("price_schedule_items").delete().eq("id", id);
  if (error) throw error;
}

// Clear-then-set: a partial unique index allows only one default per lab.
export async function setDefaultSchedule(labId, scheduleId) {
  const { error: clearError } = await supabase
    .from("price_schedules")
    .update({ is_default: false })
    .eq("lab_id", labId)
    .eq("is_default", true);
  if (clearError) throw clearError;
  const { error } = await supabase
    .from("price_schedules")
    .update({ is_default: true })
    .eq("id", scheduleId);
  if (error) throw error;
}

export async function deletePriceSchedule(id) {
  const { error } = await supabase.from("price_schedules").delete().eq("id", id);
  if (error) throw error;
}

export async function fetchClinicPriceRules(labId) {
  const { data, error } = await supabase
    .from("clinic_price_rules")
    .select("*")
    .eq("lab_id", labId);
  if (error) throw error;
  return data.map(clinicRuleFromRow);
}

// Charged history for the clinic-specific price lists: every statement line
// item since `sinceMonth`. Kept lean on purpose — four columns, an indexed
// lab_id + month range, statements without line detail excluded server-side,
// and paged past the 1,000-row cap. Aggregation happens client-side in one
// pass over what is at most a few thousand small rows.
export async function fetchChargedLineItems(labId, sinceMonth) {
  const rows = await fetchAllPages(() =>
    supabase
      .from("clinic_statements")
      .select("clinic_id, clinic_name, month, line_items")
      .eq("lab_id", labId)
      .gte("month", sinceMonth)
      .neq("line_items", "[]")
      .order("month", { ascending: true })
      .order("id")
  );
  return rows.map((r) => ({
    clinicId: r.clinic_id,
    clinicName: r.clinic_name ?? "",
    month: r.month,
    lineItems: r.line_items ?? [],
  }));
}

export async function upsertClinicPriceRule(labId, clinicId, { priceScheduleId = null, discountPct = 0 }) {
  const { data, error } = await supabase
    .from("clinic_price_rules")
    .upsert(
      {
        lab_id: labId,
        clinic_id: clinicId,
        price_schedule_id: priceScheduleId,
        discount_pct: discountPct,
      },
      { onConflict: "lab_id,clinic_id" }
    )
    .select()
    .single();
  if (error) throw error;
  return clinicRuleFromRow(data);
}

export async function deleteClinicPriceRule(labId, clinicId) {
  const { error } = await supabase
    .from("clinic_price_rules")
    .delete()
    .eq("lab_id", labId)
    .eq("clinic_id", clinicId);
  if (error) throw error;
}

/* ------------------------------------------------------------------ */
/*  Profile self-service (name / phone / avatar — never email, that's   */
/*  the auth.users login identity, not a profile field)                 */
/* ------------------------------------------------------------------ */

export async function updateProfile(userId, { name, phone, avatarUrl }) {
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (phone !== undefined) patch.phone = phone;
  if (avatarUrl !== undefined) patch.avatar_url = avatarUrl;
  const { error } = await supabase.from("profiles").update(patch).eq("id", userId);
  if (error) throw error;
}

// Uploads to <userId>/avatar.<ext> (upsert, so re-uploading just replaces the
// same object) and returns a cache-busted public URL — the bucket is public,
// but storage RLS still only lets a user write inside their own folder.
export async function uploadAvatar(userId, file) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${userId}/avatar.${ext}`;
  const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
  if (uploadError) throw uploadError;
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
}

/* ------------------------------------------------------------------ */
/*  Rx photo attachments — real uploads (clinical / shade photos) so    */
/*  the lab actually sees what the dentist sends, not just a filename.  */
/*  Uploaded while the Rx form is open, before the case row exists, so  */
/*  the path is keyed by a client-side temp id rather than a case id.   */
/* ------------------------------------------------------------------ */

export async function uploadCasePhoto(userId, groupId, file) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  const path = `${userId}/${groupId}/${stamp}-${rand}.${ext}`;
  // The public URL is derived from the path alone, so we know it before the
  // bytes are uploaded — the case can carry the final URL even offline.
  const publicUrl = supabase.storage.from("case-photos").getPublicUrl(path).data.publicUrl;
  try {
    const { error: uploadError } = await supabase.storage.from("case-photos").upload(path, file);
    if (uploadError) throw uploadError;
    return publicUrl;
  } catch (err) {
    if (isNetworkError(err)) {
      // Offline: stash the blob to upload later; the case already has the URL.
      await putBlob({ path, bucket: "case-photos", blob: file, contentType: file.type || "image/jpeg" });
      return publicUrl;
    }
    throw err; // a real rejection (size/mime/RLS) — let the form show it
  }
}

// Drain the offline photo queue: upload each stashed blob to its path. A
// network failure keeps it for the next flush; a success (or an "already
// exists" from a duplicate replay) removes it. Returns how many uploaded.
export async function flushBlobUploads() {
  let uploaded = 0;
  const pending = await allBlobs().catch(() => []);
  for (const rec of pending) {
    try {
      const { error } = await supabase.storage.from(rec.bucket).upload(rec.path, rec.blob, {
        contentType: rec.contentType,
        upsert: true, // idempotent: a duplicate replay just overwrites the same bytes
      });
      if (error) throw error;
      await deleteBlob(rec.path);
      uploaded++;
    } catch (err) {
      if (isNetworkError(err)) break; // still offline — stop, keep the rest
      // A persistent server rejection: drop it so it can't wedge the queue
      // forever (the thumbnail will 404, but the case itself is unaffected).
      await deleteBlob(rec.path);
    }
  }
  return uploaded;
}

/* ------------------------------------------------------------------ */
/*  Super Admin privileged actions — everything here needs the service  */
/*  role (deleting a login, listing raw auth.users, generating an       */
/*  impersonation session), so it goes through the admin-actions Edge   */
/*  Function rather than a direct table call. The function re-checks    */
/*  role='admin' server-side on every call; this client code is not the */
/*  security boundary.                                                  */
/* ------------------------------------------------------------------ */

async function callAdminAction(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke("admin-actions", { body: { action, ...payload } });
  if (error) {
    let detail = error.message;
    try {
      const parsed = await error.context?.json?.();
      if (parsed?.error) detail = parsed.error;
    } catch {
      /* keep the generic message */
    }
    throw new Error(detail);
  }
  return data;
}

export async function adminListUsers() {
  const { users } = await callAdminAction("list-users");
  return users;
}

export async function adminDeleteAccount(userId) {
  await callAdminAction("delete-account", { userId });
}

export async function adminDeleteOrg(orgType, id) {
  await callAdminAction("delete-org", { orgType, id });
}

export async function adminDeleteCase(caseId) {
  await callAdminAction("delete-case", { caseId });
}

export async function adminGetImpersonationToken(userId) {
  return callAdminAction("impersonate", { userId }); // { hashedToken, email }
}

export async function adminSetLabStatus(labId, status) {
  await callAdminAction("set-lab-status", { labId, status });
}

// Activity audit (Phases 37/38). The context is set once per session by
// useAuth after the profile loads; every logActivity call rides on it.
// All fire-and-forget: an audit hiccup must never affect the app.
let activityCtx = null;
export function setActivityContext(ctx) {
  activityCtx = ctx; // { userId, name, email, role, orgName }
}

export async function logActivity(action, detail = "") {
  const ctx = activityCtx;
  if (!ctx?.userId) return;
  try {
    await supabase.from("login_events").insert({
      user_id: ctx.userId,
      name: ctx.name ?? "",
      email: ctx.email ?? "",
      role: ctx.role ?? "",
      org_name: ctx.orgName ?? "",
      action,
      detail: String(detail).slice(0, 300),
    });
  } catch {
    /* ignore */
  }
}

export async function logLoginEvent({ userId, name, email, role, orgName }) {
  setActivityContext({ userId, name, email, role, orgName });
  try {
    await supabase.from("login_events").insert({
      user_id: userId,
      name: name ?? "",
      email: email ?? "",
      role: role ?? "",
      org_name: orgName ?? "",
      action: "sign-in",
    });
  } catch {
    /* ignore */
  }
}

export async function fetchLoginEvents(limit = 500) {
  const { data, error } = await supabase
    .from("login_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data.map((r) => ({
    id: r.id,
    userId: r.user_id,
    name: r.name,
    email: r.email ?? "",
    role: r.role,
    orgName: r.org_name,
    action: r.action ?? "sign-in",
    detail: r.detail ?? "",
    at: r.created_at,
  }));
}

// A log row's human identity. Some accounts carry the generic "Lab Tech"/
// "Lab" display-name placeholder from onboarding, which is useless in an
// audit trail — fall back to the email so a real person is always named.
const GENERIC_NAMES = new Set(["lab tech", "lab", "dentist", "no profile yet", ""]);
export function logDisplayName(row) {
  const name = (row?.name ?? "").trim();
  if (name && !GENERIC_NAMES.has(name.toLowerCase())) return name;
  return (row?.email ?? "").trim() || name || "Unknown user";
}

// Every log row since `sinceIso`, paginated past the PostgREST 1000-row cap
// (an Excel export of 6 months can easily exceed the panel's display limit).
export async function fetchLoginEventsSince(sinceIso) {
  const rows = await fetchAllPages(() =>
    supabase.from("login_events").select("*").gte("created_at", sinceIso).order("created_at", { ascending: false })
  );
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    name: r.name,
    email: r.email ?? "",
    role: r.role,
    orgName: r.org_name,
    action: r.action ?? "sign-in",
    detail: r.detail ?? "",
    at: r.created_at,
  }));
}

// Pure mapper for the Excel export (kept separate so it's unit-testable):
// header row + one row per event, person resolved via logDisplayName.
export function logExportRows(events) {
  return [
    ["Date & time", "Name", "Email", "Role", "Organization", "Action", "Detail"],
    ...events.map((e) => [
      e.at ? new Date(e.at).toLocaleString() : "",
      logDisplayName(e),
      e.email ?? "",
      e.role ?? "",
      e.orgName ?? "",
      e.action ?? "",
      e.detail ?? "",
    ]),
  ];
}

export async function adminSetClinicStatus(clinicId, status) {
  await callAdminAction("set-clinic-status", { clinicId, status });
}

export async function adminSetLabRoles(userId, labId, roles) {
  await callAdminAction("set-lab-role", { userId, labId, roles });
}

export async function adminTransferLabOwnership(labId, newOwnerId) {
  await callAdminAction("transfer-lab-ownership", { labId, newOwnerId });
}

// Cross-tenant price sheet inspection — plain RLS reads via is_admin().
export async function adminFetchPriceSchedules() {
  const { data, error } = await supabase
    .from("price_schedules")
    .select("*, price_schedule_items(*)")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data.map(priceScheduleFromRow);
}

/* ------------------------------------------------------------------ */
/*  Case notes — a small shared thread between the clinic and lab on    */
/*  one case, separate from the lifecycle audit history.                */
/* ------------------------------------------------------------------ */

const caseNoteFromRow = (r) => ({
  id: r.id,
  caseId: r.case_id,
  authorRole: r.author_role,
  authorName: r.author_name,
  body: r.body,
  createdAt: r.created_at,
});

export async function fetchCaseNotes(caseId) {
  const { data, error } = await supabase
    .from("case_notes")
    .select("*")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data.map(caseNoteFromRow);
}

export async function insertCaseNote(caseId, authorRole, authorName, body) {
  const { data, error } = await supabase
    .from("case_notes")
    .insert({ case_id: caseId, author_role: authorRole, author_name: authorName, body })
    .select()
    .single();
  if (error) throw error;
  return caseNoteFromRow(data);
}

/* ------------------------------------------------------------------ */
/*  Follow-up / iterative rounds + returned-work remakes (Phase 41).    */
/*  A round is a child of a parent case: an extra clinical stage of a    */
/*  multi-visit case, or a post-delivery return (remake/adjustment/      */
/*  refit). The parent case is never mutated. Rounds are free; the       */
/*  lab-internal cost estimate + fault live in a separate finance-only   */
/*  table (case_round_costs) that technicians can't read.                */
/* ------------------------------------------------------------------ */

export const ROUND_KINDS = ["stage", "remake", "adjustment", "refit"];
export const ROUND_KIND_LABELS = {
  stage: "Next stage",
  remake: "Remake",
  adjustment: "Adjustment",
  refit: "Refit",
};

const caseRoundFromRow = (r) => ({
  id: r.id,
  parentCaseId: r.parent_case_id,
  kind: r.kind,
  instructions: r.instructions ?? "",
  attachments: Array.isArray(r.attachments) ? r.attachments : [],
  pickupRequested: !!r.pickup_requested,
  status: r.status,
  createdBy: r.created_by,
  createdByRole: r.created_by_role,
  createdByName: r.created_by_name ?? "",
  createdAt: r.created_at,
  resolvedAt: r.resolved_at,
});

// All rounds visible to the caller (RLS scopes to their clinic/lab). Callers
// group by parentCaseId in memory; a lab-wide fetch is one round trip.
export async function fetchCaseRounds() {
  const rows = await fetchAllPages(() =>
    supabase.from("case_rounds").select("*").order("created_at", { ascending: false })
  );
  return rows.map(caseRoundFromRow);
}

export async function insertCaseRound(round) {
  // kind is constrained both here and by a DB CHECK; never trust a free value.
  if (!ROUND_KINDS.includes(round.kind)) throw new Error("Invalid follow-up kind");
  const { data, error } = await supabase
    .from("case_rounds")
    .insert({
      parent_case_id: round.parentCaseId,
      kind: round.kind,
      instructions: (round.instructions ?? "").slice(0, 4000),
      attachments: (round.attachments ?? []).filter((a) => a && a.url),
      pickup_requested: !!round.pickupRequested,
      created_by_role: round.createdByRole,
      created_by_name: round.createdByName ?? "",
    })
    .select()
    .single();
  if (error) throw error;
  return caseRoundFromRow(data);
}

export async function resolveCaseRound(id, resolvedBy) {
  const { data, error } = await supabase
    .from("case_rounds")
    .update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: resolvedBy ?? null })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return caseRoundFromRow(data);
}

export async function reopenCaseRound(id) {
  const { data, error } = await supabase
    .from("case_rounds")
    .update({ status: "open", resolved_at: null, resolved_by: null })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return caseRoundFromRow(data);
}

// Lab-internal cost estimate + fault. Reads/writes only succeed for finance
// roles (admin/accountant) via RLS — techs get an empty result, never an error.
export const ROUND_FAULTS = ["unclassified", "lab", "clinic", "shared"];
export const ROUND_FAULT_LABELS = {
  unclassified: "Unclassified",
  lab: "Lab fault",
  clinic: "Clinic fault",
  shared: "Shared",
};

const roundCostFromRow = (r) => ({
  roundId: r.round_id,
  labId: r.lab_id,
  fault: r.fault,
  costEstimate: r.cost_estimate == null ? null : Number(r.cost_estimate),
  note: r.note ?? "",
  updatedAt: r.updated_at,
});

export async function fetchRoundCosts(labId) {
  const { data, error } = await supabase.from("case_round_costs").select("*").eq("lab_id", labId);
  if (error) throw error;
  return data.map(roundCostFromRow);
}

export async function upsertRoundCost({ roundId, labId, fault, costEstimate, note }) {
  if (fault != null && !ROUND_FAULTS.includes(fault)) throw new Error("Invalid fault value");
  const { data, error } = await supabase
    .from("case_round_costs")
    .upsert(
      {
        round_id: roundId,
        lab_id: labId,
        fault: fault ?? "unclassified",
        cost_estimate: costEstimate === "" || costEstimate == null ? null : Number(costEstimate),
        note: (note ?? "").slice(0, 500),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "round_id" }
    )
    .select()
    .single();
  if (error) throw error;
  return roundCostFromRow(data);
}

/* ------------------------------------------------------------------ */
/*  Realtime — keeps dentist + lab views in sync without a refresh      */
/* ------------------------------------------------------------------ */

export function subscribeCases({ clinicId, labId }, onChange) {
  const filter = clinicId ? `clinic_id=eq.${clinicId}` : `lab_id=eq.${labId}`;
  const channel = supabase
    .channel(`cases-${clinicId ?? labId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "cases", filter }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

/* ------------------------------------------------------------------ */
/*  QR mobile photo upload sessions (Phase 51). The desktop creates a   */
/*  session (RLS: own rows, <=15 min), shows its id as a QR; the phone  */
/*  talks to the mobile-upload Edge Function; the desktop watches its   */
/*  own row for the function's update.                                  */
/* ------------------------------------------------------------------ */

export async function createMobileUploadSession(groupId) {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("mobile_upload_sessions")
    .insert({ user_id: userId, group_id: groupId })
    .select()
    .single();
  if (error) throw error;
  return { id: data.id, expiresAt: data.expires_at };
}

export async function fetchMobileUploadSession(id) {
  const { data, error } = await supabase
    .from("mobile_upload_sessions")
    .select("id, status, uploaded, expires_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function cancelMobileUploadSession(id) {
  // Best-effort: an expired/used row simply doesn't match the RLS check.
  await supabase.from("mobile_upload_sessions").update({ status: "cancelled" }).eq("id", id).eq("status", "pending");
}

export function subscribeMobileUploadSession(id, onChange) {
  const channel = supabase
    .channel(`mob-upload-${id}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "mobile_upload_sessions", filter: `id=eq.${id}` }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

// Follow-up rounds. No row filter: RLS already scopes what each subscriber
// receives to rounds on their own clinic's or lab's cases, so a bare listener
// only ever hears about rounds it's allowed to see.
export function subscribeCaseRounds(onChange) {
  const channel = supabase
    .channel("case_rounds")
    .on("postgres_changes", { event: "*", schema: "public", table: "case_rounds" }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

/* ------------------------------------------------------------------ */
/*  Financial engine (Phase 26) — statements, payments, expenses,      */
/*  technician commission rates. Lab-admin only; RLS enforces it.      */
/* ------------------------------------------------------------------ */

const statementFromRow = (r) => ({
  id: r.id,
  labId: r.lab_id,
  clinicId: r.clinic_id,
  clinicName: r.clinic_name ?? "",
  month: r.month, // "YYYY-MM-01"
  total: Number(r.total) || 0,
  status: r.status,
  createdAt: r.created_at,
  // Imported-history statements carry their per-row detail here (Phase 31);
  // platform-generated statements itemize via cases.statement_id instead.
  lineItems: r.line_items ?? [],
});

const paymentFromRow = (r) => ({
  id: r.id,
  labId: r.lab_id,
  clinicId: r.clinic_id,
  clinicName: r.clinic_name ?? "",
  statementId: r.statement_id ?? null,
  cancelStatus: r.cancel_status ?? "none",
  cancellationFee: r.cancellation_fee != null ? Number(r.cancellation_fee) : null,
  priceOverridden: r.price_overridden ?? false,
  amount: Number(r.amount) || 0,
  method: r.method,
  reference: r.reference ?? "",
  receivedDate: r.received_date,
  cleared: !!r.cleared,
  clearedDate: r.cleared_date ?? null,
  createdAt: r.created_at,
});

const expenseFromRow = (r) => ({
  id: r.id,
  labId: r.lab_id,
  category: r.category,
  amount: Number(r.amount) || 0,
  method: r.method,
  description: r.description ?? "",
  invoiceNumber: r.invoice_number ?? "",
  expenseDate: r.expense_date,
  createdAt: r.created_at,
});

// PostgREST caps any single select at 1,000 rows — a multi-year imported
// history blows past that (silently: the Billing tab just showed nothing
// older than ~2021). Page until a short page proves we have everything.
const fetchAllPages = async (buildQuery) => {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await buildQuery().range(from, from + 999);
    if (error) throw error;
    all.push(...data);
    if (data.length < 1000) return all;
  }
};

// line_items is deliberately absent here — the imported-history detail is
// ~95% of the table's bytes, so the Billing tab first paints from this lean
// select and fetchStatementLineItems fills the detail in behind it.
const STATEMENT_COLUMNS = "id, lab_id, clinic_id, clinic_name, month, total, status, created_at";

export async function fetchStatements(labId) {
  // Secondary order on id keeps pages stable — rows sharing a month would
  // otherwise shuffle between pages and get skipped or duplicated.
  const rows = await fetchAllPages(() =>
    supabase.from("clinic_statements").select(STATEMENT_COLUMNS).eq("lab_id", labId).order("month", { ascending: false }).order("id")
  );
  return rows.map(statementFromRow);
}

export async function fetchStatementLineItems(labId) {
  const rows = await fetchAllPages(() =>
    supabase
      .from("clinic_statements")
      .select("id, line_items")
      .eq("lab_id", labId)
      .neq("line_items", "[]")
      .order("id")
  );
  return new Map(rows.map((r) => [r.id, r.line_items ?? []]));
}

export async function fetchPayments(labId) {
  const rows = await fetchAllPages(() =>
    supabase.from("lab_payments").select("*").eq("lab_id", labId).order("received_date", { ascending: false }).order("id")
  );
  return rows.map(paymentFromRow);
}

export async function fetchExpenses(labId) {
  const rows = await fetchAllPages(() =>
    supabase.from("lab_expenses").select("*").eq("lab_id", labId).order("expense_date", { ascending: false }).order("id")
  );
  return rows.map(expenseFromRow);
}

// Sweeps unbilled completed cases into one statement per clinic for the
// given month; returns how many statements were created or updated.
export async function generateStatements(monthDate) {
  const { data, error } = await supabase.rpc("generate_clinic_statements", { p_month: monthDate });
  if (error) throw error;
  return data ?? 0;
}

export async function insertPayment(labId, { clinicId, clinicName, statementId, amount, method, reference, receivedDate }) {
  const { data, error } = await supabase
    .from("lab_payments")
    .insert({
      lab_id: labId,
      clinic_id: clinicId ?? null,
      // Imported-history statements have no clinic_id — the name text is
      // what keeps their payments attributable in the payments list.
      clinic_name: clinicName ?? "",
      statement_id: statementId || null,
      amount,
      method,
      reference: reference ?? "",
      received_date: receivedDate,
      // Cheques sit in the pending portfolio until explicitly cleared.
      cleared: method !== "cheque",
      cleared_date: method !== "cheque" ? receivedDate : null,
    })
    .select()
    .single();
  if (error) throw error;
  return paymentFromRow(data);
}

export async function markChequeCleared(paymentId) {
  const { data, error } = await supabase
    .from("lab_payments")
    .update({ cleared: true, cleared_date: new Date().toISOString().slice(0, 10) })
    .eq("id", paymentId)
    .select()
    .single();
  if (error) throw error;
  return paymentFromRow(data);
}

export async function deletePayment(paymentId) {
  const { error } = await supabase.from("lab_payments").delete().eq("id", paymentId);
  if (error) throw error;
}

export async function insertExpense(labId, { category, amount, method, description, invoiceNumber, expenseDate }) {
  const row = { lab_id: labId, category, amount, method, description: description ?? "", expense_date: expenseDate };
  // Omitted when empty so inserts still work before the Phase 35 column exists.
  if (invoiceNumber) row.invoice_number = invoiceNumber;
  const { data, error } = await supabase
    .from("lab_expenses")
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return expenseFromRow(data);
}

export async function deleteExpense(expenseId) {
  const { error } = await supabase.from("lab_expenses").delete().eq("id", expenseId);
  if (error) throw error;
}

export async function fetchCommissionRates(labId) {
  const { data, error } = await supabase
    .from("tech_commission_rates")
    .select("*")
    .eq("lab_id", labId);
  if (error) throw error;
  return Object.fromEntries(data.map((r) => [r.user_id, r.rates ?? {}]));
}

export async function saveCommissionRates(labId, userId, rates) {
  const { error } = await supabase
    .from("tech_commission_rates")
    .upsert({ lab_id: labId, user_id: userId, rates }, { onConflict: "lab_id,user_id" });
  if (error) throw error;
}

/* ------------------------------------------------------------------ */
/*  Historical finance import (Phase 28) — bulk inserts for rows        */
/*  mapped by src/lib/financeImport.js. Imported bills/payments carry   */
/*  a free-text clinic_name (their clinics usually aren't registered).  */
/* ------------------------------------------------------------------ */

const chunked = async (rows, insertChunk) => {
  for (let i = 0; i < rows.length; i += 200) {
    await insertChunk(rows.slice(i, i + 200));
  }
};

export async function importFinanceRows(labId, { statements = [], payments = [], expenses = [] }) {
  // Statements first: each may carry an already-paid amount that becomes an
  // allocated payment row, so status/recompute land correctly via trigger.
  // Fully-unpaid statements (the whole "work done" category) don't need the
  // returned id, so they insert in bulk — a multi-year history import is
  // 1,000+ statements and one-by-one takes minutes.
  const stRow = (st) => {
    const row = { lab_id: labId, clinic_id: null, clinic_name: st.clinicName, month: st.month, total: st.total };
    // Omitted when empty so categories without line detail still import on
    // databases where the Phase 31 column hasn't been added yet.
    if (st.lineItems?.length) row.line_items = st.lineItems;
    return row;
  };
  await chunked(statements.filter((st) => !(st.paid > 0)), async (batch) => {
    const { error } = await supabase.from("clinic_statements").insert(batch.map(stRow));
    if (error) throw error;
  });
  for (const st of statements.filter((st) => st.paid > 0)) {
    const { data, error } = await supabase
      .from("clinic_statements")
      .insert(stRow(st))
      .select()
      .single();
    if (error) throw error;
    if (st.paid > 0) {
      const { error: payErr } = await supabase.from("lab_payments").insert({
        lab_id: labId,
        clinic_id: null,
        clinic_name: st.clinicName,
        statement_id: data.id,
        amount: st.paid,
        method: "cash",
        reference: "Imported — paid amount from bill sheet",
        received_date: st.month,
        cleared: true,
        cleared_date: st.month,
      });
      if (payErr) throw payErr;
    }
  }
  await chunked(payments, async (batch) => {
    const { error } = await supabase.from("lab_payments").insert(
      batch.map((p) => ({
        lab_id: labId,
        clinic_id: null,
        clinic_name: p.clinicName ?? "",
        amount: p.amount,
        method: p.method,
        reference: p.reference ?? "",
        received_date: p.receivedDate,
        cleared: p.cleared !== false,
        cleared_date: p.cleared !== false ? p.receivedDate : null,
      })),
    );
    if (error) throw error;
  });
  await chunked(expenses, async (batch) => {
    const { error } = await supabase.from("lab_expenses").insert(
      batch.map((e) => {
        const row = {
          lab_id: labId,
          category: e.category,
          amount: e.amount,
          method: e.method,
          description: e.description ?? "",
          expense_date: e.expenseDate,
        };
        if (e.invoiceNumber) row.invoice_number = e.invoiceNumber;
        return row;
      }),
    );
    if (error) throw error;
  });
}
