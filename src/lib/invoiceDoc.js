/**
 * Invoice document facts — shared by the A4 sheet (PrintInvoice.jsx) and the
 * 80mm thermal receipt (PrintReceipt.jsx).
 *
 * Both papers must agree on the invoice number, the billed amount and the
 * payment status: they are the same billing document on different stock. The
 * derivation lives here so a change to (say) how a cancelled case is priced
 * can never land on one paper and miss the other.
 *
 * Presentation stays in the components — this module returns text and numbers,
 * never class names or markup.
 */
import { SHADE_BY_LAB, ARCH_LABELS, toothSummary } from "../PrescriptionForm.jsx";

// OMR shows up to 3 decimals (baisa) — same formatting as LabFinance/LabAdmin.
export const fmtMoney = (n) =>
  Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 });

export const fmtDate = (d) => {
  if (!d) return "—";
  try {
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt.getTime())) return String(d);
    return dt.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return String(d);
  }
};

export const invoiceNumberFor = (c) => c.invoiceNumber?.trim() || `INV-${c.id.replace(/^C-/, "")}`;

export const orderDateFor = (c) => c.history?.[0]?.at ?? c.createdDate;

/**
 * The money on the document.
 *   amount   — what the clinic pays. This is `total_price`, which is ALREADY
 *              net of any lab discount; statements sum this column.
 *   discount — the flat OMR the lab knocked off (0 when there is none).
 *   gross    — amount + discount, i.e. the price before the discount. Derived,
 *              never stored, so it cannot drift from what is billed.
 * A cancelled case bills the approved cancellation fee and is never
 * discounted — the fee IS the negotiated number.
 */
export function invoiceAmount(c) {
  const cancelled = c.cancelStatus === "cancelled";
  if (cancelled) {
    const fee = c.cancellationFee ?? null;
    return { cancelled, amount: fee, discount: 0, gross: fee };
  }
  const amount = c.totalPrice ?? null;
  const discount = Number(c.discount ?? 0) || 0;
  return { cancelled, amount, discount, gross: amount == null ? null : amount + discount };
}

export const PAYMENT_STATUS_TEXT = {
  draft: "UNPAID — not yet invoiced",
  issued: "INVOICED — payment due",
  paid: "PAID",
};

// {key, text} — key lets each paper pick its own styling for the same state.
export function invoiceStatus(c) {
  if (c.cancelStatus === "cancelled" && !(c.cancellationFee > 0)) {
    return { key: "cancelled", text: "CANCELLED — no charge" };
  }
  const key = PAYMENT_STATUS_TEXT[c.invoiceStatus] ? c.invoiceStatus : "draft";
  return { key, text: PAYMENT_STATUS_TEXT[key] };
}

// Cart and flat prescriptions normalize to one list of work items.
export function workItems(rx) {
  if (rx?.restorations?.length) return rx.restorations.map((r) => ({ ...r, notation: rx.notation }));
  return rx ? [rx] : [];
}

/* ---- who the invoice is addressed to --------------------------------
   A public health centre does not settle its patients' lab work — the
   patient pays directly — so those invoices are made out to the PATIENT
   and the centre's name is left off the document entirely.

   ⚠️ Matched on the clinic NAME, normalised. That is deliberate for now
   (it ships without a migration) but it is fragile: renaming the clinic to
   e.g. "Health Center Muscat" would silently put the centre back on the
   invoice. `clinic.billsPatient === true` is checked first, so adding a
   `bills_patient` boolean to `clinics` later switches this to real data
   without touching this file.

   NOTE: this changes only the printed DOCUMENT. The case still belongs to
   the clinic everywhere else — its statement, aging and receivable are
   untouched, so nothing about the books moves. */
export const PATIENT_BILLED_CLINICS = ["health center"];

export const billsPatientDirectly = (clinic) =>
  clinic?.billsPatient === true ||
  PATIENT_BILLED_CLINICS.includes((clinic?.name ?? "").trim().toLowerCase());

/** {title, name, lines[], isPatient} — the "Billed to" block. */
export function billedTo(caseObj, clinic) {
  if (billsPatientDirectly(clinic)) {
    return {
      name: caseObj.patientName || "—",
      lines: [caseObj.patientId, caseObj.patientPhone].filter(Boolean),
      isPatient: true,
    };
  }
  return {
    name: clinic?.name ?? "—",
    lines: [clinic?.dentist, clinic?.contact].filter(Boolean),
    isPatient: false,
  };
}

export function labAddressLines(lab) {
  return [lab?.address, [lab?.wilayat, lab?.governorate].filter(Boolean).join(", ")]
    .map((s) => s?.trim())
    .filter(Boolean);
}

export function shadeLine(guide, shade, labShade) {
  if (guide === SHADE_BY_LAB) return labShade ? `${labShade} (determined by lab)` : "To be determined by lab";
  if (shade && shade !== "N/A") return guide ? `${shade} — ${guide}` : shade;
  return null;
}

// Units billed for one work item — teeth count, or 1 for an arch/denture.
export const unitsFor = (r) => (r.teeth?.length ? r.teeth.length : r.arches ? 1 : null);

/* ---- what the invoice says was made ---------------------------------
   Derived from the dentist's prescription, which is the clinical order and
   the only source — the lab does not edit it (guard_prescription_edits
   strips lab-side writes to it). Shared so the receipt and the A4 sheet
   cannot describe the same case differently. */

// One block per work item: a bold title and indented detail lines.
export function deriveBillingItems(caseObj) {
  const rx = caseObj.prescription;
  const items = workItems(rx);
  return items.map((r, i) => {
    const teeth = toothSummary({ teeth: r.teeth, notation: r.notation ?? rx?.notation }) || null;
    const arch = r.arches ? ARCH_LABELS[r.arches] ?? r.arches : null;
    const units = unitsFor(r);
    const implant = r.implantSystem
      ? [`Brand: ${r.implantSystem}`, r.abutmentType && `Abutment: ${r.abutmentType}`,
         r.abutmentColor && `Colour: ${r.abutmentColor}`].filter(Boolean).join(" · ")
      : null;
    return {
      title: `Restoration ${i + 1} of ${items.length} — ${r.category ?? "—"}`,
      details: [
        ["Teeth", teeth ?? arch ?? "—"],
        ["Units", units ?? "—"],
        ["Material", r.material],
        ["Shade", shadeLine(r.shadeGuide, r.vitaShade, caseObj.labShade)],
        ["Implant", implant],
        ["Stump / prep shade", r.stumpShade],
      ].filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k}: ${v}`),
    };
  });
}

