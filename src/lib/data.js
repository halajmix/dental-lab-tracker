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
export async function updateLab(labId, { contact, tat, procedureTats, governorate, wilayat }) {
  const patch = {};
  if (contact !== undefined) patch.contact = contact;
  if (tat !== undefined) patch.tat = tat;
  if (procedureTats !== undefined) patch.procedure_tats = procedureTats;
  if (governorate !== undefined) patch.governorate = governorate;
  if (wilayat !== undefined) patch.wilayat = wilayat;
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
