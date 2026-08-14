import React, { useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Printer, FileText, Zap, Paperclip, MessageCircle, Loader2, Check, Download } from "lucide-react";
import { UNIVERSAL_TO_FDI, UPPER_ROW, LOWER_ROW, toothSummary, includedSummary, SHADE_BY_LAB } from "./PrescriptionForm.jsx";
import { buildRxPdf } from "./lib/rxPdf.js";

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// A WhatsApp number must be full international format, digits only, no leading 0.
const normalizePhone = (p) => {
  const digits = (p || "").replace(/\D/g, "");
  return digits.replace(/^0+/, "");
};

// Build a plain-text prescription summary for the WhatsApp message. Guards
// every clinic/lab field with a fallback — this used to dereference
// clinic.name/clinic.dentist directly, which threw synchronously if clinic
// was ever null/incomplete, outside buildShare's only try/catch. That threw
// an unhandled rejection with zero visible feedback: the share panel just
// never appeared, no error, nothing (the reported "Share does nothing" bug).
function buildRxMessage(caseObj, clinic, lab) {
  const rx = caseObj.prescription;
  const lines = [
    `*${clinic?.name ?? "Clinic"}* — Laboratory Prescription`,
    `Patient: ${caseObj.patientName} (${caseObj.patientId})`,
    `Case: ${caseObj.id}`,
    `Lab: ${lab?.name ?? "—"}`,
    `Deliver to clinic on: ${caseObj.appointmentDate}${
      caseObj.deliveryTime && caseObj.deliveryTime !== "Anytime" ? ` (${caseObj.deliveryTime})` : ""
    }`,
  ];
  const shadeText = (guide, shade) => (guide === SHADE_BY_LAB ? "Determined by lab" : shade && shade !== "N/A" ? shade : null);
  if (rx?.restorations?.length) {
    rx.restorations.forEach((r, i) => {
      const teeth = toothSummary({ teeth: r.teeth, notation: rx.notation });
      const shade = shadeText(r.shadeGuide, r.vitaShade);
      lines.push(`Restoration ${i + 1}: ${r.category}${r.material ? ` — ${r.material}` : ""}${teeth ? ` (${teeth})` : ""}${shade ? ` · Shade ${shade}` : ""}`);
    });
    if (rx.rush) lines.push(`Express order`);
    if (rx.notes) lines.push(`Notes: ${rx.notes}`);
  } else if (rx) {
    lines.push(`Restoration: ${rx.category}${rx.material ? ` — ${rx.material}` : ""}`);
    if (toothSummary(rx)) lines.push(`Teeth: ${toothSummary(rx)}`);
    const shade = shadeText(rx.shadeGuide, rx.vitaShade);
    if (shade) lines.push(`Shade: ${shade}`);
    if (rx.rush) lines.push(`Express order`);
    if (rx.notes) lines.push(`Notes: ${rx.notes}`);
  }
  lines.push("", `Dentist: ${clinic?.dentist ?? "—"}`, `The detailed prescription PDF is attached.`);
  return lines.join("\n");
}

/**
 * Build the PDF and work out how to share it.
 *
 * On phones/tablets the native share sheet takes the PDF directly (best path).
 * Everywhere else we must NOT try to auto-open WhatsApp: this runs after an
 * `await`, so the browser has already dropped user-activation and any
 * programmatic `window.open` / anchor click is silently blocked. Instead we
 * return the details and let the UI render a real link for the user to click.
 */
async function buildShare(sheetEl, caseObj, clinic, lab) {
  // The whole thing is one try/catch now — previously only PDF generation
  // was guarded; a throw anywhere else (message building, phone
  // normalizing) was an unhandled rejection with no visible result at all.
  // This always resolves to a usable { shared: false, ... } shape, even in
  // total failure, so the UI always has something to show instead of
  // silently doing nothing.
  try {
    const msg = buildRxMessage(caseObj, clinic, lab);
    const phone = normalizePhone(caseObj.patientPhone);
    // api.whatsapp.com/send, not wa.me — both are official Meta click-to-chat
    // endpoints, but wa.me has been unreliable (connection resets seen in
    // testing) while api.whatsapp.com answers consistently.
    const waUrl = phone
      ? `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(msg)}`
      : `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;

    let file = null;
    let error = null;
    try {
      // Vector-drawn PDF (crisp selectable text, print-quality) with an
      // automatic raster-screenshot fallback for non-Latin case data —
      // see src/lib/rxPdf.js. sheetEl is only consumed by the fallback.
      file = await buildRxPdf(sheetEl, caseObj, clinic, lab, `prescription-${caseObj.id}.pdf`);
    } catch (e) {
      console.error("PDF generation failed", e);
      error = e?.message || "Could not build the PDF.";
    }

    // Native share sheet: attaches the PDF itself (iOS/Android/Safari).
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: `Prescription ${caseObj.id}`, text: msg });
        return { shared: true };
      } catch (e) {
        if (e?.name === "AbortError") return { shared: true }; // user cancelled
        // fall through to the manual panel
      }
    }

    return { shared: false, file, waUrl, msg, phone, error };
  } catch (e) {
    console.error("Building the share failed", e);
    return { shared: false, file: null, waUrl: null, msg: "", phone: null, error: e?.message || "Couldn't prepare the share." };
  }
}

/* ================================================================== */
/*  Mini tooth diagram for the printout                                */
/* ================================================================== */

// Module-scope, not declared inside ToothDiagram's render: a component
// created during render gets a new identity every pass, so React unmounts
// and remounts its whole subtree instead of reconciling it.
function DiagramRow({ teeth, roleOf, notation }) {
  return (
    <div className="flex justify-center gap-[2px]">
      {teeth.map((u) => {
        const role = roleOf[u];
        const fill =
          role === "unit" ? "#1e40af" : role === "veneer" ? "#0f766e" : role === "pontic" ? "#b45309" : "#ffffff";
        const color = role ? "#ffffff" : "#334155";
        return (
          <div
            key={u}
            className="flex h-6 w-6 items-center justify-center rounded border text-[9px] font-bold"
            style={{ background: fill, color, borderColor: role ? fill : "#cbd5e1" }}
          >
            {notation === "FDI" ? UNIVERSAL_TO_FDI[u] : u}
          </div>
        );
      })}
    </div>
  );
}

function ToothDiagram({ prescription }) {
  const notation = prescription?.notation ?? "FDI";
  // Union of every restoration's teeth in cart mode — the diagram is a
  // whole-case-at-a-glance reference, not per-restoration.
  const teeth = prescription?.restorations?.length
    ? prescription.restorations.flatMap((r) => r.teeth)
    : prescription?.teeth ?? [];
  const roleOf = {};
  teeth.forEach((t) => (roleOf[t.universal] = t.role));

  return (
    <div className="space-y-1">
      <DiagramRow teeth={UPPER_ROW} roleOf={roleOf} notation={notation} />
      <div className="text-center text-[8px] uppercase tracking-widest text-slate-400">— occlusal midline —</div>
      <DiagramRow teeth={LOWER_ROW} roleOf={roleOf} notation={notation} />
      <p className="pt-1 text-center text-[10px] text-slate-500">
        {notation} notation · Restored: {teeth.map((t) => (notation === "FDI" ? t.fdi : t.universal) + (t.role === "pontic" ? "(p)" : "")).join(", ") || "—"}
      </p>
    </div>
  );
}

/* ================================================================== */
/*  Printable prescription overlay                                     */
/* ================================================================== */

const Spec = ({ label, value }) => (
  <div className="flex justify-between gap-4 border-b border-dashed border-slate-200 py-1">
    <span className="text-slate-500">{label}</span>
    <span className="text-right font-semibold text-slate-800">{value || "—"}</span>
  </div>
);

export default function PrintRx({ open, caseObj, clinic, lab, onClose, autoShare = false }) {
  const sheetRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [share, setShare] = useState(null); // { file, waUrl, msg, phone, error }
  const firedRef = useRef(false);

  const onShare = async () => {
    setBusy(true);
    setShare(null);
    try {
      const result = await buildShare(sheetRef.current, caseObj, clinic, lab);
      if (!result.shared) setShare(result);
    } finally {
      setBusy(false);
    }
  };

  // Opened straight from a case row ("Share") → build + share immediately.
  useEffect(() => {
    if (!open) {
      firedRef.current = false;
      return;
    }
    if (autoShare && !firedRef.current && sheetRef.current) {
      firedRef.current = true;
      onShare();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoShare, caseObj?.id]);

  if (!open || !caseObj) return null;
  const rx = caseObj.prescription;

  return createPortal(
    <div className="print-portal fixed inset-0 z-[70] overflow-y-auto bg-slate-500/60">
      {/*
        Print rules. The overlay is portalled to <body>, so we can simply hide the
        whole app with display:none. (An earlier version used visibility:hidden —
        that keeps elements in the layout, which produced trailing blank pages.)
      */}
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
        <span className="flex items-center gap-2 text-sm font-semibold"><FileText size={16} /> Print Preview · {caseObj.id}</span>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold hover:bg-blue-700">
            <Printer size={15} /> Print / Save PDF
          </button>
          <button
            onClick={onShare}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60"
            title={caseObj.patientPhone ? `Share PDF with ${caseObj.patientPhone}` : "Add a patient WhatsApp number on the Rx to pre-fill the chat"}
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <MessageCircle size={15} />}
            {busy ? "Preparing PDF…" : "Share via WhatsApp"}
          </button>
          <button onClick={onClose} className="flex items-center gap-1.5 rounded-lg bg-slate-600 px-3 py-1.5 text-sm font-semibold hover:bg-slate-500">
            <X size={15} /> Close
          </button>
        </div>
      </div>
      {!share && (
        <div className="no-print bg-emerald-50 px-4 py-1.5 text-center text-[11px] text-emerald-700">
          <b>Share via WhatsApp</b> builds the PDF instantly — no printing needed. On phone/tablet it attaches the file directly.
        </div>
      )}

      {/* Share panel — shown after the PDF is built. The WhatsApp link is a real
          anchor the user clicks, so it can never be popup-blocked. */}
      {share && (
        <div className="no-print border-b border-emerald-200 bg-emerald-50 px-4 py-3">
          <div className="mx-auto flex max-w-[794px] flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-bold text-emerald-800">
                  <Check size={15} /> Prescription PDF ready
                </p>
                <p className="mt-0.5 text-[11px] text-emerald-700">
                  {share.phone ? (
                    <>Step 1 — download the PDF. Step 2 — open the chat with <b>+{share.phone}</b> and attach it.</>
                  ) : (
                    <>No patient WhatsApp number on this case — the chat will open so you can pick the contact.</>
                  )}
                </p>
              </div>
              <button onClick={() => setShare(null)} className="rounded p-1 text-emerald-700 hover:bg-emerald-100" title="Dismiss">
                <X size={15} />
              </button>
            </div>

            {share.error && (
              <p className="rounded-lg bg-rose-100 px-3 py-2 text-[11px] font-medium text-rose-700">
                {share.waUrl ? `PDF could not be generated: ${share.error} — you can still send the details as text.` : `Couldn't prepare the share: ${share.error}`}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              {share.file && (
                <button
                  onClick={() => downloadFile(share.file)}
                  className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                >
                  <Download size={15} /> 1 · Download PDF
                </button>
              )}
              {/* real anchor → user gesture → never blocked. share.waUrl can be
                  null only in the total-failure case (message building itself
                  threw) — nothing to link to then. */}
              {share.waUrl && (
                <a
                  href={share.waUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  <MessageCircle size={15} /> 2 · Open WhatsApp chat
                </a>
              )}
              {share.msg && (
                <button
                  onClick={() => navigator.clipboard?.writeText(share.msg)}
                  className="flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
                >
                  <Paperclip size={15} /> Copy message text
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* the A4 sheet */}
      <div ref={sheetRef} className="mx-auto my-6 max-w-[794px] bg-white p-10 text-[13px] leading-relaxed text-slate-800 shadow-2xl print-sheet print:my-0 print:max-w-none print:p-0 print:shadow-none">
        {/* header */}
        <div className="flex items-start justify-between border-b-2 border-slate-800 pb-4">
          <div>
            <h1 className="text-xl font-black tracking-tight text-slate-900">{clinic.name}</h1>
            <p className="text-xs text-slate-500">{clinic.address}</p>
            <p className="text-xs text-slate-500">{clinic.contact}</p>
          </div>
          <div className="text-right text-xs">
            <p className="text-sm font-bold text-slate-800">Laboratory Prescription</p>
            <p className="text-slate-500">Date: {new Date().toISOString().slice(0, 10)}</p>
            <p className="mt-1 font-semibold text-slate-700">{clinic.dentist}</p>
          </div>
        </div>

        {/* lab + patient */}
        <div className="mt-4 grid grid-cols-2 gap-6">
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Target Laboratory</p>
            <p className="font-bold text-slate-800">{lab?.name ?? "—"}</p>
            <p className="text-xs text-slate-500">{lab?.address ?? "Address on file"}</p>
            <p className="text-xs text-slate-500">{lab?.contact ?? ""}</p>
          </div>
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Patient &amp; Case</p>
            <p className="font-bold text-slate-800">
              {caseObj.patientName} <span className="font-normal text-slate-500">({caseObj.patientId})</span>
            </p>
            <p className="text-xs text-slate-500">Case: {caseObj.id}</p>
            {caseObj.patientPhone && <p className="text-xs text-slate-500">WhatsApp: {caseObj.patientPhone}</p>}
            <p className="text-xs text-slate-500">
              Deliver to clinic on: <span className="font-semibold text-slate-700">{caseObj.appointmentDate}</span>
              {caseObj.deliveryTime && caseObj.deliveryTime !== "Anytime" && (
                <span className="font-semibold text-slate-700"> · {caseObj.deliveryTime}</span>
              )}
            </p>
            {rx?.rush && (
              <span className="mt-1 inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700 print:border print:border-amber-400">
                <Zap size={11} /> EXPRESS ORDER
              </span>
            )}
          </div>
        </div>

        {/* what was sent with the case */}
        <div className="mt-5 rounded-lg border border-slate-200 p-3 print:border-slate-300">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Included with this case</p>
          {includedSummary(rx) ? (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {[...(rx?.included ?? []), ...(rx?.includedOther?.trim() ? [rx.includedOther.trim()] : [])].map((item) => (
                <span key={item} className="flex items-center gap-1.5 text-slate-700">
                  <span className="flex h-3.5 w-3.5 items-center justify-center border border-slate-500 text-[9px] font-bold leading-none">✓</span>
                  {item}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400">Nothing recorded as sent with this case.</p>
          )}
        </div>

        {/* tooth diagram */}
        <div className="mt-5 rounded-lg border border-slate-200 p-3 print:border-slate-300">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Tooth Selection</p>
          {rx ? <ToothDiagram prescription={rx} /> : <p className="text-sm text-slate-400">No digital tooth selection on file.</p>}
        </div>

        {/* specs */}
        {rx?.restorations?.length ? (
          <div className="mt-5 space-y-3">
            {rx.restorations.map((r, i) => (
              <div key={r.id ?? i} className="rounded-lg border border-slate-200 p-3 print:border-slate-300">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Restoration {i + 1} of {rx.restorations.length} — {toothSummary({ teeth: r.teeth, notation: rx.notation }) || "—"}
                </p>
                <div className="grid grid-cols-2 gap-x-8">
                  <div>
                    <Spec label="Restoration" value={r.category} />
                    <Spec label="Material" value={r.material} />
                    {r.shadeGuide === SHADE_BY_LAB ? (
                      <Spec label="Shade" value="Determined by lab" />
                    ) : (
                      <>
                        <Spec label="Shade Guide" value={r.shadeGuide} />
                        <Spec label="Main Shade" value={r.vitaShade} />
                      </>
                    )}
                  </div>
                  <div>
                    {r.implantSystem && (
                      <>
                        <Spec label="Implant Brand" value={r.implantSystem} />
                        <Spec label="Abutment Size" value={r.abutmentType} />
                        <Spec label="Abutment Colour Code" value={r.abutmentColor} />
                      </>
                    )}
                    <Spec label="Stump / Prep Shade" value={r.stumpShade} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-x-8">
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Material &amp; Appliance</p>
              <Spec label="Restoration" value={rx?.category} />
              <Spec label="Material" value={rx?.material} />
              {rx?.shadeGuide === SHADE_BY_LAB ? (
                <Spec label="Shade" value="Determined by lab" />
              ) : (
                <>
                  <Spec label="Shade Guide" value={rx?.shadeGuide} />
                  <Spec label="Main Shade" value={rx?.vitaShade} />
                </>
              )}
            </div>
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Specifications</p>
              {rx?.implantSystem && (
                <>
                  <Spec label="Implant Brand" value={rx.implantSystem} />
                  <Spec label="Abutment Size" value={rx.abutmentType} />
                  <Spec label="Abutment Colour Code" value={rx.abutmentColor} />
                </>
              )}
              <Spec label="Stump / Prep Shade" value={rx?.stumpShade} />
            </div>
          </div>
        )}

        {/* attachments + notes */}
        <div className="mt-5">
          <p className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <Paperclip size={11} /> Attachments &amp; Special Instructions
          </p>
          <div className="rounded-lg border border-slate-200 p-3 text-xs print:border-slate-300">
            <p className="text-slate-600">
              Attachments: {rx?.files?.length ? rx.files.map((f) => f.name).join(", ") : "None"}
            </p>
            <p className="mt-1 text-slate-700">{rx?.notes || "No special instructions."}</p>
          </div>
          {rx?.files?.some((f) => f.kind === "photo" && f.url) && (
            <div className="mt-2 grid grid-cols-4 gap-2">
              {rx.files
                .filter((f) => f.kind === "photo" && f.url)
                .map((f, i) => (
                  <img
                    key={i}
                    src={f.url}
                    crossOrigin="anonymous"
                    alt={f.name}
                    className="aspect-square w-full rounded-lg border border-slate-200 object-cover print:border-slate-300"
                  />
                ))}
            </div>
          )}
        </div>

        {/* signature */}
        <div className="mt-10">
          <div className="text-[11px] text-slate-500">
            <p>Verified &amp; authorized by:</p>
            <p className="mt-6 border-t border-slate-400 pt-1 font-semibold text-slate-800">{clinic.dentist}</p>
          </div>
        </div>

        <p className="mt-6 border-t border-slate-200 pt-2 text-center text-[9px] text-slate-400">
          Generated by Dr-Crown · This prescription is valid only with an authorized signature.
        </p>
      </div>
    </div>,
    document.body
  );
}
