import { supabase } from "./supabaseClient.js";

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

// Every clinic this dentist owns (multi-clinic support) — "clinics_select"
// already matches on owner_id=auth.uid(), no new policy needed for this read.
export async function fetchClinicsByOwner(userId) {
  const { data, error } = await supabase.from("clinics").select("*").eq("owner_id", userId).order("created_at");
  if (error) throw error;
  return data.map(clinicFromRow);
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
  const { data, error } = await supabase.from("cases").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(caseFromRow);
}

function genCaseId() {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 4).toUpperCase();
  return `C-${stamp}${rand}`;
}

export async function insertCase(clinicId, data) {
  const id = genCaseId();
  const { data: row, error } = await supabase
    .from("cases")
    .insert({ id, clinic_id: clinicId, ...caseToRow(data) })
    .select()
    .single();
  if (error) throw error;
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

export async function addPriceItem(scheduleId, { category, code = "", basePrice }) {
  const { data, error } = await supabase
    .from("price_schedule_items")
    .insert({ schedule_id: scheduleId, category, code, base_price: basePrice })
    .select()
    .single();
  if (error) throw error;
  return priceItemFromRow(data);
}

export async function updatePriceItem(id, { code, basePrice }) {
  const patch = {};
  if (code !== undefined) patch.code = code;
  if (basePrice !== undefined) patch.base_price = basePrice;
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
  const { error: uploadError } = await supabase.storage.from("case-photos").upload(path, file);
  if (uploadError) throw uploadError;
  const { data } = supabase.storage.from("case-photos").getPublicUrl(path);
  return data.publicUrl;
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
/*  Financial engine (Phase 26) — statements, payments, expenses,      */
/*  technician commission rates. Lab-admin only; RLS enforces it.      */
/* ------------------------------------------------------------------ */

const statementFromRow = (r) => ({
  id: r.id,
  labId: r.lab_id,
  clinicId: r.clinic_id,
  month: r.month, // "YYYY-MM-01"
  total: Number(r.total) || 0,
  status: r.status,
  createdAt: r.created_at,
});

const paymentFromRow = (r) => ({
  id: r.id,
  labId: r.lab_id,
  clinicId: r.clinic_id,
  statementId: r.statement_id ?? null,
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
  expenseDate: r.expense_date,
  createdAt: r.created_at,
});

export async function fetchStatements(labId) {
  const { data, error } = await supabase
    .from("clinic_statements")
    .select("*")
    .eq("lab_id", labId)
    .order("month", { ascending: false });
  if (error) throw error;
  return data.map(statementFromRow);
}

export async function fetchPayments(labId) {
  const { data, error } = await supabase
    .from("lab_payments")
    .select("*")
    .eq("lab_id", labId)
    .order("received_date", { ascending: false });
  if (error) throw error;
  return data.map(paymentFromRow);
}

export async function fetchExpenses(labId) {
  const { data, error } = await supabase
    .from("lab_expenses")
    .select("*")
    .eq("lab_id", labId)
    .order("expense_date", { ascending: false });
  if (error) throw error;
  return data.map(expenseFromRow);
}

// Sweeps unbilled completed cases into one statement per clinic for the
// given month; returns how many statements were created or updated.
export async function generateStatements(monthDate) {
  const { data, error } = await supabase.rpc("generate_clinic_statements", { p_month: monthDate });
  if (error) throw error;
  return data ?? 0;
}

export async function insertPayment(labId, { clinicId, statementId, amount, method, reference, receivedDate }) {
  const { data, error } = await supabase
    .from("lab_payments")
    .insert({
      lab_id: labId,
      clinic_id: clinicId,
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

export async function insertExpense(labId, { category, amount, method, description, expenseDate }) {
  const { data, error } = await supabase
    .from("lab_expenses")
    .insert({ lab_id: labId, category, amount, method, description: description ?? "", expense_date: expenseDate })
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
