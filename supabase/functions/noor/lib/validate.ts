import type { CaseRow, Issue, Prescription, Restoration } from "./types.ts";

/* Deterministic intake check. No model. Mirrors the option lists in
   src/PrescriptionForm.jsx; keep the two in step when a category is added. */

export const CATEGORY_MATERIALS: Record<string, string[]> = {
  "Crown - tooth": ["Zirconia", "E.max", "PFM", "PMMA", "Full metal"],
  "Crown - implant": ["Zirconia", "E.max", "PFM", "PMMA"],
  "Bridge - tooth (conventional)": ["Zirconia", "E.max", "PFM", "PMMA", "Full metal"],
  "Bridge - tooth (Resin Bonded)": ["Zirconia", "E.max", "PFM"],
  "Bridge - implant": ["Zirconia", "E.max", "PFM", "PMMA", "Zirconia with metal bar"],
  "Veneer": ["E.max", "Feldspathic", "Composite"],
  "Removable partial denture": ["Acrylic", "Cobalt-chrome framework", "Flexible (Nylon / Valplast)"],
  "Complete denture": ["Acrylic Complete Denture", "Acrylic Overdenture", "Immediate Denture", "Flexible (Nylon / Valplast)"],
  "Orthodontics splint": [], "Single layer splint - soft": [], "Double layer splint - soft": [],
  "Double layer splint - outer hard, inner soft": [], "Michigan splint": [], "Clear retainer": [],
  "Night guard": [], "Fixed retainer": [], "Study model": [], "Special tray": [],
  "Others - refer to notes": ["Refer to notes"],
};
export const SHADED_CATEGORIES = new Set(["Crown - tooth", "Crown - implant", "Bridge - tooth (conventional)", "Bridge - tooth (Resin Bonded)", "Bridge - implant", "Veneer", "Removable partial denture", "Complete denture"]);
export const ARCH_CATEGORIES = new Set(["Removable partial denture", "Complete denture", "Orthodontics splint", "Single layer splint - soft", "Double layer splint - soft", "Double layer splint - outer hard, inner soft", "Michigan splint", "Clear retainer", "Night guard", "Study model", "Special tray"]);
export const SHADE_GUIDES: Record<string, string[]> = {
  "Vita Classical": ["A1", "A2", "A3", "A3.5", "A4", "B1", "B2", "B3", "B4", "C1", "C2", "C3", "C4", "D2", "D3", "D4"],
  "Vita 3D-Master": [], "Ivoclar Chromascop": [], "Bleach/Whitening": ["BL1", "BL2", "BL3", "BL4"], "Custom/Photo": [],
};
export const SHADE_BY_LAB = "Shade by Lab";
const IMPRESSION_ITEMS = ["Upper impression", "Lower impression"];
const FIELD_ORDER: Issue["field"][] = ["teeth", "notation", "category", "material", "shade_guide", "shade", "impression_or_scan", "due_date", "notes_conflict"];

const restorationsOf = (rx: Prescription): Restoration[] =>
  rx.restorations?.length ? rx.restorations : rx.category ? [{ category: rx.category, material: rx.material, shadeGuide: rx.shadeGuide, vitaShade: rx.vitaShade, arches: rx.arches, teeth: rx.teeth }] : [];

const shadeCodeRe = /\b(A[1-4](?:\.5)?|B[1-4]|C[1-4]|D[2-4]|BL[1-4]|[0-5]M[1-3])\b/gi;
const toothRe = /\b([1-4][1-8])\b/g;
const materialWords = ["Zirconia", "E.max", "PFM", "PMMA", "Feldspathic", "Composite", "Acrylic"];

export function validatePrescription(row: Pick<CaseRow, "prescription" | "appointment_date" | "lab_shade">): Issue[] {
  const rx = row.prescription ?? {};
  const issues: Issue[] = [];
  const items = restorationsOf(rx);
  const push = (i: Issue) => issues.push(i);

  items.forEach((r, idx) => {
    const cat = r.category ?? "";
    const known = cat in CATEGORY_MATERIALS;
    const archMode = ARCH_CATEGORIES.has(cat) || !!r.arches;
    if (!cat) push({ field: "category", restoration_index: idx, severity: "blocking", detail: `Restoration ${idx + 1}: no restoration type` });
    else if (!known) push({ field: "category", restoration_index: idx, severity: "warning", detail: `Restoration ${idx + 1}: unknown type "${cat}"` });

    if (!archMode) {
      if (!r.teeth?.length) push({ field: "teeth", restoration_index: idx, severity: "blocking", detail: `${cat || `Restoration ${idx + 1}`}: no teeth selected` });
      else if (rx.notation === "FDI" && r.teeth.some((t) => t.fdi == null) && r.teeth.some((t) => t.universal != null))
        push({ field: "notation", restoration_index: idx, severity: "blocking", detail: `${cat}: notation is FDI but teeth carry only Universal numbers` });
      else if (rx.notation === "Universal" && r.teeth.some((t) => t.universal == null) && r.teeth.some((t) => t.fdi != null))
        push({ field: "notation", restoration_index: idx, severity: "blocking", detail: `${cat}: notation is Universal but teeth carry only FDI numbers` });
    }

    const mats = CATEGORY_MATERIALS[cat] ?? [];
    if (known && mats.length && !r.material)
      push({ field: "material", restoration_index: idx, severity: "blocking", detail: `${cat}: material not chosen (options: ${mats.slice(0, 4).join(", ")})` });

    if (SHADED_CATEGORIES.has(cat)) {
      const teethTxt = (r.teeth ?? []).map((t) => t.fdi ?? t.universal).filter(Boolean).join(", ") || r.arches || "";
      if (!r.shadeGuide) push({ field: "shade_guide", restoration_index: idx, severity: "blocking", detail: `${cat}${teethTxt ? ` (${teethTxt})` : ""}: no shade guide selected` });
      else if (r.shadeGuide !== SHADE_BY_LAB) {
        if (!r.vitaShade || r.vitaShade === "N/A")
          push({ field: "shade", restoration_index: idx, severity: "blocking", detail: `${cat}, ${r.material ?? "material unset"}, tooth ${teethTxt || "?"}: shade_guide '${r.shadeGuide}' set but shade is empty` });
        else if ((SHADE_GUIDES[r.shadeGuide] ?? []).length && !SHADE_GUIDES[r.shadeGuide].includes(r.vitaShade))
          push({ field: "shade", restoration_index: idx, severity: "warning", detail: `${cat}: shade '${r.vitaShade}' is not a ${r.shadeGuide} shade` });
      }
    }
  });

  const hasScan = (rx.files ?? []).some((f) => f.kind === "scan");
  const hasImpression = (rx.included ?? []).some((x) => IMPRESSION_ITEMS.includes(x));
  if (items.length && !hasScan && !hasImpression)
    push({ field: "impression_or_scan", severity: "blocking", detail: "No digital scan attached and no impression listed under included items" });

  if (row.appointment_date && rx.estReady && row.appointment_date < rx.estReady)
    push({ field: "due_date", severity: "blocking", detail: `Next appointment ${row.appointment_date} is before the lab's promise date ${rx.estReady}` });

  const notes = (rx.notes ?? "").trim();
  if (notes) {
    const fieldShades = new Set(items.map((r) => (r.vitaShade ?? "").toUpperCase()).filter(Boolean));
    for (const m of notes.matchAll(shadeCodeRe)) {
      const code = m[1].toUpperCase();
      if (fieldShades.size && !fieldShades.has(code))
        push({ field: "notes_conflict", severity: "warning", detail: `Notes mention shade ${code} but the prescription says ${[...fieldShades].join("/")}` });
    }
    if (!ARCH_CATEGORIES.has(items[0]?.category ?? "") && rx.notation !== "Universal") {
      const fieldTeeth = new Set(items.flatMap((r) => (r.teeth ?? []).map((t) => String(t.fdi ?? ""))));
      for (const m of notes.matchAll(toothRe)) {
        if (fieldTeeth.size && !fieldTeeth.has(m[1]))
          push({ field: "notes_conflict", severity: "warning", detail: `Notes mention tooth ${m[1]}, which is not on the chart (${[...fieldTeeth].join(", ")})` });
      }
    }
    const fieldMats = new Set(items.map((r) => (r.material ?? "").toLowerCase()).filter(Boolean));
    for (const w of materialWords) {
      if (new RegExp(`\\b${w.replace(".", "\\.")}\\b`, "i").test(notes) && fieldMats.size && ![...fieldMats].some((fm) => fm.includes(w.toLowerCase())))
        push({ field: "notes_conflict", severity: "warning", detail: `Notes mention ${w} but the material field says ${[...fieldMats].join("/")}` });
    }
  }

  const uniq = new Map<string, Issue>();
  for (const i of issues) uniq.set(`${i.field}|${i.restoration_index ?? ""}|${i.detail}`, i);
  return [...uniq.values()].sort((a, b) =>
    FIELD_ORDER.indexOf(a.field) - FIELD_ORDER.indexOf(b.field) || (a.severity === b.severity ? 0 : a.severity === "blocking" ? -1 : 1));
}

/** The one question Noor asks is about the first blocking issue (else first warning). */
export const primaryIssue = (issues: Issue[]): Issue | null => issues.find((i) => i.severity === "blocking") ?? issues[0] ?? null;
