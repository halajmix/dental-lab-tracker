import { UNIVERSAL_TO_FDI, UPPER_ROW, LOWER_ROW, toothSummary, SHADE_BY_LAB } from "../PrescriptionForm.jsx";

/* ------------------------------------------------------------------ */
/*  Rx PDF builder.                                                    */
/*                                                                     */
/*  Two engines:                                                       */
/*  - VECTOR (preferred): the sheet is drawn directly with jsPDF's     */
/*    text/graphics API — crisp selectable text at any zoom, ~50kB,    */
/*    content-aware page breaks. Matches the quality of the native     */
/*    Print/Save path, which the old approach never could.             */
/*  - RASTER (fallback): the old html2canvas screenshot of the on-     */
/*    screen sheet. Kept because jsPDF's built-in fonts only cover     */
/*    Latin-1 — an Arabic patient or clinic name would render as       */
/*    garbage in vector text, while a screenshot renders any script.   */
/*    The dispatcher picks per case, automatically.                    */
/* ------------------------------------------------------------------ */

const A4W = 595.28;
const A4H = 841.89;
const M = 48; // page margin (pt)

// Palette (RGB) — mirrors the on-screen sheet's slate/blue/teal/amber.
const INK = [15, 23, 42];
const MUTED = [100, 116, 139];
const FAINT = [148, 163, 184];
const LINE = [226, 232, 240];
const UNIT = [30, 64, 175];
const VENEER = [15, 118, 110];
const PONTIC = [180, 83, 9];
const AMBER = [180, 83, 9];

// jsPDF's standard fonts encode WinAnsi (Latin-1 + common typographic
// marks). Anything outside that — Arabic in particular — must go to the
// raster engine instead of rendering as garbage.
const WINANSI_SAFE =
  /^[\t\n\r\u0020-\u00ff\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013\u2014\u2018\u2019\u201a\u201c\u201d\u201e\u2020\u2021\u2022\u2026\u2030\u2039\u203a\u20ac\u2122]*$/;

function vectorSafe(caseObj, clinic, lab) {
  const rx = caseObj.prescription ?? {};
  const restorations = rx.restorations ?? [];
  const strings = [
    clinic?.name, clinic?.address, clinic?.contact, clinic?.dentist, clinic?.governorate, clinic?.wilayat,
    lab?.name, lab?.address, lab?.contact, lab?.governorate, lab?.wilayat,
    caseObj.patientName, caseObj.patientId, caseObj.deliveryTime, rx.notes, rx.includedOther,
    ...(rx.included ?? []),
    ...(rx.files ?? []).map((f) => f.name),
    ...restorations.flatMap((r) => [r.category, r.material, r.shadeGuide, r.vitaShade, r.stumpShade, r.implantSystem, r.abutmentType, r.abutmentColor]),
    rx.category, rx.material, rx.shadeGuide, rx.vitaShade, rx.stumpShade, rx.implantSystem, rx.abutmentType, rx.abutmentColor, rx.ponticDesign, rx.abutmentDiameter,
  ];
  return strings.every((s) => s == null || WINANSI_SAFE.test(String(s)));
}

/* ---------------- shared: photo pages ---------------- */

// Fetch → data URL first so a CORS-restricted source can never taint a
// canvas; the fetch itself still needs CORS, same as the on-screen thumbs.
async function fetchImageAsDataUrl(url) {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`Failed to fetch image (${res.status})`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Failed to read image"));
    reader.readAsDataURL(blob);
  });
}

function imageNaturalSize(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = dataUrl;
  });
}

// One full dedicated A4 page per clinical/shade photo — scaled and centered
// preserving aspect ratio, so the lab can inspect each at size.
async function appendPhotoPages(pdf, photos) {
  const CAPTION_H = 22;
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    try {
      const dataUrl = await fetchImageAsDataUrl(photo.url);
      const { width: iw, height: ih } = await imageNaturalSize(dataUrl);
      const maxW = A4W - M * 2;
      const maxH = A4H - M * 2 - CAPTION_H;
      const scale = Math.min(maxW / iw, maxH / ih);
      const drawW = iw * scale;
      const drawH = ih * scale;
      const x = (A4W - drawW) / 2;
      const y = M + CAPTION_H + (maxH - drawH) / 2;
      const format = dataUrl.match(/^data:image\/(\w+);/)?.[1]?.toUpperCase().replace("JPG", "JPEG") || "JPEG";

      pdf.addPage();
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(...MUTED);
      pdf.text(`Photo ${i + 1} of ${photos.length}${photo.name ? ` — ${photo.name}` : ""}`, M, M);
      pdf.addImage(dataUrl, format, x, y, drawW, drawH);
    } catch (err) {
      // One bad photo shouldn't sink the whole PDF — skip its page.
      console.error("Failed to add photo page to PDF", photo.name, err);
    }
  }
}

/* ---------------- raster fallback (old engine) ---------------- */

async function rasterPdf(el, photos) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false });
  const imgData = canvas.toDataURL("image/jpeg", 0.95);
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const imgH = (canvas.height * A4W) / canvas.width;
  let heightLeft = imgH;
  let position = 0;
  pdf.addImage(imgData, "JPEG", 0, position, A4W, imgH);
  heightLeft -= A4H;
  while (heightLeft > 0) {
    position -= A4H;
    pdf.addPage();
    pdf.addImage(imgData, "JPEG", 0, position, A4W, imgH);
    heightLeft -= A4H;
  }
  await appendPhotoPages(pdf, photos);
  return pdf;
}

/* ---------------- vector engine ---------------- */

const shadeLine = (guide, shade) =>
  guide === SHADE_BY_LAB ? "Determined by lab" : shade && shade !== "N/A" && shade !== "Refer to notes" ? `${shade}${guide && guide !== "N/A" ? ` (${guide})` : ""}` : null;

async function vectorPdf(caseObj, clinic, lab, photos) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const rx = caseObj.prescription ?? {};
  const contentW = A4W - M * 2;
  let y = M;

  const ensure = (need) => {
    if (y + need > A4H - M) {
      pdf.addPage();
      y = M;
    }
  };
  const font = (size, style = "normal", color = INK) => {
    pdf.setFont("helvetica", style);
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
  };
  const label = (txt) => {
    font(7.5, "bold", FAINT);
    pdf.text(txt.toUpperCase(), M, y, { baseline: "top" });
    y += 12;
  };
  const wrapped = (txt, size, color, style = "normal", width = contentW) => {
    font(size, style, color);
    const lines = pdf.splitTextToSize(txt, width);
    for (const ln of lines) {
      ensure(size + 4);
      pdf.text(ln, M, y, { baseline: "top" });
      y += size + 3;
    }
  };

  /* header */
  font(17, "bold");
  pdf.text(clinic?.name ?? "Clinic", M, y, { baseline: "top" });
  const clinicLoc = [clinic?.wilayat, clinic?.governorate].filter(Boolean).join(", ") || clinic?.address || "";
  let leftY = y + 20;
  font(8.5, "normal", MUTED);
  if (clinicLoc) {
    pdf.text(clinicLoc, M, leftY, { baseline: "top" });
    leftY += 11;
  }
  if (clinic?.contact) {
    pdf.text(clinic.contact, M, leftY, { baseline: "top" });
    leftY += 11;
  }
  font(10, "bold", INK);
  pdf.text("LABORATORY PRESCRIPTION", A4W - M, y, { baseline: "top", align: "right" });
  font(8.5, "normal", MUTED);
  pdf.text(`Date: ${new Date().toISOString().slice(0, 10)}`, A4W - M, y + 14, { baseline: "top", align: "right" });
  if (clinic?.dentist) {
    font(9, "bold", INK);
    pdf.text(clinic.dentist, A4W - M, y + 26, { baseline: "top", align: "right" });
  }
  y = Math.max(leftY, y + 40) + 4;
  pdf.setDrawColor(...INK);
  pdf.setLineWidth(1.4);
  pdf.line(M, y, A4W - M, y);
  y += 10;

  /* case meta strip */
  font(8.5, "normal", MUTED);
  pdf.text(`Case ${caseObj.id}`, M, y, { baseline: "top" });
  if (rx.rush) {
    font(8.5, "bold", AMBER);
    pdf.text("EXPRESS ORDER", A4W - M, y, { baseline: "top", align: "right" });
  }
  y += 20;

  /* two columns: lab | patient */
  const colW = (contentW - 20) / 2;
  const rightX = M + colW + 20;
  const colTop = y;
  font(7.5, "bold", FAINT);
  pdf.text("TARGET LABORATORY", M, y, { baseline: "top" });
  pdf.text("PATIENT", rightX, y, { baseline: "top" });
  y += 12;
  font(11, "bold", INK);
  pdf.text(lab?.name ?? "—", M, y, { baseline: "top" });
  pdf.text(caseObj.patientName ?? "—", rightX, y, { baseline: "top" });
  y += 14;
  let ly = y;
  font(8.5, "normal", MUTED);
  const labLoc = [lab?.wilayat, lab?.governorate].filter(Boolean).join(", ") || lab?.address || "";
  if (labLoc) {
    pdf.text(labLoc, M, ly, { baseline: "top" });
    ly += 11;
  }
  if (lab?.contact) {
    pdf.text(String(lab.contact), M, ly, { baseline: "top" });
    ly += 11;
  }
  let py = y;
  if (caseObj.patientId && caseObj.patientId !== "PT-NEW") {
    pdf.text(`ID: ${caseObj.patientId}`, rightX, py, { baseline: "top" });
    py += 11;
  }
  const deliver = `Deliver by: ${caseObj.appointmentDate ?? "—"}${caseObj.deliveryTime && caseObj.deliveryTime !== "Anytime" ? ` · ${caseObj.deliveryTime}` : ""}`;
  pdf.text(deliver, rightX, py, { baseline: "top" });
  py += 11;
  if (caseObj.patientPhone) {
    pdf.text(`WhatsApp: ${caseObj.patientPhone}`, rightX, py, { baseline: "top" });
    py += 11;
  }
  y = Math.max(ly, py, colTop + 40) + 8;

  /* included */
  const includedItems = [...(rx.included ?? []), ...(rx.includedOther?.trim() ? [rx.includedOther.trim()] : [])];
  if (includedItems.length) {
    ensure(30);
    label("Included with the case");
    wrapped(includedItems.join("  ·  "), 8.5, INK);
    y += 6;
  }

  /* tooth diagram */
  const teeth = rx.restorations?.length ? rx.restorations.flatMap((r) => r.teeth ?? []) : rx.teeth ?? [];
  if (teeth.length) {
    ensure(96);
    label("Tooth selection");
    const roleOf = {};
    teeth.forEach((t) => (roleOf[t.universal] = t.role));
    const BOX = 24;
    const GAP = 3;
    const rowW = 16 * BOX + 15 * GAP;
    const x0 = M + (contentW - rowW) / 2;
    const notation = rx.notation ?? "FDI";
    const drawRow = (rowTeeth, rowY) => {
      rowTeeth.forEach((u, i) => {
        const x = x0 + i * (BOX + GAP);
        const role = roleOf[u];
        const fill = role === "unit" ? UNIT : role === "veneer" ? VENEER : role === "pontic" ? PONTIC : null;
        if (role === "pontic") pdf.setLineDashPattern([2, 1.5], 0);
        else pdf.setLineDashPattern([], 0);
        if (fill) {
          pdf.setFillColor(...fill);
          pdf.setDrawColor(...fill);
          pdf.roundedRect(x, rowY, BOX, 20, 3, 3, "FD");
        } else {
          pdf.setFillColor(255, 255, 255);
          pdf.setDrawColor(203, 213, 225);
          pdf.roundedRect(x, rowY, BOX, 20, 3, 3, "FD");
        }
        font(7, "bold", fill ? [255, 255, 255] : [71, 85, 105]);
        pdf.text(String(notation === "FDI" ? UNIVERSAL_TO_FDI[u] : u), x + BOX / 2, rowY + 10, { align: "center", baseline: "middle" });
      });
      pdf.setLineDashPattern([], 0);
    };
    drawRow(UPPER_ROW, y);
    font(6.5, "normal", FAINT);
    pdf.text("— occlusal midline —", A4W / 2, y + 26, { align: "center", baseline: "middle" });
    drawRow(LOWER_ROW, y + 32);
    y += 58;
    const summary = toothSummary({ teeth, notation });
    if (summary) {
      font(8, "normal", MUTED);
      pdf.text(`${notation} notation · Restored: ${summary}`, A4W / 2, y, { align: "center", baseline: "top" });
      y += 14;
    }
    y += 4;
  }

  /* specs — one bordered block per restoration (or one legacy block) */
  const specBlocks = rx.restorations?.length
    ? rx.restorations.map((r, i) => ({ title: `Restoration ${i + 1} of ${rx.restorations.length} — ${r.category ?? "—"}`, teeth: toothSummary({ teeth: r.teeth, notation: rx.notation }), r }))
    : rx.category
    ? [{ title: rx.category, teeth: toothSummary(rx), r: rx }]
    : [];

  for (const block of specBlocks) {
    const { r } = block;
    const rows = [
      ["Material", r.material && r.material !== "Refer to notes" ? r.material : null],
      ["Shade", shadeLine(r.shadeGuide, r.vitaShade)],
      ["Stump shade", r.stumpShade && r.stumpShade !== "N/A" && r.stumpShade !== "Refer to notes" ? r.stumpShade : null],
      ["Implant brand", r.implantSystem || null],
      ["Abutment size", r.abutmentType || null],
      ["Colour code", r.abutmentColor || null],
      // legacy-only fields, still shown for pre-existing cases
      ["Pontic design", r.ponticDesign || null],
      ["Abutment Ø", r.abutmentDiameter || null],
    ].filter(([, v]) => v);
    const boxH = 26 + rows.length * 13 + 6;
    ensure(boxH + 8);
    pdf.setDrawColor(...LINE);
    pdf.setLineWidth(0.8);
    pdf.roundedRect(M, y, contentW, boxH, 5, 5, "S");
    font(9.5, "bold", INK);
    pdf.text(block.title, M + 10, y + 9, { baseline: "top" });
    if (block.teeth) {
      font(8, "normal", MUTED);
      pdf.text(block.teeth, A4W - M - 10, y + 10, { baseline: "top", align: "right" });
    }
    let ry = y + 26;
    for (const [k, v] of rows) {
      font(8, "normal", MUTED);
      pdf.text(k, M + 10, ry, { baseline: "top" });
      font(8.5, "bold", INK);
      pdf.text(String(v), M + 110, ry, { baseline: "top" });
      ry += 13;
    }
    y += boxH + 8;
  }

  /* notes + attachments */
  if (rx.notes?.trim()) {
    ensure(30);
    label("Special instructions");
    wrapped(rx.notes.trim(), 8.5, INK);
    y += 4;
  }
  const scans = (rx.files ?? []).filter((f) => f.kind === "scan");
  if (scans.length || photos.length) {
    ensure(24);
    const parts = [];
    if (scans.length) parts.push(`${scans.length} STL scan${scans.length > 1 ? "s" : ""}: ${scans.map((f) => f.name).join(", ")}`);
    if (photos.length) parts.push(`${photos.length} photo${photos.length > 1 ? "s" : ""} — full size on the following page${photos.length > 1 ? "s" : ""}`);
    label("Attachments");
    wrapped(parts.join("  ·  "), 8, MUTED);
  }

  /* signature */
  ensure(64);
  y += 18;
  font(8, "normal", MUTED);
  pdf.text("Verified & authorized by:", M, y, { baseline: "top" });
  pdf.setDrawColor(...FAINT);
  pdf.setLineWidth(0.8);
  pdf.line(M, y + 26, M + 190, y + 26);
  font(9, "bold", INK);
  pdf.text(clinic?.dentist ?? "", M, y + 30, { baseline: "top" });

  /* footer */
  font(6.5, "normal", FAINT);
  pdf.text("Generated by Dr-Crown · dr-crown.com", A4W / 2, A4H - 24, { align: "center" });

  await appendPhotoPages(pdf, photos);
  return pdf;
}

/* ---------------- dispatcher ---------------- */

export async function buildRxPdf(sheetEl, caseObj, clinic, lab, filename) {
  const photos = (caseObj.prescription?.files ?? []).filter((f) => f.kind === "photo" && f.url);
  let pdf;
  if (vectorSafe(caseObj, clinic, lab)) {
    try {
      pdf = await vectorPdf(caseObj, clinic, lab, photos);
    } catch (err) {
      console.error("Vector PDF failed, falling back to raster", err);
      pdf = null;
    }
  }
  if (!pdf) {
    if (!sheetEl) throw new Error("Nothing to render the PDF from");
    pdf = await rasterPdf(sheetEl, photos);
  }
  const blob = pdf.output("blob");
  return new File([blob], filename, { type: "application/pdf" });
}
