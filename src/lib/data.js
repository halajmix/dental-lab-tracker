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
});

export const clinicFromRow = (r) => ({
  id: r.id,
  name: r.name,
  address: r.address ?? "",
  contact: r.contact ?? "",
  license: r.license ?? "",
  dentist: r.dentist ?? "",
  dentistLicense: r.dentist_license ?? "",
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
export async function updateLab(labId, { contact, tat, procedureTats }) {
  const patch = {};
  if (contact !== undefined) patch.contact = contact;
  if (tat !== undefined) patch.tat = tat;
  if (procedureTats !== undefined) patch.procedure_tats = procedureTats;
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
