import React, { useEffect, useLayoutEffect, useRef, useState, forwardRef } from "react";
import { createPortal } from "react-dom";
import { X, Printer, ReceiptText } from "lucide-react";
import { includedSummary } from "./PrescriptionForm.jsx";
import {
  fmtMoney,
  fmtDate,
  invoiceNumberFor,
  orderDateFor,
  invoiceAmount,
  billedTo,
  deriveBillingItems,
  labAddressLines,
} from "./lib/invoiceDoc.js";

/**
 * 80mm thermal receipt for one case invoice (Xprinter / ESC-POS class
 * printers, driven through the normal macOS print dialog — no ESC/POS byte
 * protocol, the driver rasterises the page).
 *
 * This is a SEPARATE document from PrintInvoice.jsx's A4 sheet, not a
 * restyling of it. The A4 sheet stays the document you email or archive as a
 * PDF; this one is the slip you tear off and staple to the case.
 *
 * Why the A4 sheet could not simply be squeezed: it declares `@page { size:
 * A4 }`, so the driver scales a 210mm-wide page down to the 80mm roll (~2.6x,
 * which renders 13px body text at ~5px) and then feeds the FULL A4 page height
 * whether or not content fills it — that is the blank paper above and below.
 *
 * The rules that keep this one honest:
 *   - the page box is exactly as tall as the content, so there is no blank
 *     roll to feed — see pageSizeRule() for why that height is MEASURED.
 *   - NOTHING in the print tree may carry a fixed height, a min-height, or
 *     vertical centring; any of those re-introduce the whitespace.
 *   - Every length is mm/pt, never px: px is a scaled unit here, mm is not.
 *   - Pure black, no grey, no fills — thermal heads render grey as mud and
 *     hairlines as gaps.
 */

/* Exported so scripts/receipt-proof.mjs renders the PDF proofs through the
   exact stylesheet that ships — a copy would drift and prove nothing. */
export const RECEIPT_CSS = `
/* ---- the receipt itself: identical on screen and on paper ------------
   Sizes are pt and mm so the driver never has to scale anything. The screen
   preview is therefore a true 80mm-wide mock-up, not an approximation. */
.receipt {
  /* content-box so content width + side padding = the page width exactly.
     Tailwind's preflight sets border-box globally, which would otherwise eat
     the padding out of the width and leave a strip of roll unused.
     width and padding come from calibrationCss() — see DEFAULT_PAPER_MM. */
  box-sizing: content-box;
  margin: 0;
  background: #fff;
  color: #000;
  /* Geeza Pro / Noto Naskh keep Arabic clinic and patient names legible at
     10pt; the Latin faces ahead of them are unaffected. */
  font-family: "Helvetica Neue", Helvetica, Arial, "Geeza Pro", "Noto Naskh Arabic", "Arial Unicode MS", sans-serif;
  font-size: 10pt;
  line-height: 1.3;
}
.receipt * { box-sizing: border-box; color: #000; }
.receipt p { margin: 0; }
/* No value may push the roll wider than 72mm. */
.receipt .v, .receipt .r-d, .receipt .r-wrap { overflow-wrap: anywhere; }

.receipt .r-head { text-align: center; padding-top: 4mm; }
.receipt .r-lab { font-size: 14pt; font-weight: 700; line-height: 1.2; }
.receipt .r-sm { font-size: 9pt; }

.receipt .r-title {
  font-size: 14pt; font-weight: 700; text-align: center;
  letter-spacing: 0.5pt; margin-top: 2.5mm;
}
.receipt .r-meta { margin-top: 1.5mm; }
.receipt .r-meta p { font-size: 10pt; }
.receipt .r-meta b { font-weight: 700; }

.receipt .r-rule { border: 0; border-top: 1px solid #000; height: 0; margin: 2.5mm 0; }
.receipt .r-dash { border: 0; border-top: 1px dashed #000; height: 0; margin: 2mm 0; }

.receipt .r-h {
  font-size: 10pt; font-weight: 700; text-transform: uppercase;
  margin-top: 2.5mm;
}
.receipt .r-h:first-child { margin-top: 0; }
.receipt .r-strong { font-weight: 700; }

.receipt .r-item { font-weight: 700; margin-top: 2.5mm; }
.receipt .r-ind { padding-left: 3mm; }
.receipt .r-d { font-size: 10pt; }
.receipt .r-d b { font-weight: 700; }

.receipt .r-trow {
  display: flex; justify-content: space-between; gap: 2mm;
  font-size: 10pt; padding: 0.6mm 0;
}
.receipt .r-trow .v { font-weight: 700; text-align: right; }
.receipt .r-total {
  display: flex; justify-content: space-between; gap: 2mm;
  font-size: 14pt; font-weight: 700;
  border-top: 1px solid #000; margin-top: 1mm; padding-top: 1.2mm;
}
/* Room to stamp and sign. This is the one deliberate fixed height in the
   sheet: it is CONTENT the lab writes into, and since the page box is
   measured from the content it lengthens the receipt rather than leaving a
   blank page behind it. */
.receipt .r-sign { margin-top: 4mm; }
.receipt .r-sign-space { height: 18mm; }
.receipt .r-sign-line { border-top: 1px solid #000; padding-top: 1mm; }
.receipt .r-sign-label { font-size: 9pt; font-weight: 700; text-transform: uppercase; }
.receipt .r-note { font-size: 9pt; margin-top: 1.5mm; }
.receipt .r-foot { font-size: 9pt; text-align: center; margin-top: 3mm; }

/* RTL hook: labels are English today, so the sheet ships LTR. If the invoice
   is ever localised, dir="rtl" on .receipt is the only switch needed. */
.receipt[dir="rtl"] .r-ind { padding-left: 0; padding-right: 3mm; }
.receipt[dir="rtl"] .r-trow .v { text-align: left; }

@media print {
  /* No @page rule here on purpose — see pageSizeRule() below. The page box
     is injected at print time because its height has to be measured. */

  html, body {
    margin: 0 !important; padding: 0 !important;
    background: #fff !important; height: auto !important; min-height: 0 !important;
  }
  /* The app shell — nav, drawers, the A4 invoice overlay if it is also
     mounted — contributes nothing but height. The portal is a direct child of
     <body>, so this leaves exactly the receipt standing. */
  body > *:not(.receipt-portal) { display: none !important; }
  #root { display: none !important; }
  .no-print { display: none !important; }

  .receipt-portal {
    position: static !important; inset: auto !important;
    display: block !important;
    overflow: visible !important; background: #fff !important;
    height: auto !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important;
  }
  /* The screen-only paper mock: no shadow, no centring margins on paper. */
  .receipt-screen-frame {
    margin: 0 !important; padding: 0 !important; width: auto !important;
    max-width: none !important; box-shadow: none !important; background: #fff !important;
  }
  /* A trailing break would emit a second, blank page. */
  .receipt > *:last-child { margin-bottom: 0 !important; page-break-after: avoid !important; }
}
`;

/* ---- the page box ----------------------------------------------------
   `@page { size: 80mm auto }` is the recipe every receipt-printing article
   gives, and it does not work: the CSS `size` property takes `auto` OR one
   or two lengths, never a length AND `auto`. Browsers reject the whole
   declaration as invalid and fall back to the default paper — US Letter,
   measured at 215.9 x 279.4mm out of Chrome — which the 80mm driver then
   scales down. That IS the original bug, so a receipt that shipped with
   `size: 80mm auto` would look fixed in code and print exactly as badly.

   The only syntax that holds the width is two explicit lengths, so the
   height is measured off the laid-out receipt and written into the rule
   just before printing. `.receipt` is deliberately styled identically on
   screen and on paper, so a screen measurement is a paper measurement.

   Verified by scripts/receipt-proof.mjs, which prints through these exact
   two functions. */
export const pageSizeRule = (widthMm, heightMm) => `@page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }`;

/* ---- calibration -----------------------------------------------------
   TEMPORARY. Thermal units disagree about where the printable area sits on
   the roll: some centre 72mm on 80mm paper, others print 72mm hard against
   the left edge, which shifts a centred layout right and clips it. That is a
   property of the physical printer, not something CSS can detect, so the
   toolbar exposes the two numbers and the correct pair gets found on paper.
   Once known, hardcode it as the default and delete the control. */
export const PAPER_WIDTHS = [72, 80, 76];
export const SIDE_MARGINS = [2, 0, 3, 4];

/* The Xprinter POS-80 driver names its papers "80(72mm) * <height>": 80mm is
   the ROLL, 72mm is the imageable width. The page box must be 72mm — an 80mm
   page is 8mm wider than the printer can image and gets clipped, and if the
   dialog is left on A4 the 72mm page is centred on a 210mm sheet, which puts
   the whole receipt 69mm to the right (that is the "off the page" symptom).
   Select "80(72mm) * <height>" in the dialog; these defaults then match it. */
/* The ONLY phone number on the receipt — the lab's own `contact` is
   deliberately not printed. NOTE: this is a single constant, so every lab on
   the platform prints this number, not their own. Move it to a lab column if
   the other four labs should show theirs. */
export const SUPPORT_PHONE = "99669234";

export const DEFAULT_PAPER_MM = 72;
export const DEFAULT_SIDE_MM = 2;

// 5mm tail so the cutter cannot clip the last line.
export const calibrationCss = (paperMm, sideMm) =>
  `.receipt { width: ${paperMm - 2 * sideMm}mm; padding: 0 ${sideMm}mm 5mm; }`;

// Height of the receipt in mm, rounded up. CSS defines 1in as exactly 96px,
// so the conversion is exact. The +1mm guards against a sub-pixel rounding
// difference between layout and pagination spilling a sliver onto a second,
// near-blank page — an overshoot is 1mm of paper, an undershoot is a bug.
export const measurePageMm = (el) => Math.ceil((el.getBoundingClientRect().height * 25.4) / 96) + 1;

// "Label: value" detail line; renders nothing when the value is empty.
function Detail({ label, value }) {
  if (value == null || value === "") return null;
  return (
    <p className="r-d">
      <b>{label}:</b> {value}
    </p>
  );
}

/**
 * The receipt markup alone — no portal, no overlay — so it can be rendered on
 * the server by the PDF proof script. Keep it free of browser-only APIs.
 */
export const ReceiptSheet = forwardRef(function ReceiptSheet(
  { caseObj, clinic, lab, dir = "ltr", now = new Date() },
  ref
) {
  const rx = caseObj.prescription;
  const items = deriveBillingItems(caseObj);
  const { cancelled, amount, discount, gross } = invoiceAmount(caseObj);
  const bill = billedTo(caseObj, clinic);
  const address = labAddressLines(lab);
  const included = includedSummary(rx)
    ? [...(rx?.included ?? []), ...(rx?.includedOther?.trim() ? [rx.includedOther.trim()] : [])].join(", ")
    : null;

  return (
    <div className="receipt" dir={dir} ref={ref}>
      {/* 1 — lab identity */}
      <div className="r-head">
        <p className="r-lab">{lab?.name ?? "Dental Laboratory"}</p>
        {address.map((line) => (
          <p key={line} className="r-sm r-wrap">{line}</p>
        ))}
        <p className="r-sm">Tel: {SUPPORT_PHONE}</p>
      </div>

      {/* 2 — invoice metadata */}
      <p className="r-title">INVOICE</p>
      <div className="r-meta">
        <p className="r-wrap"><b>Invoice #:</b> <b>{invoiceNumberFor(caseObj)}</b></p>
        <p><b>Invoice date:</b> {fmtDate(now)}</p>
        <p className="r-wrap"><b>Case ID:</b> {caseObj.id}</p>
        <p><b>Order date:</b> {fmtDate(orderDateFor(caseObj))}</p>
      </div>

      {/* 3 */}
      <hr className="r-rule" />

      {/* 4 — parties, stacked */}
      <p className="r-h">Billed to</p>
      <p className="r-strong r-wrap">{bill.name}</p>
      {bill.lines.map((l) => <p key={l} className="r-wrap">{l}</p>)}

      {/* When the patient IS the bill-to party, a second Patient block would
          just repeat the same name. */}
      {!bill.isPatient && (
        <>
          <p className="r-h">Patient</p>
          <p className="r-strong r-wrap">{caseObj.patientName}</p>
          {caseObj.patientId && <p className="r-wrap">{caseObj.patientId}</p>}
        </>
      )}

      <p className="r-h">Scheduled delivery</p>
      <p className="r-strong">{fmtDate(caseObj.appointmentDate)}</p>
      {caseObj.deliveryTime && caseObj.deliveryTime !== "Anytime" && <p>{caseObj.deliveryTime}</p>}

      {/* 5 */}
      <hr className="r-rule" />

      {/* 6 — work items */}
      <p className="r-h">Work items</p>
      {items.length === 0 && <p className="r-d">No prescription detail on file for this case.</p>}
      {items.map((it, i) => (
        <div key={i}>
          <p className="r-item r-wrap">{i + 1}. {it.title}</p>
          <div className="r-ind">
            {it.details.map((d, j) => <p key={j} className="r-d r-wrap">{d}</p>)}
          </div>
        </div>
      ))}

      {/* 7 — the lab's own line, typed on the case */}
      {caseObj.billingNote?.trim() && (
        <p className="r-d r-wrap" style={{ marginTop: "2.5mm" }}>{caseObj.billingNote.trim()}</p>
      )}
      {included && (
        <p className="r-d r-wrap" style={{ marginTop: "2.5mm" }}>
          <b>Clinical items included:</b> {included}
        </p>
      )}
      {rx?.notes && (
        <p className="r-d r-wrap" style={{ marginTop: "1.5mm" }}>
          <b>Special clinical notes:</b> {rx.notes}
        </p>
      )}

      {/* 8 */}
      <hr className="r-rule" />

      {/* 9 — money */}
      <div className="r-trow">
        <span>{cancelled ? "Cancellation fee" : "Subtotal"}</span>
        <span className="v">{gross != null ? `${fmtMoney(gross)} OMR` : "Not yet priced"}</span>
      </div>
      {discount > 0 && (
        <div className="r-trow">
          <span>Discount</span>
          <span className="v">− {fmtMoney(discount)} OMR</span>
        </div>
      )}
      <div className="r-trow">
        <span>Other fees</span>
        <span className="v">—</span>
      </div>
      <div className="r-total">
        <span>TOTAL</span>
        <span className="v">{amount != null ? `${fmtMoney(amount)} OMR` : "—"}</span>
      </div>

      {cancelled && <p className="r-note">Case cancelled — billed at the approved cancellation fee.</p>}

      {/* 10 — room for the lab's stamp and signature */}
      <div className="r-sign">
        <div className="r-sign-space" />
        <div className="r-sign-line">
          <p className="r-sign-label">Stamp &amp; signature</p>
        </div>
      </div>

      {/* 11 — nothing may follow the footer */}
      <p className="r-foot r-wrap">Generated by Dr-crown.com</p>
    </div>
  );
});

export default function PrintReceipt({ open, caseObj, clinic, lab, onClose }) {
  const sheetRef = useRef(null);
  const [pageMm, setPageMm] = useState(null);
  const [paperMm, setPaperMm] = useState(DEFAULT_PAPER_MM);
  const [sideMm, setSideMm] = useState(DEFAULT_SIDE_MM);

  // Measure the laid-out receipt so the page box can be exactly as tall as
  // its content. Re-measured once web fonts settle, since metrics move.
  useLayoutEffect(() => {
    if (!open) {
      setPageMm(null);
      return;
    }
    let live = true;
    const measure = () => {
      if (live && sheetRef.current) setPageMm(measurePageMm(sheetRef.current));
    };
    measure();
    document.fonts?.ready?.then(measure).catch(() => {});
    return () => { live = false; };
  }, [open, caseObj?.id, paperMm, sideMm]);

  // Opening the overlay fires the print dialog once, matching PrintInvoice —
  // but only after the page box is known, or the first print would be Letter.
  const firedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      firedRef.current = false;
      return;
    }
    if (firedRef.current || pageMm == null) return;
    firedRef.current = true;
    const t = setTimeout(() => window.print(), 450);
    return () => clearTimeout(t);
  }, [open, caseObj?.id, pageMm]);

  if (!open || !caseObj) return null;

  return createPortal(
    <div className="receipt-portal fixed inset-0 z-[70] overflow-y-auto bg-slate-500/60">
      <style>{RECEIPT_CSS}</style>
      <style>{calibrationCss(paperMm, sideMm)}</style>
      {pageMm != null && <style>{pageSizeRule(paperMm, pageMm)}</style>}

      <div className="no-print sticky top-0 z-10 flex items-center justify-between bg-slate-800 px-4 py-2.5 text-white">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <ReceiptText size={16} /> Receipt 80mm · {caseObj.id}
        </span>
        <div className="flex items-center gap-2">
          {/* TEMPORARY calibration — see calibrationCss(). */}
          <label className="flex items-center gap-1 text-xs font-semibold text-slate-300">
            Paper
            <select
              value={paperMm}
              onChange={(e) => setPaperMm(Number(e.target.value))}
              className="rounded bg-slate-700 px-1.5 py-1 text-xs font-semibold text-white"
            >
              {PAPER_WIDTHS.map((w) => <option key={w} value={w}>{w}mm</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs font-semibold text-slate-300">
            Margin
            <select
              value={sideMm}
              onChange={(e) => setSideMm(Number(e.target.value))}
              className="rounded bg-slate-700 px-1.5 py-1 text-xs font-semibold text-white"
            >
              {SIDE_MARGINS.map((m) => <option key={m} value={m}>{m}mm</option>)}
            </select>
          </label>
          <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold hover:bg-blue-700">
            <Printer size={15} /> Print
          </button>
          <button onClick={onClose} className="flex items-center gap-1.5 rounded-lg bg-slate-600 px-3 py-1.5 text-sm font-semibold hover:bg-slate-500">
            <X size={15} /> Close
          </button>
        </div>
      </div>

      {/* Screen-only paper mock — a true-to-size 80mm strip. */}
      <div className="receipt-screen-frame mx-auto my-6 w-max bg-white shadow-2xl">
        <ReceiptSheet ref={sheetRef} caseObj={caseObj} clinic={clinic} lab={lab} />
      </div>
    </div>,
    document.body
  );
}
