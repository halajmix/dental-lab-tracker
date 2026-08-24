import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X, Printer, Receipt } from "lucide-react";
import { toothSummary, includedSummary, SHADE_BY_LAB, ARCH_LABELS } from "./PrescriptionForm.jsx";

/**
 * View / Print Invoice — a lab billing document for one case, opened from the
 * case drawer. Same overlay + print mechanics as PrintRx (portalled to <body>,
 * #root hidden under @media print, A4 @page), but deliberately text-only and
 * monochrome: no photos, no tooth diagram — a clean paper invoice.
 *
 * Pricing honesty: the platform stores one price per case (the pricing engine
 * itemizes server-side), so the work-order table lists clinical items WITHOUT
 * per-line amounts and the money appears once, in the summary block.
 */

// OMR shows up to 3 decimals (baisa) — same formatting as LabFinance/LabAdmin.
const fmtMoney = (n) =>
  Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 });

const fmtDate = (d) => {
  if (!d) return "—";
  try {
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt.getTime())) return String(d);
    return dt.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return String(d);
  }
};

const shadeLine = (guide, shade, labShade) => {
  if (guide === SHADE_BY_LAB) return labShade ? `${labShade} (determined by lab)` : "To be determined by lab";
  if (shade && shade !== "N/A") return guide ? `${shade} — ${guide}` : shade;
  return null;
};

// One detail line inside a work-order row; renders nothing when empty.
function Line({ label, value }) {
  if (!value) return null;
  return (
    <p className="text-[11px] leading-snug text-slate-600">
      <span className="font-semibold text-slate-500">{label}: </span>
      {value}
    </p>
  );
}

const PAYMENT_STATUS = {
  draft: { text: "UNPAID — not yet invoiced", cls: "border-slate-400 text-slate-700" },
  issued: { text: "INVOICED — payment due", cls: "border-amber-500 text-amber-700" },
  paid: { text: "PAID", cls: "border-emerald-500 text-emerald-700" },
};

export default function PrintInvoice({ open, caseObj, clinic, lab, onClose }) {
  // Opening the overlay also fires the print dialog (once per open) — the
  // sheet is text-only, so nothing async needs to settle beyond first paint.
  const firedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      firedRef.current = false;
      return;
    }
    if (firedRef.current) return;
    firedRef.current = true;
    const t = setTimeout(() => window.print(), 450);
    return () => clearTimeout(t);
  }, [open, caseObj?.id]);

  if (!open || !caseObj) return null;

  const rx = caseObj.prescription;
  // Cart and flat prescriptions normalize to one list of work items.
  const items = rx?.restorations?.length
    ? rx.restorations.map((r) => ({ ...r, notation: rx.notation }))
    : rx
    ? [rx]
    : [];

  const invoiceNo = caseObj.invoiceNumber?.trim() || `INV-${caseObj.id.replace(/^C-/, "")}`;
  const orderDate = caseObj.history?.[0]?.at ?? caseObj.createdDate;
  const cancelled = caseObj.cancelStatus === "cancelled";
  const amount = cancelled ? caseObj.cancellationFee ?? null : caseObj.totalPrice ?? null;
  const status = cancelled && !(caseObj.cancellationFee > 0)
    ? { text: "CANCELLED — no charge", cls: "border-slate-400 text-slate-700" }
    : PAYMENT_STATUS[caseObj.invoiceStatus] ?? PAYMENT_STATUS.draft;

  const included = includedSummary(rx)
    ? [...(rx?.included ?? []), ...(rx?.includedOther?.trim() ? [rx.includedOther.trim()] : [])].join(", ")
    : null;
  const labAddress = [lab?.address, [lab?.wilayat, lab?.governorate].filter(Boolean).join(", ")]
    .map((s) => s?.trim())
    .filter(Boolean);

  return createPortal(
    <div className="print-portal fixed inset-0 z-[70] overflow-y-auto bg-slate-500/60">
      {/* Same print rules as PrintRx: the portal lives on <body>, so hiding
          #root removes the entire app (drawers, nav, buttons) from paper. */}
      <style>{`
        @media print {
          #root { display: none !important; }
          .no-print { display: none !important; }
          .print-portal {
            position: static !important;
            overflow: visible !important;
            background: #fff !important;
          }
          .print-sheet {
            margin: 0 !important;
            padding: 0 !important;
            max-width: none !important;
            box-shadow: none !important;
          }
          @page { size: A4; margin: 14mm; }
        }
      `}</style>

      {/* toolbar (screen only) */}
      <div className="no-print sticky top-0 z-10 flex items-center justify-between bg-slate-800 px-4 py-2.5 text-white">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Receipt size={16} /> Invoice · {caseObj.id}
        </span>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold hover:bg-blue-700">
            <Printer size={15} /> Print / Save PDF
          </button>
          <button onClick={onClose} className="flex items-center gap-1.5 rounded-lg bg-slate-600 px-3 py-1.5 text-sm font-semibold hover:bg-slate-500">
            <X size={15} /> Close
          </button>
        </div>
      </div>

      {/* the A4 sheet */}
      <div className="mx-auto my-6 max-w-[794px] bg-white p-10 text-[13px] leading-relaxed text-slate-800 shadow-2xl print-sheet print:my-0 print:max-w-none print:p-0 print:shadow-none">
        {/* header: lab identity + invoice metadata */}
        <div className="flex items-start justify-between gap-6 border-b-2 border-slate-800 pb-4 break-inside-avoid">
          <div className="min-w-0">
            <h1 className="text-xl font-black tracking-tight text-slate-900">{lab?.name ?? "Dental Laboratory"}</h1>
            {labAddress.map((line) => (
              <p key={line} className="text-xs text-slate-500">{line}</p>
            ))}
            {lab?.contact && <p className="text-xs text-slate-500">Tel: {lab.contact}</p>}
            {lab?.email && <p className="text-xs text-slate-500">{lab.email}</p>}
          </div>
          <div className="shrink-0 text-right text-xs">
            <p className="text-lg font-black uppercase tracking-widest text-slate-900">Invoice</p>
            <p className="mt-1"><span className="text-slate-500">Invoice #: </span><span className="font-bold text-slate-800">{invoiceNo}</span></p>
            <p><span className="text-slate-500">Invoice date: </span><span className="font-semibold text-slate-700">{fmtDate(new Date())}</span></p>
            <p><span className="text-slate-500">Case ID: </span><span className="font-semibold text-slate-700">{caseObj.id}</span></p>
            <p><span className="text-slate-500">Order date: </span><span className="font-semibold text-slate-700">{fmtDate(orderDate)}</span></p>
          </div>
        </div>

        {/* billed-to / patient / delivery */}
        <div className="mt-4 grid grid-cols-3 gap-6 break-inside-avoid">
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Billed To</p>
            <p className="font-bold text-slate-800">{clinic?.name ?? "—"}</p>
            {clinic?.dentist && <p className="text-xs text-slate-600">{clinic.dentist}</p>}
            {clinic?.contact && <p className="text-xs text-slate-500">{clinic.contact}</p>}
          </div>
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Patient</p>
            <p className="font-bold text-slate-800">{caseObj.patientName}</p>
            {caseObj.patientId && <p className="text-xs text-slate-500">{caseObj.patientId}</p>}
          </div>
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Scheduled Delivery</p>
            <p className="font-bold text-slate-800">{fmtDate(caseObj.appointmentDate)}</p>
            {caseObj.deliveryTime && caseObj.deliveryTime !== "Anytime" && (
              <p className="text-xs text-slate-500">{caseObj.deliveryTime}</p>
            )}
          </div>
        </div>

        {/* clinical work order */}
        <div className="mt-5">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Clinical Work Order &amp; Technical Specifications</p>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-y border-slate-300 text-[10px] uppercase tracking-wider text-slate-500">
                <th className="py-1.5 pr-2 font-bold">#</th>
                <th className="py-1.5 pr-2 font-bold">Work item &amp; specifications</th>
                <th className="py-1.5 pr-2 font-bold">Teeth</th>
                <th className="py-1.5 text-right font-bold">Units</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr className="border-b border-slate-200">
                  <td colSpan={4} className="py-2 text-xs text-slate-400">No prescription detail on file for this case.</td>
                </tr>
              )}
              {items.map((r, i) => {
                const teeth = toothSummary({ teeth: r.teeth, notation: r.notation ?? rx?.notation }) || null;
                const shade = shadeLine(r.shadeGuide, r.vitaShade, caseObj.labShade);
                const arch = r.arches ? ARCH_LABELS[r.arches] ?? r.arches : null;
                return (
                  <tr key={r.id ?? i} className="border-b border-slate-200 align-top break-inside-avoid">
                    <td className="py-2 pr-2 text-xs font-bold text-slate-500">{i + 1}</td>
                    <td className="py-2 pr-2">
                      <p className="text-sm font-bold text-slate-800">
                        Restoration {i + 1} of {items.length} — {r.category ?? "—"}
                      </p>
                      <Line label="Material" value={r.material} />
                      <Line label="Arch" value={arch} />
                      <Line label="Shade" value={shade} />
                      {r.implantSystem && (
                        <Line
                          label="Implant"
                          value={[`Brand: ${r.implantSystem}`, r.abutmentType && `Abutment: ${r.abutmentType}`, r.abutmentColor && `Colour: ${r.abutmentColor}`]
                            .filter(Boolean)
                            .join(" · ")}
                        />
                      )}
                      <Line label="Stump / prep shade" value={r.stumpShade} />
                    </td>
                    <td className="py-2 pr-2 text-xs text-slate-700">{teeth ?? (arch ? arch : "—")}</td>
                    <td className="py-2 text-right text-xs font-semibold tabular-nums text-slate-700">
                      {r.teeth?.length ? r.teeth.length : r.arches ? 1 : "—"}
                    </td>
                  </tr>
                );
              })}
              {included && (
                <tr className="border-b border-slate-200 break-inside-avoid">
                  <td colSpan={4} className="py-2 text-[11px] text-slate-600">
                    <span className="font-semibold text-slate-500">Clinical items included: </span>{included}
                  </td>
                </tr>
              )}
              {rx?.notes && (
                <tr className="border-b border-slate-200 break-inside-avoid">
                  <td colSpan={4} className="py-2 text-[11px] text-slate-600">
                    <span className="font-semibold text-slate-500">Special clinical notes: </span>{rx.notes}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* financial summary */}
        <div className="mt-6 flex justify-end break-inside-avoid">
          <div className="w-64">
            <div className="flex items-center justify-between border-b border-slate-200 py-1.5 text-xs">
              <span className="text-slate-500">{cancelled ? "Cancellation fee" : "Subtotal"}</span>
              <span className="font-semibold tabular-nums text-slate-700">{amount != null ? `${fmtMoney(amount)} OMR` : "Not yet priced"}</span>
            </div>
            <div className="flex items-center justify-between border-b border-slate-200 py-1.5 text-xs">
              <span className="text-slate-500">Tax / fees</span>
              <span className="font-semibold tabular-nums text-slate-700">—</span>
            </div>
            <div className="flex items-center justify-between border-b-2 border-slate-800 py-2">
              <span className="text-sm font-black uppercase tracking-wide text-slate-900">Total</span>
              <span className="text-sm font-black tabular-nums text-slate-900">{amount != null ? `${fmtMoney(amount)} OMR` : "—"}</span>
            </div>
            <div className="mt-2.5 flex justify-end">
              <span className={`inline-block rounded border-2 px-2.5 py-1 text-[11px] font-black tracking-wide ${status.cls}`}>{status.text}</span>
            </div>
            {cancelled && (
              <p className="mt-2 text-right text-[10px] text-slate-500">Case cancelled — billed at the approved cancellation fee.</p>
            )}
          </div>
        </div>

        {/* footer */}
        <div className="mt-8 break-inside-avoid">
          <p className="text-[11px] text-slate-600">Thank you for your business.</p>
          <p className="mt-4 border-t border-slate-200 pt-2 text-center text-[9px] text-slate-400">
            Generated by Dr-Crown · dr-crown.com · {lab?.name ?? ""} {lab?.email ? `· ${lab.email}` : ""}
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}
