import React, { useMemo, useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Check,
  FileText,
  Upload,
  Image as ImageIcon,
  Trash2,
  Calendar,
  Building2,
  Layers,
  Palette,
  AlertTriangle,
  Info,
  Sparkles,
  Clock,
  ScanLine,
  MessageCircle,
  PackageCheck,
  ChevronDown,
  Plus,
  Loader2,
  RotateCcw,
  Pencil,
  Layers3,
  Banknote,
  Truck,
  MapPin,
  Search,
  Smartphone,
} from "lucide-react";
import { uploadCasePhoto, classifyRxFile, scanPickerAccept, isMobileDevice, estimateCasePrice, fetchMyRxDraft, saveRxDraft, deleteRxDraft } from "./lib/data.js";

// Phase 61: STL exports dwarf photos — 50 MB cap, enforced here and by
// the bucket itself.
const SCAN_MAX_BYTES = 50 * 1024 * 1024;
import { SectionBoundary } from "./ErrorBoundary.jsx";
import { SignedImage } from "./lib/storageUrl.jsx";
import MobilePhotoQR from "./MobilePhotoQR.jsx";

/* ================================================================== */
/*  Reference data — clinical dictionaries                            */
/* ================================================================== */

// Universal (1–32) → FDI (ISO 3950) two-digit notation.
export const UNIVERSAL_TO_FDI = {
  1: 18, 2: 17, 3: 16, 4: 15, 5: 14, 6: 13, 7: 12, 8: 11,
  9: 21, 10: 22, 11: 23, 12: 24, 13: 25, 14: 26, 15: 27, 16: 28,
  17: 38, 18: 37, 19: 36, 20: 35, 21: 34, 22: 33, 23: 32, 24: 31,
  25: 41, 26: 42, 27: 43, 28: 44, 29: 45, 30: 46, 31: 47, 32: 48,
};

// Chart layout: teeth left→right as viewed (patient right on the left).
export const UPPER_ROW = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
export const LOWER_ROW = [32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17];

const toothType = (u) => {
  const d = UNIVERSAL_TO_FDI[u] % 10;
  if (d <= 2) return "incisor";
  if (d === 3) return "canine";
  if (d <= 5) return "premolar";
  return "molar";
};

const label = (u, notation) => (notation === "FDI" ? UNIVERSAL_TO_FDI[u] : u);

// Restoration categories → material / specification menus.
const CATEGORIES = {
  "Crown - tooth": {
    materials: [
      "Monolithic Zirconia",
      "Layered Zirconia",
      "Lithium Disilicate (E.max)",
      "PFM (Porcelain-Fused-to-Metal)",
      "Full Gold / Precious",
      "Feldspathic Porcelain",
      "PMMA Provisional",
    ],
  },
  "Crown - implant": {
    materials: ["Zirconia", "E.max", "PFM", "PMMA"],
  },
  "Bridge - tooth (conventional)": {
    materials: [
      "Monolithic Zirconia",
      "Layered Zirconia",
      "Lithium Disilicate (E.max)",
      "PFM (Porcelain-Fused-to-Metal)",
      "Full Gold / Precious",
      "PMMA Provisional",
    ],
  },
  "Bridge - tooth (Resin Bonded)": {
    materials: [
      "Monolithic Zirconia",
      "Lithium Disilicate (E.max)",
      "PFM (metal wing)",
      "Cast Metal Wing",
    ],
  },
  "Bridge - implant": {
    materials: ["Zirconia", "E.max", "PFM", "PMMA", "Zirconia with metal bar"],
  },
  Veneer: {
    materials: [
      "Lithium Disilicate (E.max)",
      "Feldspathic Porcelain",
      "Layered Zirconia",
      "Composite",
      "PMMA Provisional",
    ],
  },
  "Removable partial denture": {
    materials: [
      "Cobalt-Chrome RPD Framework",
      "Removable Partial Denture - Acrylic (with clasps)",
      "Removable Partial Denture - Acrylic (no clasps)",
      "Flexible Partial (Nylon / Valplast)",
      "Cast Metal Partial",
      "Immediate Denture",
    ],
  },
  // Split from Removable denture (2026-08-22): partials are priced per tooth
  // (first tooth in the base, + fee per additional), complete dentures per
  // ARCH (single vs both) — two different price models need two categories.
  "Complete denture": {
    materials: ["Acrylic Complete Denture", "Acrylic Overdenture", "Immediate Denture", "Flexible (Nylon / Valplast)"],
  },
  "Orthodontics splint": { materials: [] },
  "Single layer splint - soft": { materials: [] },
  "Double layer splint - soft": { materials: [] },
  "Double layer splint - outer hard, inner soft": { materials: [] },
  "Michigan splint": { materials: [] },
  // Arch-based appliances (2026-08-21): ordered per arch — upper, lower, or
  // both — with per-arch pricing on the lab side. No material/shade fields.
  "Clear retainer": { materials: [] },
  "Night guard": { materials: [] },
  "Fixed retainer": { materials: [] },
  "Study model": { materials: [] },
  "Special tray": { materials: [] },
  "Others - refer to notes": { materials: ["Refer to notes"] },
};

// Appliances made per dental arch: the dentist picks Upper / Lower / Both and
// the lab prices a single arch vs both arches separately (schema Phase 45).
// The partial denture included — a complete denture is upper, lower, or both.
export const ARCH_CATEGORIES = [
  "Removable partial denture",
  "Complete denture",
  "Clear retainer",
  "Night guard",
  "Fixed retainer",
  "Study model",
  "Special tray",
];
export const ARCH_LABELS = { upper: "Upper arch", lower: "Lower arch", both: "Both arches" };

// Bridges always carry a pontic, so pontic design is always shown for these.
const BRIDGE_CATEGORIES = [
  "Bridge - tooth (conventional)",
  "Bridge - tooth (Resin Bonded)",
  "Bridge - implant",
];
// Only natural-tooth preps have a die → a stump shade (implants do not).
// Veneers included: they are thin and translucent, so the prep colour shows through.
const HAS_STUMP = [
  "Crown - tooth",
  "Bridge - tooth (conventional)",
  "Bridge - tooth (Resin Bonded)",
  "Veneer",
];
// Clear/acrylic appliances → no material menu, no tooth shade or shade guide.
// The arch-based appliances behave the same way in the form (the denture is
// the exception: it keeps its material menu, so it's not in this list).
const SPLINT_CATEGORIES = [
  "Orthodontics splint",
  "Single layer splint - soft",
  "Double layer splint - soft",
  "Double layer splint - outer hard, inner soft",
  "Michigan splint",
  "Clear retainer",
  "Night guard",
  "Fixed retainer",
  "Study model",
  "Special tray",
];
// Exported: the lab-side Settings uses this same list so per-procedure
// turnaround times always stay in sync with the Rx form's categories.
export const CATEGORY_NAMES = Object.keys(CATEGORIES);

// Categories that decompose into independent per-tooth restorations, so a
// case can hold several of them (a crown here, a veneer there, each its own
// material/shade/spec) — the "cart" in Step 2. Everything else is a whole-
// case appliance (a denture or splint isn't tied to specific teeth the same
// way) and stays exactly one item per case, using the form's original
// single-item fields untouched.
const RESTORATION_CATEGORIES = [
  "Crown - tooth",
  "Crown - implant",
  "Bridge - tooth (conventional)",
  "Bridge - tooth (Resin Bonded)",
  "Bridge - implant",
  "Veneer",
];
const APPLIANCE_CATEGORIES = CATEGORY_NAMES.filter((c) => !RESTORATION_CATEGORIES.includes(c));

// A tooth's role is implied by its restoration's category for everything
// except bridges — a Crown is always "unit", a Veneer is always "veneer",
// so there's no need to ask the dentist to also pick a chart mode for those.
// Only a bridge genuinely needs a per-tooth choice (which teeth are the
// abutments vs the pontic span), so that's the only category that shows a
// mode toggle on the restoration-cart chart.
const IMPLICIT_ROLE = { "Crown - tooth": "unit", "Crown - implant": "unit", Veneer: "veneer" };
const roleForDraftTooth = (category, chartMode) =>
  BRIDGE_CATEGORIES.includes(category) ? chartMode : IMPLICIT_ROLE[category] ?? "unit";

// When the category changes, re-stamp every already-selected tooth with
// the role that now makes sense — e.g. leaving a bridge category drops any
// "pontic" markings (a lone crown/veneer can't have a pontic), while moving
// between two bridge categories (tooth-supported <-> implant-supported)
// keeps the abutment/pontic split the dentist already set.
const remapSelectionForCategory = (selection, category) => {
  const isBridge = BRIDGE_CATEGORIES.includes(category);
  const implicit = IMPLICIT_ROLE[category] ?? "unit";
  return Object.fromEntries(
    Object.entries(selection).map(([u, role]) => [u, isBridge ? (role === "pontic" ? "pontic" : "unit") : implicit])
  );
};

// Shade guides (systems) → their shade tabs. The form picks a guide, then a shade.
const SHADE_GUIDES = {
  "Vita Classical": ["A1", "A2", "A3", "A3.5", "A4", "B1", "B2", "B3", "B4", "C1", "C2", "C3", "C4", "D2", "D3", "D4"],
  "Vita 3D-Master": [
    "0M1", "0M2", "0M3", "1M1", "1M2", "2L1.5", "2L2.5", "2M1", "2M2", "2M3", "2R1.5", "2R2.5",
    "3L1.5", "3L2.5", "3M1", "3M2", "3M3", "3R1.5", "3R2.5", "4L1.5", "4L2.5", "4M1", "4M2", "4M3",
    "4R1.5", "4R2.5", "5M1", "5M2", "5M3",
  ],
  "Ivoclar Chromascop": [
    "110", "120", "130", "140", "210", "220", "230", "240", "310", "320", "330", "340",
    "410", "420", "430", "440", "510", "520", "530", "540",
  ],
  "Bleach / Whitening": ["BL1", "BL2", "BL3", "BL4"],
  "Custom / Photo": ["Custom (see photo)"],
};
// A dedicated "guide" that isn't really a guide — picking it means the
// dentist isn't specifying a shade at all, the lab decides it (e.g. from
// photos/notes). Collapses the Shade dropdown entirely rather than listing
// values for it, so it has no entry in SHADE_GUIDES itself.
export const SHADE_BY_LAB = "Shade by Lab";
const SHADE_GUIDE_NAMES = [SHADE_BY_LAB, ...Object.keys(SHADE_GUIDES)];

const STUMP_SHADES = ["N/A", "ND1", "ND2", "ND3", "ND4", "ND5", "ND6", "ND7", "ND8", "ND9"];


// When the category is "Others - refer to notes", spec fields collapse to this.
const REFER = "Refer to notes";
const REFER_CATEGORY = "Others - refer to notes";

// Preferred time of day for the lab to deliver back to the clinic.
const DELIVERY_TIMES = ["Anytime", "Morning", "Afternoon", "Before sunset", "Evening"];

// Implant cases: the lab cannot order components without the system + platform.
const IMPLANT_CATEGORIES = ["Crown - implant", "Bridge - implant"];
const IMPLANT_SYSTEMS = [
  "Straumann",
  "Nobel Biocare",
  "Astra Tech / Dentsply",
  "Osstem",
  "MIS",
  "Dentium",
  "MegaGen",
  "Zimmer Biomet",
  "BioHorizons",
  "Neodent",
  "Implant Direct",
  "Bio3",
  "SPI (Thommen Medical)",
  "Other — see notes",
];
const ABUTMENT_TYPES = [
  "Stock / Straight",
  "Stock / Angled",
  "Custom CAD-CAM",
  "Ti-Base",
  "Multi-unit",
  "Locator / Overdenture",
];
// Translucent / tooth-coloured materials where the underlying prep colour shows
// through — these are the only ones that need a stump shade.
const AESTHETIC_MATERIALS = [
  "Monolithic Zirconia",
  "Layered Zirconia",
  "Lithium Disilicate (E.max)",
  "Feldspathic Porcelain",
  "Composite",
];

// Quick-select tooth groups (Universal numbers).
const TOOTH_GROUPS = [
  { label: "Max. Anterior", teeth: [6, 7, 8, 9, 10, 11] },
  { label: "Max. Posterior", teeth: [1, 2, 3, 4, 5, 12, 13, 14, 15, 16] },
  { label: "Max. Molars", teeth: [1, 2, 3, 14, 15, 16] },
  { label: "Mand. Anterior", teeth: [22, 23, 24, 25, 26, 27] },
  { label: "Mand. Posterior", teeth: [17, 18, 19, 20, 21, 28, 29, 30, 31, 32] },
  { label: "Mand. Molars", teeth: [17, 18, 19, 30, 31, 32] },
];

// Physical items sent to the lab alongside the case.
const INCLUDED_ITEMS = [
  "Upper impression",
  "Lower impression",
  "Bite registration",
  "Wax rims",
  "Verification jig",
  "Shade photos",
  "Study model / cast",
  "Previous prosthesis",
];

// Human summary of what was sent with the case (used on cards + printout).
export function includedSummary(prescription) {
  const inc = prescription?.included ?? [];
  const other = prescription?.includedOther?.trim();
  return [...inc, ...(other ? [other] : [])].join(", ");
}

/* ================================================================== */
/*  Utilities                                                          */
/* ================================================================== */

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};
const iso = (d) => d.toISOString().slice(0, 10);
const fmtSize = (b) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

// Build a compact human summary of the selection, grouped by arch.
export function toothSummary(prescription) {
  if (!prescription?.teeth?.length) return "";
  const n = prescription.notation;
  const suffix = { pontic: "(p)", veneer: "(v)" };
  const parts = prescription.teeth.map(
    (t) => `${n === "FDI" ? t.fdi : t.universal}${suffix[t.role] ?? ""}`
  );
  return parts.join(", ");
}

/* ================================================================== */
/*  Interactive Tooth Chart                                            */
/* ================================================================== */

// Larger touch targets for chairside use (was 30/37).
const TOOTH_W = 38;
const STEP = 45;
const MARGIN_X = 26;
const MIDGAP = 22;
const colX = (i) => MARGIN_X + i * STEP + (i >= 8 ? MIDGAP : 0);
const CHART_W = colX(15) + TOOTH_W + MARGIN_X;

// Default toolbar for the case-level (appliance-mode) chart, unchanged.
// The restoration-cart editor passes its own `modes` — a 2-way
// Abutment/Pontic toggle for bridges, or an empty array (hidden toolbar,
// tapping a tooth just uses the role implied by the restoration's category)
// for everything else, since the category already says what a tooth is.
const DEFAULT_TOOTH_MODES = [
  { k: "unit", txt: "Unit / Crown", on: "bg-blue-600 text-white", swatch: "bg-blue-600" },
  { k: "veneer", txt: "Veneer", on: "bg-teal-600 text-white", swatch: "bg-teal-600" },
  { k: "pontic", txt: "Pontic", on: "bg-amber-500 text-white", swatch: "border border-dashed border-amber-600 bg-amber-500" },
];

// Appliance mode (denture / splint / "refer to notes") — no Veneer, that's
// a fixed restoration and can't apply to a removable appliance.
const APPLIANCE_TOOTH_MODES = [
  { k: "unit", txt: "Tooth", on: "bg-blue-600 text-white", swatch: "bg-blue-600" },
  { k: "pontic", txt: "Pontic", on: "bg-amber-500 text-white", swatch: "border border-dashed border-amber-600 bg-amber-500" },
];

function ToothChart({ notation, selection, mode, setMode, onToggle, onArch, onClear, onGroup, disabled, modes = DEFAULT_TOOTH_MODES }) {
  const isDisabled = (u) => !!disabled?.has(u);
  const rows = [
    { key: "upper", teeth: UPPER_ROW, y: 34 },
    { key: "lower", teeth: LOWER_ROW, y: 150 },
  ];

  const isSel = (u) => !!selection[u];
  // A bridge span only joins crowns and pontics — a veneer is a standalone unit.
  const isBridgeUnit = (u) => selection[u] === "unit" || selection[u] === "pontic";

  // Contiguous selected spans (per row) → draw a connector bar behind them.
  const spans = [];
  rows.forEach((row) => {
    let start = null;
    row.teeth.forEach((u, i) => {
      const sel = isBridgeUnit(u);
      if (sel && start === null) start = i;
      const atEnd = i === row.teeth.length - 1;
      const next = !atEnd && isBridgeUnit(row.teeth[i + 1]);
      if (sel && (atEnd || !next)) {
        if (i > start) spans.push({ y: row.y, x1: colX(start), x2: colX(i) + TOOTH_W });
        start = null;
      }
    });
  });

  const upperAllSelected = UPPER_ROW.every((u) => isSel(u));
  const lowerAllSelected = LOWER_ROW.every((u) => isSel(u));

  // When the toolbar is hidden (role implied by the restoration's category)
  // there are no `modes` to describe, so explain only the colours actually
  // on the chart right now.
  const rolesPresent = new Set(Object.values(selection));
  const legendModes = (modes.length ? modes : DEFAULT_TOOTH_MODES.filter((m) => rolesPresent.has(m.k))).filter((m) => m.swatch);

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {modes.length > 0 && (
          <div className="flex overflow-hidden rounded-lg border border-slate-300">
            {modes.map((m) => (
              <button
                key={m.k}
                type="button"
                onClick={() => setMode(m.k)}
                className={`px-3 py-1.5 text-xs font-semibold transition ${
                  mode === m.k ? m.on : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {m.txt}
              </button>
            ))}
          </div>
        )}
        <button type="button" onClick={() => onArch("upper")} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
          {upperAllSelected ? "Clear Upper" : "Full Upper Arch"}
        </button>
        <button type="button" onClick={() => onArch("lower")} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
          {lowerAllSelected ? "Clear Lower" : "Full Lower Arch"}
        </button>
        <button type="button" onClick={onClear} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50">
          Clear All
        </button>
      </div>

      {/* Quick-select groups — whole segments in one tap */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-medium text-slate-400">Quick select:</span>
        {TOOTH_GROUPS.map((g) => (
          <button
            key={g.label}
            type="button"
            onClick={() => onGroup(g.teeth)}
            className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
          >
            {g.label}
          </button>
        ))}
      </div>

      {/* Scrolls horizontally rather than shrinking to fit: letting a
          32-tooth chart scale down to a phone's width puts each tooth at
          ~6px, far too small to tap accurately. A floor of 640px keeps
          teeth at a usable size and the container scrolls instead. */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-2">
        <svg
          viewBox={`0 0 ${CHART_W} 210`}
          className="select-none"
          style={{ width: "100%", minWidth: 640, maxHeight: 300 }}
        >
          <style>{`
            .tooth-empty:hover .glyph { fill:#e2e8f0; stroke:#94a3b8; }
            .tooth-hit { cursor:pointer; }
          `}</style>

          {/* Orientation labels + midline */}
          <text x={MARGIN_X} y={12} className="fill-slate-400" fontSize="9" fontWeight="600">PATIENT RIGHT</text>
          <text x={CHART_W - MARGIN_X} y={12} textAnchor="end" className="fill-slate-400" fontSize="9" fontWeight="600">PATIENT LEFT</text>
          <line x1={CHART_W / 2} y1={20} x2={CHART_W / 2} y2={195} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3 3" />
          <text x={CHART_W / 2} y={107} textAnchor="middle" className="fill-slate-300" fontSize="8">midline</text>

          {/* Connector bars for spans (bridges) */}
          {spans.map((s, idx) => (
            <rect key={idx} x={s.x1 - 2} y={s.y + 18} width={s.x2 - s.x1 + 4} height={24} rx={6} fill="#3b82f6" opacity="0.12" />
          ))}

          {rows.map((row) =>
            row.teeth.map((u, i) => {
              const role = selection[u]; // undefined | 'unit' | 'veneer' | 'pontic'
              const locked = isDisabled(u);
              const x = colX(i);
              const fill = locked
                ? "#e2e8f0"
                : role === "unit" ? "#2563eb" : role === "veneer" ? "#0d9488" : role === "pontic" ? "#f59e0b" : "#f8fafc";
              const stroke = locked
                ? "#94a3b8"
                : role === "unit" ? "#1d4ed8" : role === "veneer" ? "#0f766e" : role === "pontic" ? "#d97706" : "#cbd5e1";
              const textFill = locked ? "#94a3b8" : role ? "#ffffff" : "#475569";
              const tt = toothType(u);
              // crown height varies slightly by type for a chart-like feel
              const h = tt === "molar" ? 56 : tt === "premolar" ? 52 : 48;
              const yTop = row.y + (60 - h) / 2;
              return (
                <g
                  key={u}
                  className={`tooth-hit ${role ? "" : "tooth-empty"}`}
                  style={locked ? { cursor: "not-allowed" } : undefined}
                  onClick={() => !locked && onToggle(u)}
                >
                  <rect
                    className="glyph"
                    x={x}
                    y={yTop}
                    width={TOOTH_W}
                    height={h}
                    rx={tt === "incisor" || tt === "canine" ? 5 : 8}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={role ? 1.5 : 1}
                    strokeDasharray={role === "pontic" ? "3 2" : locked ? "2 2" : "none"}
                    opacity={locked ? 0.6 : 1}
                  />
                  <text
                    x={x + TOOTH_W / 2}
                    y={yTop + h / 2 + 3.5}
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="700"
                    fill={textFill}
                  >
                    {label(u, notation)}
                  </text>
                </g>
              );
            })
          )}
        </svg>
      </div>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        {/* Derived from `modes` so the legend never advertises a marking the
            toolbar doesn't actually offer (e.g. Veneer in appliance mode). */}
        {legendModes.map((m) => (
          <span key={m.k} className="flex items-center gap-1">
            <span className={`inline-block h-3 w-3 rounded-sm ${m.swatch}`} /> {m.txt}
          </span>
        ))}
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-blue-500/20" /> Bridge span</span>
        {disabled?.size > 0 && (
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm border border-dashed border-slate-400 bg-slate-200" /> Already in another restoration</span>
        )}
        {/* Only meaningful on screens narrow enough for the chart to scroll */}
        <span className="flex items-center gap-1 font-medium text-blue-600 sm:hidden">
          <ChevronDown size={11} className="-rotate-90" /> Swipe the chart sideways
        </span>
        <span className="ml-auto font-medium text-slate-600">{notation} notation</span>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Small field helpers                                                */
/* ================================================================== */

// text-base (16px) below sm:, dropping to text-sm on larger screens — below
// 16px, iOS Safari force-zooms on focus, which is disruptive on a phone.
const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-base sm:text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400";

/**
 * Dropdown that allows multiple selections. Behaves like a <select multiple>
 * but with tick boxes, so items are toggled with a plain click.
 */
function MultiSelect({ options, selected, onToggle, placeholder = "Select…" }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const btnRef = useRef(null);
  const panelRef = useRef(null);

  // Portaled to document.body rather than a plain absolutely-positioned
  // child: this form lives inside a modal with `overflow-y-auto`/
  // `overflow-hidden` ancestors, which clip an in-place dropdown panel
  // whenever it's opened near the bottom of the scrolled view. Same
  // pattern already used for CaseActionsMenu's dropdown in
  // DentalLabTracker.jsx — position from the trigger's own rect, close on
  // scroll/resize since a stale anchor is worse than just closing.
  const openPanel = () => {
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e) => {
      if (panelRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onEsc = (e) => e.key === "Escape" && setOpen(false);
    const close = () => setOpen(false);
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        className={`${inputCls} flex items-center justify-between gap-2 text-left`}
      >
        {/* min-w-0 is load-bearing: a flex item defaults to min-width:auto,
            which refuses to shrink below its content width — so `truncate`
            never engages and a long selection list instead forces this
            button (and the whole modal body) wider than the viewport. */}
        <span className={`min-w-0 ${selected.length ? "truncate text-slate-800" : "truncate text-slate-400"}`}>
          {selected.length ? `${selected.length} selected · ${selected.join(", ")}` : placeholder}
        </span>
        <ChevronDown size={16} className={`shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }}
            className="z-50 flex max-h-72 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
          >
            <div className="overflow-y-auto py-1">
              {options.map((opt) => {
                const checked = selected.includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => onToggle(opt)}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition ${
                      checked ? "bg-blue-50 font-semibold text-blue-800" : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        checked ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white"
                      }`}
                    >
                      {checked && <Check size={11} strokeWidth={3} />}
                    </span>
                    {opt}
                  </button>
                );
              })}
            </div>
            {/* Explicit close action — picking items doesn't auto-close the
                panel (several can be picked in a row), so there needs to be
                a deliberate way to collapse it besides click-outside/Escape. */}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="shrink-0 border-t border-slate-100 bg-slate-50 px-3 py-2 text-center text-sm font-semibold text-blue-600 hover:bg-slate-100"
            >
              Done
            </button>
          </div>,
          document.body
        )}
    </div>
  );
}

function Field({ label, children, hint, required }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
        {label} {required && <span className="text-rose-500">*</span>}
      </span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

/**
 * One collapsible step of the prescription. The header stays visible when
 * collapsed and shows a live summary, so the dentist can see the whole order
 * at a glance without expanding everything.
 */
/* ------------------------------------------------------------------ */
/*  Lab picker — replaces the blind name-only dropdown. One card per    */
/*  registered lab with region, turnaround and contact actions; labs    */
/*  in the sending clinic's governorate sort first under "Near you".    */
/* ------------------------------------------------------------------ */

const labRegionLine = (l) =>
  l.governorate ? `${l.governorate}${l.wilayat ? ` · ${l.wilayat}` : ""}` : "Location not set";

function LabPickerCard({ lab, selected, onPick }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onPick(lab.id)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onPick(lab.id)}
      className={`cursor-pointer rounded-xl border p-3 transition ${
        selected ? "border-blue-400 bg-blue-50/60 ring-2 ring-blue-100" : "border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-800">{lab.name}</p>
          <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-slate-500">
            <MapPin size={11} className="shrink-0 text-slate-400" />
            <span className="min-w-0 truncate">{labRegionLine(lab)}</span>
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
          <Clock size={11} /> {lab.tat}d turnaround
        </span>
      </div>
    </div>
  );
}

function LabPicker({ labs, value, onChange, clinicGov, invalid }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = labs.find((l) => l.id === value) ?? null;

  const q = query.trim().toLowerCase();
  const filtered = labs.filter((l) => !q || l.name.toLowerCase().includes(q));
  const near = clinicGov ? filtered.filter((l) => l.governorate && l.governorate === clinicGov) : [];
  const rest = filtered.filter((l) => !near.includes(l));

  const pick = (id) => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${inputCls} flex items-center justify-between gap-2 text-left ${invalid ? "border-rose-400 ring-rose-100" : ""}`}
      >
        {selected ? (
          <span className="min-w-0 truncate">
            <span className="font-medium text-slate-800">{selected.name}</span>
            <span className="text-slate-400"> · {labRegionLine(selected)}</span>
          </span>
        ) : (
          <span className="truncate text-slate-400">Choose a lab…</span>
        )}
        <ChevronDown size={16} className="shrink-0 text-slate-400" />
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4">
            <div className="flex max-h-[85vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:max-w-md sm:rounded-2xl">
              <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
                <Building2 size={16} className="text-blue-600" />
                <h3 className="text-sm font-bold text-slate-800">Choose a lab</h3>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                >
                  <X size={17} />
                </button>
              </div>

              <div className="border-b border-slate-100 px-4 py-3">
                <div className="relative min-w-0">
                  <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search labs…"
                    className={`${inputCls} pl-8`}
                  />
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
                {near.length > 0 && (
                  <>
                    <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-emerald-600">
                      <MapPin size={11} /> Near you — {clinicGov}
                    </p>
                    {near.map((l) => (
                      <LabPickerCard key={l.id} lab={l} selected={l.id === value} onPick={pick} />
                    ))}
                  </>
                )}
                {rest.length > 0 && (
                  <>
                    {near.length > 0 && (
                      <p className="pt-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Other labs</p>
                    )}
                    {rest.map((l) => (
                      <LabPickerCard key={l.id} lab={l} selected={l.id === value} onPick={pick} />
                    ))}
                  </>
                )}
                {filtered.length === 0 && (
                  <p className="py-10 text-center text-sm text-slate-400">No labs match — try clearing the search.</p>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function Step({ n, title, subtitle, summary, open, onToggle, complete, invalid, children }) {
  const ref = useRef(null);
  const wasOpen = useRef(open);
  // Moving between steps collapses a tall section above this one, which
  // leaves the modal's scroll offset pointing deep into the newly opened
  // step (the user lands at its bottom). When THIS step transitions to
  // open, snap its header to the top of the scroll area. Initial mount
  // doesn't scroll — wasOpen starts equal to open.
  useEffect(() => {
    if (open && !wasOpen.current) {
      requestAnimationFrame(() => ref.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
    }
    wasOpen.current = open;
  }, [open]);
  return (
    <section ref={ref} className={`scroll-mt-2 overflow-hidden rounded-xl border transition ${open ? "border-blue-200 bg-white shadow-sm" : "border-slate-200 bg-white"}`}>
      <button
        type="button"
        onClick={onToggle}
        className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${open ? "bg-blue-50/60" : "hover:bg-slate-50"}`}
      >
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            invalid
              ? "bg-rose-100 text-rose-600 ring-1 ring-inset ring-rose-300"
              : complete
              ? "bg-emerald-500 text-white"
              : open
              ? "bg-blue-600 text-white"
              : "bg-slate-200 text-slate-600"
          }`}
        >
          {complete && !invalid ? <Check size={14} strokeWidth={3} /> : n}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-slate-800">{title}</span>
          <span className="block truncate text-[11px] text-slate-500">
            {!open && summary ? summary : subtitle}
          </span>
        </span>
        <ChevronDown size={18} className={`shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="border-t border-slate-100 px-4 py-4">{children}</div>}
    </section>
  );
}

function SectionHeader({ icon: Icon, n, title, subtitle }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 ring-1 ring-inset ring-blue-100">
        <Icon size={16} />
      </div>
      <div>
        <h4 className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <span className="text-slate-400">{n}.</span> {title}
        </h4>
        {subtitle && <p className="text-[11px] text-slate-500">{subtitle}</p>}
      </div>
    </div>
  );
}

/**
 * The material/shade/stump/pontic/implant field block for ONE restoration —
 * appears once at least one tooth has been picked for it (the category was
 * already chosen before the chart, driving what shows here). Used inside
 * the restoration cart's add/edit editor. Mirrors the category-driven logic
 * the whole-case (appliance) fields already use, just scoped to a `draft`
 * object instead of top-level state — restricted to RESTORATION_CATEGORIES,
 * so the splint / "refer to notes" branches never apply here.
 */
function RestorationFields({ draft, onChange, errors }) {
  const isImplant = IMPLANT_CATEGORIES.includes(draft.category);
  const showStump = HAS_STUMP.includes(draft.category) && AESTHETIC_MATERIALS.includes(draft.material);
  const shadeByLab = draft.shadeGuide === SHADE_BY_LAB;
  const err = (k) => errors?.includes(k);

  const changeShadeGuide = (g) => onChange({ shadeGuide: g, vitaShade: g === SHADE_BY_LAB ? SHADE_BY_LAB : SHADE_GUIDES[g][0] });

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Material" required>
        <select className={`${inputCls} ${err("material") ? "border-rose-400 ring-rose-100" : ""}`} value={draft.material} onChange={(e) => onChange({ material: e.target.value })}>
          {CATEGORIES[draft.category].materials.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </Field>
      {isImplant && (
        <>
          <Field label="Implant Brand" required>
            <select className={`${inputCls} ${err("implantSystem") ? "border-rose-400 ring-rose-100" : ""}`} value={draft.implantSystem} onChange={(e) => onChange({ implantSystem: e.target.value })}>
              <option value="">Select brand…</option>
              {IMPLANT_SYSTEMS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Abutment Size" required>
            <select className={`${inputCls} ${err("abutmentType") ? "border-rose-400 ring-rose-100" : ""}`} value={draft.abutmentType} onChange={(e) => onChange({ abutmentType: e.target.value })}>
              <option value="">Select…</option>
              {ABUTMENT_TYPES.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </Field>
          <Field label="Abutment Colour Code" hint="Optional · helps the lab match the physical component">
            <input className={inputCls} value={draft.abutmentColor} onChange={(e) => onChange({ abutmentColor: e.target.value })} placeholder="e.g. Yellow, Pink, Green…" />
          </Field>
        </>
      )}
      <Field label="Shade Guide">
        <select className={inputCls} value={draft.shadeGuide} onChange={(e) => changeShadeGuide(e.target.value)}>
          {SHADE_GUIDE_NAMES.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      </Field>
      {!shadeByLab && (
        <Field label="Shade">
          <select className={inputCls} value={draft.vitaShade} onChange={(e) => onChange({ vitaShade: e.target.value })}>
            {SHADE_GUIDES[draft.shadeGuide].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>
      )}
      {showStump && (
        <Field label="Stump Shade" hint="Needed for translucent materials">
          <select className={inputCls} value={draft.stumpShade} onChange={(e) => onChange({ stumpShade: e.target.value })}>
            {STUMP_SHADES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>
      )}
    </div>
  );
}

/** Compact display of one confirmed restoration in the cart list. */
function RestorationCard({ r, notation, onEdit, onDelete, justAdded }) {
  const isImplant = IMPLANT_CATEGORIES.includes(r.category);
  return (
    <div className={`rounded-xl border bg-white p-3 shadow-sm transition ${justAdded ? "border-emerald-400 ring-2 ring-emerald-200" : "border-slate-200"}`}>
      {justAdded && (
        <p className="mb-1.5 flex items-center gap-1 text-[11px] font-bold text-emerald-600">
          <Check size={12} strokeWidth={3} /> Added to case
        </p>
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-800">{r.category}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">{toothSummary({ teeth: r.teeth, notation }) || "No teeth"}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button type="button" onClick={onEdit} className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-blue-600" title="Edit">
            <Pencil size={14} />
          </button>
          <button type="button" onClick={onDelete} className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Delete">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
        {r.material && <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">{r.material}</span>}
        {r.vitaShade && r.vitaShade !== "N/A" && <span className="rounded-full bg-violet-100 px-2 py-0.5 font-semibold text-violet-700">{r.vitaShade === SHADE_BY_LAB ? SHADE_BY_LAB : `Shade ${r.vitaShade}`}</span>}
        {isImplant && r.implantSystem && <span className="rounded-full bg-indigo-100 px-2 py-0.5 font-semibold text-indigo-700">{r.implantSystem}</span>}
      </div>
    </div>
  );
}

// A fresh restoration editor draft — used both for the initial "add" state
// and to reset after confirming one, so the cart's next item doesn't start
// pre-filled with the previous one's spec.
const emptyDraft = () => ({
  id: null, // set only when editing an existing restoration
  selection: {}, // { universal: 'unit' | 'veneer' | 'pontic' }, same shape as the case-level chart
  mode: "unit",
  category: RESTORATION_CATEGORIES[0],
  material: CATEGORIES[RESTORATION_CATEGORIES[0]].materials[0],
  shadeGuide: "Vita Classical",
  vitaShade: "A2",
  stumpShade: "N/A",
  implantSystem: "",
  abutmentType: "",
  abutmentColor: "",
});

/* ================================================================== */
/*  New Case  vs  Follow-up existing case  — mode toggle              */
/* ================================================================== */

// Shown at the top of both the Rx form and the follow-up form. A follow-up
// is a NEXT STAGE of a multi-visit case, or a RETURN (remake/adjustment/
// refit) on already-delivered work — no tooth chart, just instructions and
// troubleshooting files aimed at the same lab that made the original.
function ModeToggle({ value, onChange }) {
  return (
    <div className="mx-3 mt-3 grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1 sm:mx-5">
      {[
        { id: "new", label: "New Case", icon: FileText },
        { id: "followup", label: "Follow-up existing case", icon: RotateCcw },
      ].map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
            value === id ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <Icon size={14} /> {label}
        </button>
      ))}
    </div>
  );
}

const FOLLOWUP_KINDS = [
  { id: "update", label: "Update case", hint: "Extra files or instructions for the case — nothing wrong with the work." },
  { id: "stage", label: "Next stage", hint: "The next lab stage of a multi-visit case (e.g. denture try-in)." },
  { id: "remake", label: "Remake", hint: "Redo the work — a fit failure or clinically unacceptable result." },
  { id: "adjustment", label: "Adjustment", hint: "A minor correction to delivered work." },
  { id: "refit", label: "Refit", hint: "Re-seat / re-fit delivered work that didn't seat." },
];

function caseWorkSummary(c) {
  const rx = c?.prescription ?? {};
  if (Array.isArray(rx.restorations) && rx.restorations.length) {
    // Per-category UNIT counts (one crown per tooth; arch work = 1 unit) —
    // a single "Crown - implant" line with five teeth is five crowns.
    const counts = new Map();
    for (const r of rx.restorations) {
      const cat = r?.category || "Restoration";
      const units = Array.isArray(r?.teeth) && r.teeth.length ? r.teeth.length : 1;
      counts.set(cat, (counts.get(cat) || 0) + units);
    }
    // A bridge is ONE piece spanning its units — "× 3" would read as three bridges.
    return [...counts]
      .map(([cat, n]) => (n <= 1 ? cat : /bridge/i.test(cat) ? `${cat} (${n} units)` : `${cat} × ${n}`))
      .join(", ");
  }
  return rx.category || toothSummary(rx) || "—";
}

/* ================================================================== */
/*  Follow-up / Return form (isolated from the Rx form's hooks)        */
/* ================================================================== */

function FollowupModal({ open, cases = [], labs = [], userId, authorName = "", defaultClinicId = null, onSubmit, onClose, onSwitchToNew }) {
  const [query, setQuery] = useState("");
  const [parentId, setParentId] = useState(null);
  const [kind, setKind] = useState("update");
  const [instructions, setInstructions] = useState("");
  const [pickupRequested, setPickupRequested] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [scans, setScans] = useState([]);
  const [groupId, setGroupId] = useState(() => crypto.randomUUID());
  const [qrOpen, setQrOpen] = useState(false);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const labById = useMemo(() => Object.fromEntries((labs ?? []).map((l) => [l.id, l])), [labs]);

  // Reset whenever the modal (re)opens so a prior follow-up never leaks in.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setQuery(""); setParentId(null); setKind("update"); setInstructions("");
      setPickupRequested(false); setPhotos([]); setScans([]);
      setGroupId(crypto.randomUUID()); setTouched(false); setSaving(false); setSubmitError("");
    }
    wasOpen.current = open;
  }, [open]);

  const parent = useMemo(() => cases.find((c) => c.id === parentId) || null, [cases, parentId]);

  // Search across ALL of the clinic's cases — active AND completed — so a
  // finished denture can be pulled up for a remake. `cases` is already the
  // caller's own set (RLS-scoped); we just filter it here.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cases.slice(0, 8);
    return cases
      .filter((c) => {
        const lab = labById[c.labId]?.name ?? "";
        return [c.id, c.patientName, c.patientId, lab, caseWorkSummary(c)]
          .some((v) => String(v ?? "").toLowerCase().includes(q));
      })
      .slice(0, 20);
  }, [query, cases, labById]);

  const uploadOnePhoto = async (entryId, file) => {
    try {
      const url = await uploadCasePhoto(userId, groupId, file);
      setPhotos((p) => p.map((ph) => (ph.id === entryId ? { ...ph, url, uploading: false, error: null } : ph)));
    } catch (err) {
      setPhotos((p) => p.map((ph) => (ph.id === entryId ? { ...ph, uploading: false, error: err.message || "Upload failed" } : ph)));
    }
  };
  const addPhotos = (fileList) => {
    const entries = Array.from(fileList).map((file) => ({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      file, name: file.name, size: file.size,
      previewUrl: URL.createObjectURL(file), url: null, uploading: true, error: null,
    }));
    setPhotos((p) => [...p, ...entries]);
    entries.forEach((e) => uploadOnePhoto(e.id, e.file));
  };
  const removePhoto = (id) =>
    setPhotos((p) => {
      const t = p.find((ph) => ph.id === id);
      if (t?.previewUrl) URL.revokeObjectURL(t.previewUrl);
      return p.filter((ph) => ph.id !== id);
    });
  // Phase 61: follow-up STL/PDF files are real uploads too (same group
  // folder as the follow-up's photos).
  const uploadOneScan = async (entryId, file) => {
    try {
      const url = await uploadCasePhoto(userId, groupId, file, classifyRxFile(file.name).contentType);
      setScans((p) => p.map((s) => (s.id === entryId ? { ...s, url, uploading: false, error: null } : s)));
    } catch (err) {
      setScans((p) => p.map((s) => (s.id === entryId ? { ...s, uploading: false, error: err.message || "Upload failed" } : s)));
    }
  };
  const addScans = (fileList) => {
    const entries = Array.from(fileList).map((file) => {
      // The accept filter is off on iOS (scanPickerAccept) — gate by extension here.
      const typeOk = classifyRxFile(file.name).kind === "scan";
      return {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        file, name: file.name, size: file.size, url: null,
        uploading: typeOk && file.size <= SCAN_MAX_BYTES,
        error: !typeOk ? "Not an STL or PDF" : file.size > SCAN_MAX_BYTES ? "Over 50 MB" : null,
      };
    });
    setScans((p) => [...p, ...entries]);
    entries.filter((e) => e.uploading).forEach((e) => uploadOneScan(e.id, e.file));
  };

  const photosUploading = photos.some((p) => p.uploading) || scans.some((s) => s.uploading);
  // A remake must SAY what went wrong — photos alone don't tell the
  // technician what to change, so instructions stop being optional there.
  const instructionsRequired = kind === "remake";
  const canSubmit =
    !!parent && !photosUploading && !saving &&
    (instructions.trim() || (!instructionsRequired && (photos.length || scans.length)));

  const submit = async () => {
    setTouched(true);
    setSubmitError("");
    if (!parent) return;
    if (!instructions.trim() && (instructionsRequired || (!photos.length && !scans.length))) return;
    if (photosUploading) return;
    setSaving(true);
    try {
      await onSubmit({
        parentCaseId: parent.id,
        kind,
        instructions: instructions.trim(),
        attachments: [
          ...photos.filter((p) => p.url).map((p) => ({ name: p.name, size: p.size, url: p.url, kind: "photo" })),
          ...scans.filter((s) => !s.error).map((s) => ({ name: s.name, size: s.size, kind: "scan", ...(s.url ? { url: s.url } : {}) })),
        ],
        pickupRequested,
        createdByRole: "dentist",
        createdByName: authorName,
      });
      onClose();
    } catch (err) {
      setSubmitError(err?.message || "Couldn't submit the follow-up. Please try again.");
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-3xl flex-col overflow-hidden bg-white shadow-2xl ring-1 ring-slate-200 sm:max-h-[92vh] sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 bg-white px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white">
              <RotateCcw size={18} />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800">Follow-up / Return to lab</h3>
              <p className="text-[11px] text-slate-500">A next stage or a remake/adjustment on an existing case</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <ModeToggle value="followup" onChange={(v) => v === "new" && onSwitchToNew()} />

        <div className="flex-1 space-y-4 overflow-x-hidden overflow-y-auto bg-slate-50/60 px-3 py-4 sm:px-5">
          {/* 1 · Pick the existing case (active or completed) */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="mb-2 text-sm font-bold text-slate-800">1 · Which case is this about?</p>
            {parent ? (
              <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-800">{parent.patientName} <span className="font-mono text-xs font-medium text-slate-500">· {parent.id}</span></p>
                    <p className="mt-0.5 truncate text-xs text-slate-600">
                      {caseWorkSummary(parent)} · Lab: {labById[parent.labId]?.name ?? "—"}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      Patient ID {parent.patientId || "—"} · {(parent.stageIndex ?? 0) >= 3 ? "Work complete" : "In progress"}
                      {parent.createdAt ? ` · sent ${new Date(parent.createdAt).toLocaleDateString()}` : ""}
                    </p>
                  </div>
                  <button type="button" onClick={() => setParentId(null)} className="shrink-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                    Change
                  </button>
                </div>
                <p className="mt-2 flex items-center gap-1 text-[11px] text-slate-400">
                  <Info size={12} /> Patient, lab and original work are locked — you're adding a follow-up, not editing the case.
                </p>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    autoFocus
                    className={`${inputCls} pl-9`}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search all cases — patient, ID, case #, lab (incl. completed)"
                  />
                </div>
                {touched && !parent && <p className="mt-1.5 text-xs font-semibold text-rose-600">Select the case this follow-up is for.</p>}
                <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
                  {results.length === 0 ? (
                    <p className="py-6 text-center text-sm text-slate-400">No matching cases.</p>
                  ) : (
                    results.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => { setParentId(c.id); setQuery(""); }}
                        className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left hover:border-blue-300 hover:bg-blue-50/40"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-slate-800">{c.patientName} <span className="font-mono text-[11px] font-medium text-slate-400">· {c.id}</span></span>
                          <span className="block truncate text-xs text-slate-500">{caseWorkSummary(c)} · {labById[c.labId]?.name ?? "—"}</span>
                        </span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${(c.stageIndex ?? 0) >= 3 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                          {(c.stageIndex ?? 0) >= 3 ? "Complete" : "Active"}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          {/* 2 · What kind of follow-up */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="mb-2 text-sm font-bold text-slate-800">2 · What kind of follow-up?</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {FOLLOWUP_KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => setKind(k.id)}
                  className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                    kind === k.id ? "border-blue-500 bg-blue-50 text-blue-700 ring-1 ring-blue-200" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>
            <p className="mt-2 flex items-start gap-1 text-[11px] text-slate-500">
              <Info size={12} className="mt-0.5 shrink-0" /> {FOLLOWUP_KINDS.find((k) => k.id === kind)?.hint}
            </p>
          </div>

          {/* 3 · Instructions for the lab */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="mb-2 text-sm font-bold text-slate-800">
              3 · Instructions for the lab technician
              {instructionsRequired && <span className="ml-0.5 text-rose-600" title="Required for a remake">*</span>}
            </p>
            <textarea
              className={`${inputCls} min-h-[90px] resize-y ${instructionsRequired && touched && !instructions.trim() ? "ring-2 ring-rose-300" : ""}`}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Describe the issue or the next-stage instructions — e.g. 'High on the palatal of 26, please adjust the occlusion and re-polish.'"
              maxLength={4000}
            />
            {instructionsRequired &&
              (touched && !instructions.trim() ? (
                <p className="mt-1.5 text-[11px] font-semibold text-rose-600">
                  Required — tell the lab what went wrong and what to change.
                </p>
              ) : (
                <p className="mt-1.5 text-[11px] text-slate-400">Required for a remake.</p>
              ))}
          </div>

          {/* 4 · Attachments — always unlocked (troubleshooting photos + STL) */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="mb-1 text-sm font-bold text-slate-800">4 · Attachments</p>
            <p className="mb-3 text-[11px] text-slate-500">Clinical photos of the problem and/or new STL scans — always available for a follow-up.</p>
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                <ImageIcon size={14} /> + Add photos
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }} />
              </label>
              {!isMobileDevice() && (
                <button type="button" onClick={() => setQrOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-white px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-50">
                  <Smartphone size={14} /> From phone (QR)
                </button>
              )}
              <MobilePhotoQR
                open={qrOpen ? groupId : false}
                onClose={() => setQrOpen(false)}
                onPhotos={(list) => {
                  const entry = (m, i) => ({
                    id: `mob-${Date.now().toString(36)}-${i}`,
                    name: m.name || `phone-file-${i + 1}`,
                    size: m.size ?? 0,
                    previewUrl: null,
                    url: m.url,
                    uploading: false,
                    error: null,
                  });
                  const ph = list.filter((m) => m.kind !== "scan").map(entry);
                  const sc = list.filter((m) => m.kind === "scan").map(entry);
                  if (ph.length) setPhotos((p) => [...p, ...ph]);
                  if (sc.length) setScans((p) => [...p, ...sc]);
                }}
              />
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                <ScanLine size={14} /> + Add STL / PDF
                <input type="file" accept={scanPickerAccept()} multiple className="hidden" onChange={(e) => { addScans(e.target.files); e.target.value = ""; }} />
              </label>
            </div>
            {photos.length > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {photos.map((p) => (
                  <div key={p.id} className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                    <SignedImage url={p.previewUrl || p.url} alt={p.name} className="h-20 w-full object-cover" />
                    {p.uploading && <div className="absolute inset-0 flex items-center justify-center bg-white/60"><Loader2 size={16} className="animate-spin text-blue-600" /></div>}
                    {p.error && <div className="absolute inset-0 flex items-center justify-center bg-rose-50/80 px-1 text-center text-[9px] font-semibold text-rose-700">{p.error}</div>}
                    <button type="button" onClick={() => removePhoto(p.id)} className="absolute right-1 top-1 rounded-full bg-slate-900/60 p-0.5 text-white hover:bg-rose-600">
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {scans.length > 0 && (
              <ul className="mt-2 space-y-1">
                {scans.map((s) => (
                  <li key={s.id ?? s.name} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {/\.pdf$/i.test(s.name) ? <FileText size={13} className="shrink-0 text-rose-500" /> : <ScanLine size={13} className="shrink-0 text-slate-400" />}
                      <span className="truncate">{s.name}</span>
                    </span>
                    <span className="ml-2 flex shrink-0 items-center gap-2">
                      {s.uploading && <Loader2 size={12} className="animate-spin text-blue-500" />}
                      {s.error && <span className="font-semibold text-rose-600">{s.error}</span>}
                      <button type="button" onClick={() => setScans((prev) => prev.filter((x) => x !== s))} className="text-slate-400 hover:text-rose-600"><Trash2 size={13} /></button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 5 · Logistics — manual pickup only, never auto-triggered */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="mb-2 text-sm font-bold text-slate-800">5 · Logistics</p>
            <label className="flex cursor-pointer items-start gap-2.5">
              <input type="checkbox" checked={pickupRequested} onChange={(e) => setPickupRequested(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600" />
              <span>
                <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-700"><Truck size={14} className="text-slate-400" /> Request a lab pick-up</span>
                <span className="block text-[11px] text-slate-500">Tick only if a courier needs to collect this from the clinic — nothing is dispatched automatically.</span>
              </span>
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white px-4 py-3 sm:px-6">
          {submitError ? (
            <span className="flex items-start gap-1.5 text-xs font-semibold text-rose-700"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {submitError}</span>
          ) : (
            <span className="flex items-center gap-1.5 text-[11px] text-slate-500"><Info size={13} /> {photosUploading ? "Waiting for files to finish uploading…" : "The lab is notified in-app; no charge is created."}</span>
          )}
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className={`flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white sm:order-2 sm:py-2 ${canSubmit ? "bg-blue-600 hover:bg-blue-700" : "cursor-not-allowed bg-slate-300"}`}
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Send to lab
            </button>
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 sm:order-1 sm:py-2">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Digital Laboratory Prescription Form                               */
/* ================================================================== */

export default function PrescriptionForm({ open, onClose, onResume, labs, onSave, onSaveEdit, onSubmitFollowup, editing = null, userId, authorName = "", cases = [], clinics = [], defaultClinicId = null, labAllowed = () => true }) {
  const [formKind, setFormKind] = useState("new"); // "new" | "followup" — MUST stay above the !open early return
  const [notation, setNotation] = useState("FDI");
  const [mode, setMode] = useState("unit");
  const [selection, setSelection] = useState({}); // { universal: 'unit'|'pontic' }

  const [patientName, setPatientName] = useState("");
  const [patientId, setPatientId] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [showPatientExtras, setShowPatientExtras] = useState(false);

  // Multi-clinic: which of the dentist's owned clinics this case is sent
  // from. Only surfaced in the UI when they own more than one — defaults
  // to their profile's default clinic otherwise, with zero visible change.
  const [selectedClinicId, setSelectedClinicId] = useState(defaultClinicId);
  useEffect(() => {
    if (defaultClinicId && !selectedClinicId) setSelectedClinicId(defaultClinicId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultClinicId]);

  // What is physically going to the lab with this case.
  const [included, setIncluded] = useState([]);
  const [includedOther, setIncludedOther] = useState("");
  const toggleIncluded = (item) =>
    setIncluded((prev) => (prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]));

  const [category, setCategory] = useState("Crown - tooth");
  const [material, setMaterial] = useState(CATEGORIES["Crown - tooth"].materials[0]);
  const [shadeGuide, setShadeGuide] = useState("Vita Classical");
  const [vitaShade, setVitaShade] = useState("A2");
  const [stumpShade, setStumpShade] = useState("N/A");
  // Arch choice for arch-based appliances (denture, retainers, night guard,
  // study model, special tray): upper | lower | both. Above the !open early
  // return like every hook in this file.
  const [arches, setArches] = useState("upper");

  // Restoration cart — a case is EITHER several independent fixed
  // restorations (crowns/bridges/veneers/implants, each own spec) OR one
  // whole-case appliance (denture/splint/"refer to notes", the original
  // single-item fields above, untouched). "restorations" mode replaces the
  // fields above with the cart below; never both in the same case.
  const [caseMode, setCaseMode] = useState("restorations");
  const [restorations, setRestorations] = useState([]);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftTouched, setDraftTouched] = useState(false); // gates the editor's own inline errors, independent of the form-wide `touched`
  const [draft, setDraft] = useState(emptyDraft);
  const updateDraft = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const [labId, setLabId] = useState("");
  // Phase 58: switching the sending clinic can make the chosen lab
  // unavailable (exclusive contracts) — clear it rather than letting the
  // submit fail against the cases_insert policy.
  useEffect(() => {
    if (labId && !labAllowed(labId, selectedClinicId || defaultClinicId)) setLabId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClinicId, labId, labAllowed]);
  const [deliveryTime, setDeliveryTime] = useState(DELIVERY_TIMES[0]);
  const [pickupRequested, setPickupRequested] = useState(false); // ask the lab to collect the case from the clinic

  // Implant-only specs (blank so the dentist has to choose deliberately).
  const [implantSystem, setImplantSystem] = useState("");
  const [abutmentType, setAbutmentType] = useState("");
  // Free-text, not a lookup table: color coding is manufacturer AND
  // product-line specific (e.g. Straumann Bone Level vs Tissue Level use
  // different schemes for the same diameter) — the dentist enters the
  // actual code for their implant, rather than the app guessing wrong.
  const [abutmentColor, setAbutmentColor] = useState("");
  const [insertionDate, setInsertionDate] = useState("");

  // Live expected price (Phase 33): recomputed as the dentist picks items,
  // via a security-definer RPC that applies THIS clinic's price agreement
  // (clinic rule -> lab default). Best-effort — null just hides the chip.
  const [expectedPrice, setExpectedPrice] = useState(null);
  const estimateSeq = useRef(0);

  const [scans, setScans] = useState([]);
  // Real uploads to Supabase Storage (bucket `case-photos`), not simulated —
  // the lab reads these directly off the case. Grouped under one client-side
  // id per form session (no case row exists yet while the form is open).
  const [photos, setPhotos] = useState([]);
  const [photoGroupId, setPhotoGroupId] = useState(() => crypto.randomUUID());
  // QR mobile upload modal (Phase 51) — MUST stay above the !open early return.
  const [qrOpen, setQrOpen] = useState(false);
  const [notes, setNotes] = useState("");

  const [touched, setTouched] = useState(false);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [step, setStep] = useState(1); // 1 = Patient & Lab, 2 = Clinical, 3 = Logistics

  // Brief green confirmation on the card that was just added/updated.
  // MUST stay above the `if (!open)` early return below — hooks declared
  // after it would only run while the modal is open, so the hook count
  // would change between renders (React error #310).
  const [justAddedId, setJustAddedId] = useState(null);
  useEffect(() => {
    if (!justAddedId) return;
    const t = setTimeout(() => setJustAddedId(null), 2200);
    return () => clearTimeout(t);
  }, [justAddedId]);

  // Debounced live price estimate (Phase 33). MUST also stay above the
  // `if (!open)` early return — a hook below it only runs while the modal
  // is open and the changed hook count crashes React (#310, the exact bug
  // this file's comments warn about; re-learned the hard way 2026-08-20).
  useEffect(() => {
    const clinicId = selectedClinicId || defaultClinicId;
    const hasItems = caseMode === "restorations" ? restorations.length > 0 : !!category;
    if (!open || !labId || !clinicId || !hasItems) {
      setExpectedPrice(null);
      return;
    }
    const rx =
      caseMode === "restorations"
        ? { restorations: restorations.map((r) => ({ category: r.category, teeth: r.teeth })) }
        : { category, teeth: Object.keys(selection), ...(ARCH_CATEGORIES.includes(category) ? { arches } : {}) };
    const seq = ++estimateSeq.current;
    const t = setTimeout(async () => {
      const n = await estimateCasePrice(labId, clinicId, rx);
      if (seq === estimateSeq.current) setExpectedPrice(n);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, labId, selectedClinicId, defaultClinicId, caseMode, restorations, category, selection, arches]);

  const labById = useMemo(() => Object.fromEntries(labs.map((l) => [l.id, l])), [labs]);

  // Edit mode: rehydrate every field from the case being edited. Keyed on the
  // `open` transition ONLY (the settings-forms lesson — object identities
  // change on every auth event, so `editing` must not be in the deps).
  const isEditing = !!editing;
  // Closing without submitting deliberately keeps a NEW-case draft around,
  // but a cancelled EDIT must not leak that case's data into the next "New
  // Prescription" — remember whether the last open was an edit.
  const wasEditingRef = useRef(false);
  useEffect(() => {
    if (!open) return;
    if (!editing) {
      if (wasEditingRef.current) {
        wasEditingRef.current = false;
        reset();
      }
      return;
    }
    wasEditingRef.current = true;
    const p = editing.prescription ?? {};
    setNotation(p.notation ?? "FDI");
    setPatientName(editing.patientName ?? "");
    const pid = editing.patientId === "PT-NEW" ? "" : editing.patientId ?? "";
    const phone = (editing.patientPhone ?? "").replace(/^\+968/, "");
    setPatientId(pid);
    setPatientPhone(phone);
    setShowPatientExtras(!!(pid || phone));
    setSelectedClinicId(editing.clinicId ?? defaultClinicId);
    setIncluded(p.included ?? []);
    setIncludedOther(p.includedOther ?? "");
    if (p.restorations?.length) {
      setCaseMode("restorations");
      setRestorations(p.restorations.map((r, i) => (r.id ? r : { ...r, id: `rehydrated-${i}` })));
    } else {
      setCaseMode("appliance");
      setRestorations([]);
      setSelection(Object.fromEntries((p.teeth ?? []).map((t) => [t.universal, t.role])));
      setCategory(p.category ?? "Crown - tooth");
      setMaterial(p.material ?? "");
      setShadeGuide(p.shadeGuide ?? "Vita Classical");
      setVitaShade(p.vitaShade ?? "A2");
      setStumpShade(p.stumpShade ?? "N/A");
      setArches(p.arches ?? "upper");
      setImplantSystem(p.implantSystem ?? "");
      setAbutmentType(p.abutmentType ?? "");
      setAbutmentColor(p.abutmentColor ?? "");
    }
    setDraftOpen(false);
    setDraftTouched(false);
    setDraft(emptyDraft());
    setLabId(editing.labId ?? "");
    setInsertionDate(editing.appointmentDate && editing.appointmentDate !== "—" ? editing.appointmentDate : "");
    setDeliveryTime(editing.deliveryTime ?? DELIVERY_TIMES[0]);
    setPickupRequested(p.pickupRequested ?? false);
    setNotes(p.notes ?? "");
    // Already-uploaded files come back as plain {name, size, url} entries —
    // no uploading/error flags, so the thumbnails render them as done.
    const files = p.files ?? [];
    setScans(files.filter((f) => f.kind === "scan").map((f, i) => ({ id: `existing-scan-${i}`, name: f.name, size: f.size, url: f.url ?? null })));
    setPhotos(files.filter((f) => f.kind === "photo" && f.url).map((f, i) => ({ id: `existing-${i}`, name: f.name, size: f.size, url: f.url })));
    setPhotoGroupId(crypto.randomUUID());
    setTouched(false);
    setStep(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A fresh open always lands on "New Case"; the toggle then lets the user
  // switch to a follow-up. Editing is always a new-case edit, never a follow-up.
  useEffect(() => {
    if (open && !editing) setFormKind("new");
  }, [open, editing]);

  const reset = () => {
    setNotation("FDI"); setMode("unit"); setSelection({});
    setPatientName(""); setPatientId(""); setPatientPhone(""); setShowPatientExtras(false);
    setSelectedClinicId(defaultClinicId);
    setIncluded([]); setIncludedOther("");
    setCategory("Crown - tooth"); setMaterial(CATEGORIES["Crown - tooth"].materials[0]);
    setShadeGuide("Vita Classical"); setVitaShade("A2"); setStumpShade("N/A"); setArches("upper");
    setCaseMode("restorations"); setRestorations([]); setDraftOpen(false); setDraftTouched(false); setDraft(emptyDraft());
    setLabId(""); setInsertionDate(""); setDeliveryTime(DELIVERY_TIMES[0]); setPickupRequested(false);
    setImplantSystem(""); setAbutmentType(""); setAbutmentColor("");
    setScans([]);
    photos.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
    setPhotos([]); setPhotoGroupId(crypto.randomUUID());
    setNotes(""); setTouched(false); setDiscardConfirm(false); setQrOpen(false);
    setStep(1);
  };

  /* ---- Phase 60: persisted draft (1-day server lifetime) ------------ */
  // Closing a started NEW prescription saves the whole form state to
  // rx_drafts (one per user); the next app load — any device — restores
  // it into the minimized pill. Submitting or discarding deletes it; the
  // server hides + deletes drafts older than 24 hours.
  const serializeRxDraft = () => ({
    notation, mode, selection,
    patientName, patientId, patientPhone, showPatientExtras,
    selectedClinicId, included, includedOther,
    category, material, shadeGuide, vitaShade, stumpShade, arches,
    caseMode, restorations,
    cartDraft: draft, cartDraftOpen: draftOpen, cartDraftTouched: draftTouched,
    labId, insertionDate, deliveryTime, pickupRequested,
    implantSystem, abutmentType, abutmentColor, notes,
    scans: scans.filter((f) => !f.error).map((f) => ({ name: f.name, size: f.size, url: f.url ?? null })),
    photos: photos.filter((f) => f.url).map((f) => ({ name: f.name, size: f.size, url: f.url })),
    photoGroupId,
  });
  const hydrateRxDraft = (d) => {
    setNotation(d.notation ?? "FDI");
    setMode(d.mode ?? "unit");
    setSelection(d.selection ?? {});
    setPatientName(d.patientName ?? "");
    setPatientId(d.patientId ?? "");
    setPatientPhone(d.patientPhone ?? "");
    setShowPatientExtras(!!d.showPatientExtras);
    setSelectedClinicId(d.selectedClinicId ?? defaultClinicId);
    setIncluded(d.included ?? []);
    setIncludedOther(d.includedOther ?? "");
    setCategory(d.category ?? "Crown - tooth");
    setMaterial(d.material ?? CATEGORIES["Crown - tooth"].materials[0]);
    setShadeGuide(d.shadeGuide ?? "Vita Classical");
    setVitaShade(d.vitaShade ?? "A2");
    setStumpShade(d.stumpShade ?? "N/A");
    setArches(d.arches ?? "upper");
    setCaseMode(d.caseMode ?? "restorations");
    setRestorations(d.restorations ?? []);
    setDraft(d.cartDraft ?? emptyDraft());
    setDraftOpen(!!d.cartDraftOpen);
    setDraftTouched(!!d.cartDraftTouched);
    setLabId(d.labId ?? "");
    setInsertionDate(d.insertionDate ?? "");
    setDeliveryTime(d.deliveryTime ?? DELIVERY_TIMES[0]);
    setPickupRequested(!!d.pickupRequested);
    setImplantSystem(d.implantSystem ?? "");
    setAbutmentType(d.abutmentType ?? "");
    setAbutmentColor(d.abutmentColor ?? "");
    setNotes(d.notes ?? "");
    setScans((d.scans ?? []).map((f, i) => ({ id: `draft-scan-${i}`, name: f.name, size: f.size, url: f.url ?? null })));
    setPhotos((d.photos ?? []).filter((f) => f.url).map((f, i) => ({ id: `draft-${i}`, name: f.name, size: f.size, url: f.url })));
    setPhotoGroupId(d.photoGroupId ?? crypto.randomUUID());
  };
  const discardRxDraft = () => {
    if (userId) deleteRxDraft(userId).catch(() => {});
  };

  // A closed NEW-case form with content keeps living as a minimized pill —
  // the draft already survives close (state stays mounted); this just makes
  // that visible and offers resume / discard. Edits never minimize.
  const hasDraft =
    !isEditing &&
    !wasEditingRef.current &&
    !!(
      patientName.trim() ||
      patientId.trim() ||
      patientPhone.trim() ||
      restorations.length ||
      Object.keys(selection).length ||
      included.length ||
      labId ||
      insertionDate ||
      notes.trim() ||
      scans.length ||
      photos.length ||
      draftTouched
    );

  // Persist on close (Phase 60): open -> closed with content saves the
  // draft; closed empty removes any stored one (so an emptied-out form
  // can't resurrect stale data on the next load). Both fire-and-forget —
  // pre-SQL schemas and offline just keep the in-memory pill behavior.
  // MUST stay above the !open early return (hook-count — React #310).
  const prevOpenRef = useRef(open);
  useEffect(() => {
    const was = prevOpenRef.current;
    prevOpenRef.current = open;
    if (!was || open || isEditing || wasEditingRef.current || !userId) return;
    if (hasDraft) {
      saveRxDraft({
        clinicId: selectedClinicId || defaultClinicId || null,
        patientName: patientName.trim(),
        payload: serializeRxDraft(),
      }).catch(() => {});
    } else {
      deleteRxDraft(userId).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Restore on load: one fetch per session, and only into an idle, empty,
  // non-editing form — never over live typing.
  const openRef = useRef(open);
  openRef.current = open;
  const hasDraftRef = useRef(false);
  hasDraftRef.current = hasDraft;
  const draftFetchedRef = useRef(false);
  useEffect(() => {
    if (draftFetchedRef.current || !userId) return;
    draftFetchedRef.current = true;
    fetchMyRxDraft(userId)
      .then((row) => {
        if (!row?.payload) return;
        if (openRef.current || hasDraftRef.current || wasEditingRef.current) return;
        hydrateRxDraft(row.payload);
      })
      .catch(() => {}); // pre-Phase-60 schema / offline: no stored draft
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (!open) {
    if (!hasDraft) return null;
    return (
      <div className="fixed bottom-4 right-4 z-40 flex max-w-[calc(100vw-2rem)] items-center gap-1 rounded-full border border-blue-200 bg-white py-1.5 pl-4 pr-1.5 shadow-lg">
        <FileText size={15} className="shrink-0 text-blue-600" />
        <button
          type="button"
          onClick={onResume}
          title="Saved as a draft — kept for 1 day, then deleted automatically if not submitted"
          className="min-w-0 truncate px-1 text-left text-sm font-semibold text-slate-700 hover:text-blue-700"
        >
          Unfinished Rx{patientName.trim() ? ` — ${patientName.trim()}` : ""}
          <span className="ml-1.5 text-xs font-medium text-blue-600">Resume</span>
        </button>
        {discardConfirm ? (
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => { reset(); setDiscardConfirm(false); discardRxDraft(); }}
              className="rounded-full bg-rose-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-rose-700"
            >
              Discard
            </button>
            <button type="button" onClick={() => setDiscardConfirm(false)} className="rounded-full px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100">
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setDiscardConfirm(true)}
            title="Discard this draft"
            className="shrink-0 rounded-full p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
          >
            <X size={14} />
          </button>
        )}
      </div>
    );
  }

  // Follow-up mode renders a wholly separate, isolated modal (no tooth chart /
  // pricing) — all hooks above this point run unconditionally, so this early
  // return is safe (verified: no hooks below here).
  if (formKind === "followup" && !isEditing) {
    return (
      <SectionBoundary label="The follow-up form hit a problem">
        <FollowupModal
          open
          cases={cases}
          labs={labs}
          userId={userId}
          authorName={authorName}
          defaultClinicId={defaultClinicId}
          onSubmit={onSubmitFollowup}
          onClose={onClose}
          onSwitchToNew={() => setFormKind("new")}
        />
      </SectionBoundary>
    );
  }

  /* ---------------- selection handlers ---------------- */
  const toggleTooth = (u) =>
    setSelection((prev) => {
      const next = { ...prev };
      if (next[u] === mode) delete next[u];
      else next[u] = mode;
      return next;
    });

  const toggleArch = (which) => {
    const row = which === "upper" ? UPPER_ROW : LOWER_ROW;
    const allSel = row.every((u) => selection[u]);
    setSelection((prev) => {
      const next = { ...prev };
      row.forEach((u) => (allSel ? delete next[u] : (next[u] = "unit")));
      return next;
    });
  };

  // Quick-select a whole segment. Toggles off if the group is already fully set.
  const toggleGroup = (teeth) =>
    setSelection((prev) => {
      const allSel = teeth.every((u) => prev[u]);
      const next = { ...prev };
      teeth.forEach((u) => (allSel ? delete next[u] : (next[u] = mode)));
      return next;
    });

  const selectedTeeth = Object.keys(selection)
    .map(Number)
    .sort((a, b) => a - b)
    .map((u) => ({ universal: u, fdi: UNIVERSAL_TO_FDI[u], role: selection[u] }));

  const isRefer = category === REFER_CATEGORY; // spec fields collapse to "Refer to notes"
  const isSplint = SPLINT_CATEGORIES.includes(category); // no material / shade
  const isImplant = IMPLANT_CATEGORIES.includes(category); // needs system + abutment specs

  /* ---------------- restoration cart: draft editor ---------------- */
  const toggleDraftTooth = (u) =>
    setDraft((d) => {
      const role = roleForDraftTooth(d.category, d.mode);
      const next = { ...d.selection };
      if (next[u] === role) delete next[u];
      else next[u] = role;
      return { ...d, selection: next };
    });

  const toggleDraftArch = (which) => {
    const row = which === "upper" ? UPPER_ROW : LOWER_ROW;
    setDraft((d) => {
      const role = roleForDraftTooth(d.category, d.mode);
      const allSel = row.every((u) => d.selection[u]);
      const next = { ...d.selection };
      row.forEach((u) => (allSel ? delete next[u] : (next[u] = role)));
      return { ...d, selection: next };
    });
  };

  const toggleDraftGroup = (teeth) =>
    setDraft((d) => {
      const role = roleForDraftTooth(d.category, d.mode);
      const allSel = teeth.every((u) => d.selection[u]);
      const next = { ...d.selection };
      teeth.forEach((u) => (allSel ? delete next[u] : (next[u] = role)));
      return { ...d, selection: next };
    });

  // Category select lives above the chart now (picked first), so changing
  // it needs to both reset the dependent spec fields (material/implant/etc,
  // same as onCategoryChange does for appliance mode) AND re-stamp any
  // already-selected teeth's roles to match the new category.
  const changeDraftCategory = (c) => {
    setDraft((d) => ({
      ...d,
      category: c,
      material: CATEGORIES[c].materials[0],
      stumpShade: HAS_STUMP.includes(c) ? d.stumpShade : "N/A",
      implantSystem: IMPLANT_CATEGORIES.includes(c) ? d.implantSystem : "",
      abutmentType: IMPLANT_CATEGORIES.includes(c) ? d.abutmentType : "",
      abutmentColor: IMPLANT_CATEGORIES.includes(c) ? d.abutmentColor : "",
      selection: remapSelectionForCategory(d.selection, c),
    }));
  };

  const draftTeeth = Object.keys(draft.selection)
    .map(Number)
    .sort((a, b) => a - b)
    .map((u) => ({ universal: u, fdi: UNIVERSAL_TO_FDI[u], role: draft.selection[u] }));

  // Teeth already claimed by OTHER confirmed restorations — locked in the
  // draft's chart so the same tooth can't end up in two restorations.
  const takenTeeth = new Set(
    restorations.filter((r) => r.id !== draft.id).flatMap((r) => r.teeth.map((t) => t.universal))
  );

  const draftIsImplant = IMPLANT_CATEGORIES.includes(draft.category);
  const draftErrors = [
    draftTeeth.length === 0 && "teeth",
    !draft.material && "material",
    draftIsImplant && !draft.implantSystem && "implantSystem",
    draftIsImplant && !draft.abutmentType && "abutmentType",
  ].filter(Boolean);
  const draftValid = draftErrors.length === 0;
  // An open editor with teeth already picked is unsaved work — it's lost
  // silently unless "Add to Case" is clicked, which is easy to miss since
  // the chart selection looks like progress on its own.
  const draftDirty = draftOpen && draftTeeth.length > 0;

  const openAddRestoration = () => {
    setDraft(emptyDraft());
    setDraftTouched(false);
    setDraftOpen(true);
  };

  const openEditRestoration = (r) => {
    setDraft({
      id: r.id,
      selection: Object.fromEntries(r.teeth.map((t) => [t.universal, t.role])),
      mode: "unit",
      category: r.category,
      material: r.material,
      shadeGuide: r.shadeGuide,
      vitaShade: r.vitaShade,
      stumpShade: r.stumpShade,
      implantSystem: r.implantSystem ?? "",
      abutmentType: r.abutmentType ?? "",
      abutmentColor: r.abutmentColor ?? "",
    });
    setDraftTouched(false);
    setDraftOpen(true);
  };

  const confirmDraft = () => {
    if (!draftValid) return;
    const entry = {
      id: draft.id ?? crypto.randomUUID(),
      teeth: draftTeeth,
      category: draft.category,
      material: draft.material,
      shadeGuide: draft.shadeGuide,
      vitaShade: draft.vitaShade,
      stumpShade: draft.stumpShade,
      implantSystem: draftIsImplant ? draft.implantSystem : null,
      abutmentType: draftIsImplant ? draft.abutmentType : null,
      abutmentColor: draftIsImplant ? draft.abutmentColor.trim() : null,
    };
    setRestorations((prev) => {
      const exists = prev.some((r) => r.id === entry.id);
      return exists ? prev.map((r) => (r.id === entry.id ? entry : r)) : [...prev, entry];
    });
    setJustAddedId(entry.id);
    setDraftOpen(false);
    setDraftTouched(false);
  };

  const deleteRestoration = (id) => setRestorations((prev) => prev.filter((r) => r.id !== id));

  /* ---------------- TAT auto-calculation ---------------- */
  const lab = labById[labId];
  // Procedure-specific turnaround (set by the lab in its Settings) wins over
  // the lab's standard TAT when one exists for the selected category. In
  // restorations mode the case can't be ready before its SLOWEST item, so
  // it's the max across every restoration's own procedure TAT.
  const procTat = (c) => Number(lab?.procedureTats?.[c]) || (lab?.tat ?? 0);
  const baseTat =
    caseMode === "restorations"
      ? restorations.length
        ? Math.max(...restorations.map((r) => procTat(r.category)))
        : lab?.tat ?? 0
      : procTat(category);
  const effTat = baseTat;
  const today = new Date();
  const estReady = lab ? addDays(today, effTat) : null;
  const insufficientTime =
    insertionDate && estReady && new Date(insertionDate) < new Date(iso(estReady));

  /* ---------------- category change resets dependent spec fields ---------------- */
  const onCategoryChange = (c) => {
    setCategory(c);
    // Leaving an implant category clears its specs so they can't leak onto a
    // non-implant case.
    if (!IMPLANT_CATEGORIES.includes(c)) {
      setImplantSystem("");
      setAbutmentType("");
    }
    if (c === REFER_CATEGORY) {
      // Everything is detailed in the notes → collapse the spec fields.
      setMaterial(REFER);
      setShadeGuide(REFER);
      setVitaShade(REFER);
      setStumpShade(REFER);
    } else if (SPLINT_CATEGORIES.includes(c)) {
      // Splints have no material, no tooth shade, no stump shade.
      setMaterial("");
      setShadeGuide("N/A");
      setVitaShade("N/A");
      setStumpShade("N/A");
    } else {
      setMaterial(CATEGORIES[c].materials[0]);
      // Restore real shade defaults when leaving a splint / "refer to notes" state.
      if (shadeGuide === REFER || shadeGuide === "N/A") setShadeGuide("Vita Classical");
      if (vitaShade === REFER || vitaShade === "N/A") setVitaShade("A2");
      // Implants and removables have no prep/stump shade → keep it N/A.
      if (!HAS_STUMP.includes(c) || stumpShade === REFER) setStumpShade("N/A");
    }
  };

  /* ---------------- file handling ---------------- */
  // Phase 61: STL/PDF scan files are REAL uploads now, same private bucket
  // and signed-URL rules as photos. Browsers report STL as octet-stream (or
  // nothing), so the normalized contentType from classifyRxFile is what the
  // bucket's exact mime allowlist accepts.
  const uploadOneScan = async (entryId, file) => {
    try {
      const url = await uploadCasePhoto(userId, photoGroupId, file, classifyRxFile(file.name).contentType);
      setScans((p) => p.map((s) => (s.id === entryId ? { ...s, url, uploading: false, error: null } : s)));
    } catch (err) {
      setScans((p) => p.map((s) => (s.id === entryId ? { ...s, uploading: false, error: err.message || "Upload failed" } : s)));
    }
  };
  const addScans = (fileList) => {
    const entries = Array.from(fileList).map((file) => {
      // The accept filter is off on iOS (scanPickerAccept) — gate by extension here.
      const typeOk = classifyRxFile(file.name).kind === "scan";
      return {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        name: file.name,
        size: file.size,
        url: null,
        uploading: typeOk && file.size <= SCAN_MAX_BYTES,
        error: !typeOk ? "Not an STL or PDF" : file.size > SCAN_MAX_BYTES ? "Over 50 MB" : null,
      };
    });
    setScans((p) => [...p, ...entries]);
    entries.filter((e) => e.uploading).forEach((e) => uploadOneScan(e.id, e.file));
  };
  const retryScan = (entry) => {
    setScans((p) => p.map((s) => (s.id === entry.id ? { ...s, uploading: true, error: null } : s)));
    uploadOneScan(entry.id, entry.file);
  };
  // Clinical/shade photos are REAL uploads to Supabase Storage so the lab
  // sees the actual image, not just a filename. Each file gets a local
  // object-URL thumbnail immediately, then the entry is patched in place
  // once the upload resolves (or fails, with a retry option).
  const uploadOnePhoto = async (entryId, file) => {
    try {
      const url = await uploadCasePhoto(userId, photoGroupId, file);
      setPhotos((p) => p.map((ph) => (ph.id === entryId ? { ...ph, url, uploading: false, error: null } : ph)));
    } catch (err) {
      setPhotos((p) => p.map((ph) => (ph.id === entryId ? { ...ph, uploading: false, error: err.message || "Upload failed" } : ph)));
    }
  };

  const addPhotos = (fileList) => {
    const files = Array.from(fileList);
    const entries = files.map((file) => ({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      name: file.name,
      size: file.size,
      previewUrl: URL.createObjectURL(file),
      url: null,
      uploading: true,
      error: null,
    }));
    setPhotos((p) => [...p, ...entries]);
    entries.forEach((entry) => uploadOnePhoto(entry.id, entry.file));
  };

  const retryPhoto = (entry) => {
    setPhotos((p) => p.map((ph) => (ph.id === entry.id ? { ...ph, uploading: true, error: null } : ph)));
    uploadOnePhoto(entry.id, entry.file);
  };

  const removePhoto = (id) => {
    setPhotos((p) => {
      const target = p.find((ph) => ph.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return p.filter((ph) => ph.id !== id);
    });
  };

  const photosUploading = photos.some((p) => p.uploading) || scans.some((s) => s.uploading);

  // Files that arrived from the phone via the QR session: already uploaded
  // server-side, so they enter as finished entries (same shape as edit-mode
  // rehydration) — no spinner, no retry state. Phase 61: the phone can send
  // STL/PDF too — routed into the scan list by kind.
  const addMobilePhotos = (list) => {
    const entry = (m, i) => ({
      id: `mob-${Date.now().toString(36)}-${i}`,
      name: m.name || `phone-file-${i + 1}`,
      size: m.size ?? 0,
      url: m.url,
      uploading: false,
      error: null,
    });
    const incomingPhotos = list.filter((m) => m.kind !== "scan").map(entry);
    const incomingScans = list.filter((m) => m.kind === "scan").map(entry);
    if (incomingPhotos.length) setPhotos((p) => [...p, ...incomingPhotos]);
    if (incomingScans.length) setScans((p) => [...p, ...incomingScans]);
  };

  /* ---------------- validation & submit ---------------- */
  // Appliance-mode error keys only apply outside restorations mode — a case
  // is one or the other, never both, so only one set is ever "live".
  const errors = {
    patientName: !patientName.trim(),
    labId: !labId,
    restorations: caseMode === "restorations" && restorations.length === 0,
    unsavedRestoration: draftDirty,
    // Arch-based appliances don't require marked teeth — the arch choice IS
    // the extent (a complete denture or night guard has no per-tooth marks).
    // EXCEPT the partial denture: its price is per marked tooth, so at least
    // one tooth is required.
    teeth:
      caseMode === "appliance" &&
      (!ARCH_CATEGORIES.includes(category) || category === "Removable partial denture") &&
      selectedTeeth.length === 0,
    material: caseMode === "appliance" && !isSplint && !material,
    implantSystem: caseMode === "appliance" && isImplant && !implantSystem,
    abutmentType: caseMode === "appliance" && isImplant && !abutmentType,
    insertionDate: !insertionDate,
    photosUploading,
  };
  const isValid = !Object.values(errors).some(Boolean);

  // Human-readable list of what is still missing, so the user is never left
  // guessing why the Submit button does nothing.
  const MISSING_LABEL = {
    patientName: "Patient name",
    teeth: "At least one tooth on the chart",
    labId: "Target lab",
    restorations: "At least one restoration",
    unsavedRestoration: 'Click "Add to Case" to save the restoration you started',
    material: "Material",
    implantSystem: "Implant brand",
    abutmentType: "Abutment size",
    insertionDate: "Deliver to Clinic date",
    photosUploading: "Files still uploading",
  };
  const missing = Object.entries(errors)
    .filter(([, bad]) => bad)
    .map(([k]) => MISSING_LABEL[k]);


  // `opts.share` submits and immediately opens the share panel for the new case.
  const submit = (opts = {}) => {
    setTouched(true);
    if (!isValid) return;
    const common = {
      notation,
      included,
      includedOther: includedOther.trim(),
      baseTat,
      effTat,
      estReady: estReady ? iso(estReady) : null,
      files: [
        // failed scan uploads are dropped rather than shipping a dead name
        ...scans.filter((f) => !f.error).map((f) => ({ name: f.name, size: f.size, kind: "scan", ...(f.url ? { url: f.url } : {}) })),
        ...photos.filter((f) => f.url).map((f) => ({ name: f.name, size: f.size, kind: "photo", url: f.url })),
      ],
      notes: notes.trim(),
      pickupRequested,
    };
    // Cart-mode cases carry a `restorations` array and omit the legacy flat
    // fields entirely; appliance-mode cases keep the exact original shape
    // (and so does every pre-refactor case already in production — every
    // reader downstream branches on `restorations?.length` to tell the two
    // apart, so old data keeps rendering exactly as before with no migration).
    const prescription =
      caseMode === "restorations"
        ? { ...common, restorations }
        : {
            ...common,
            teeth: selectedTeeth,
            category,
            material,
            shadeGuide,
            vitaShade,
            stumpShade,
            ...(ARCH_CATEGORIES.includes(category) ? { arches } : {}),
            implantSystem: isImplant ? implantSystem : null,
            abutmentType: isImplant ? abutmentType : null,
            abutmentColor: isImplant ? abutmentColor.trim() : null,
          };
    const payload = {
      patientName: patientName.trim(),
      patientId: patientId.trim() || "PT-NEW",
      patientPhone: patientPhone ? `+968${patientPhone}` : "",
      appointmentDate: insertionDate || "—",
      deliveryTime,
      labId,
      clinicId: selectedClinicId || defaultClinicId,
      prescription,
    };
    if (isEditing) onSaveEdit(editing.id, payload);
    else {
      onSave(payload, opts);
      discardRxDraft(); // submitted — the stored draft is obsolete
    }
    reset();
    onClose();
  };

  const err = (k) => touched && errors[k];

  /* ---------------- per-step status for the accordion ---------------- */
  const stepErrors = {
    1: ["patientName", "labId"],
    2: ["restorations", "unsavedRestoration", "teeth", "material", "implantSystem", "abutmentType"],
    3: ["insertionDate"],
  };
  const stepInvalid = (n) => stepErrors[n].some((k) => errors[k]);
  const stepComplete = (n) => !stepInvalid(n);

  const stepSummary = {
    1: [patientName || "No patient", lab?.name].filter(Boolean).join(" · "),
    2:
      caseMode === "restorations"
        ? restorations.length
          ? `${restorations.length} restoration${restorations.length === 1 ? "" : "s"} · ${restorations.reduce((n, r) => n + r.teeth.length, 0)} units`
          : "No restorations added yet"
        : [
            `${selectedTeeth.length} ${selectedTeeth.length === 1 ? "tooth" : "teeth"}`,
            category,
            material || null,
          ]
            .filter(Boolean)
            .join(" · "),
    3: [
      insertionDate || "No date",
      deliveryTime !== "Anytime" ? deliveryTime : null,
      scans.length + photos.length > 0 ? `${scans.length + photos.length} file(s)` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  };

  /* ---------------- render ---------------- */
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-5xl flex-col overflow-hidden bg-white shadow-2xl ring-1 ring-slate-200 sm:max-h-[92vh] sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-white px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-blue-700 text-white">
              <FileText size={18} />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800">
                {isEditing ? `Edit Prescription · ${editing.id}` : "Digital Laboratory Prescription"}
              </h3>
              <p className="text-[11px] text-slate-500">Phase 2 · Rx work order</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        {/* New Case vs Follow-up — hidden while editing an existing case. */}
        {!isEditing && <ModeToggle value={formKind} onChange={setFormKind} />}

        {/* Scroll body */}
        <div className="flex-1 space-y-3 overflow-x-hidden overflow-y-auto bg-slate-50/60 px-3 py-4 sm:px-5">
          {/* ---------------- STEP 1 · Patient & Lab ---------------- */}
          <Step
            n={1}
            title="Patient & Lab Details"
            subtitle="Who the case is for, and which lab receives it"
            summary={stepSummary[1]}
            open={step === 1}
            onToggle={() => setStep(step === 1 ? 0 : 1)}
            complete={stepComplete(1)}
            invalid={touched && stepInvalid(1)}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Multi-clinic: only shown once a dentist actually owns more
                  than one clinic — no clutter for the common single-clinic
                  case, where it just silently uses their default clinic. */}
              {clinics.length > 1 && !isEditing && (
                <Field label="Sending Clinic" required>
                  <select className={inputCls} value={selectedClinicId ?? ""} onChange={(e) => setSelectedClinicId(e.target.value)}>
                    {clinics.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Patient Name" required>
                <input className={`${inputCls} ${err("patientName") ? "border-rose-400 ring-rose-100" : ""}`} value={patientName} onChange={(e) => setPatientName(e.target.value)} placeholder="Full name" />
              </Field>
              {/* The lab is locked while editing: the case is already in that
                  lab's queue and they were emailed on submission — re-routing
                  a live case is a delete-and-resend, not an edit. */}
              {isEditing ? (
                <Field label="Lab">
                  <div className={`${inputCls} cursor-not-allowed bg-slate-50 text-slate-500`}>
                    {labById[labId]?.name ?? "Original lab (locked)"}
                  </div>
                </Field>
              ) : (
                <Field label="Select Lab" required>
                  {/* Phase 58: the picker follows the SENDING clinic — an
                      exclusive clinic offers only its contracted labs. */}
                  <LabPicker
                    labs={labs.filter((l) => labAllowed(l.id, selectedClinicId || defaultClinicId))}
                    value={labId}
                    onChange={setLabId}
                    clinicGov={clinics.find((c) => c.id === (selectedClinicId || defaultClinicId))?.governorate || ""}
                    invalid={!!err("labId")}
                  />
                </Field>
              )}
            </div>

            {/* Patient ID / WhatsApp are optional and tucked away by default so
                the form reads as two fields, not four. */}
            {showPatientExtras ? (
              <div className="mt-3 grid grid-cols-1 gap-3 border-t border-dashed border-slate-200 pt-3 sm:grid-cols-2">
                <Field label="Patient ID">
                  <input className={inputCls} value={patientId} onChange={(e) => setPatientId(e.target.value)} placeholder="PT-00000" />
                </Field>
                <Field label="Patient WhatsApp" hint="Optional · to share the Rx PDF">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-500">+968</span>
                    <input
                      className={inputCls}
                      value={patientPhone}
                      onChange={(e) => setPatientPhone(e.target.value.replace(/\D/g, "").slice(0, 8))}
                      placeholder="9XXXXXXX"
                      inputMode="numeric"
                    />
                  </div>
                </Field>
                <button
                  type="button"
                  onClick={() => setShowPatientExtras(false)}
                  className="flex w-fit items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-600 sm:col-span-2"
                >
                  <ChevronDown size={13} className="rotate-180" /> Hide
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowPatientExtras(true)}
                className="mt-3 flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
              >
                <Plus size={13} /> Add patient ID or WhatsApp <span className="font-normal text-slate-400">(optional)</span>
              </button>
            )}
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => setStep(2)} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                Next · Clinical <ChevronDown size={15} className="-rotate-90" />
              </button>
            </div>
          </Step>

          {/* ---------------- STEP 2 · Clinical parameters ---------------- */}
          <Step
            n={2}
            title="Clinical Parameters"
            subtitle="What is included, which teeth, and the restoration spec"
            summary={stepSummary[2]}
            open={step === 2}
            onToggle={() => setStep(step === 2 ? 0 : 2)}
            complete={stepComplete(2)}
            invalid={touched && stepInvalid(2)}
          >
          {/* Included — what physically goes to the lab with this case */}
          <section className="mb-6">
            <SectionHeader icon={PackageCheck} n="a" title="Included" subtitle="Tick everything being sent to the lab with this case" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Items sent with the case" hint="Choose as many as apply">
                <MultiSelect
                  options={INCLUDED_ITEMS}
                  selected={included}
                  onToggle={toggleIncluded}
                  placeholder="Select items…"
                />
              </Field>
              <Field label="Others" hint="Anything not listed above">
                <input
                  className={inputCls}
                  value={includedOther}
                  onChange={(e) => setIncludedOther(e.target.value)}
                  placeholder="Type anything else sent…"
                />
              </Field>
            </div>
          </section>

          {/* Case type — a case is EITHER several independent fixed
              restorations OR one whole-case appliance, never both */}
          <section className="mb-6">
            <SectionHeader icon={Layers} n="b" title="Case Type" subtitle="Fixed restorations are added one by one; appliances are a single item" />
            <div className="flex w-fit overflow-hidden rounded-lg border border-slate-300">
              <button
                type="button"
                onClick={() => { setCaseMode("restorations"); setDraftOpen(false); }}
                className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold transition ${caseMode === "restorations" ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                <Layers3 size={14} /> Fixed Restoration(s)
              </button>
              <button
                type="button"
                onClick={() => {
                  setCaseMode("appliance");
                  setDraftOpen(false);
                  if (!APPLIANCE_CATEGORIES.includes(category)) onCategoryChange(APPLIANCE_CATEGORIES[0]);
                  // Veneer isn't offered here, so demote any tooth already
                  // marked as one rather than leaving an unreachable state.
                  if (mode === "veneer") setMode("unit");
                  setSelection((prev) =>
                    Object.fromEntries(Object.entries(prev).map(([u, role]) => [u, role === "veneer" ? "unit" : role]))
                  );
                }}
                className={`px-3.5 py-2 text-xs font-semibold transition ${caseMode === "appliance" ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                Appliance / Removable / Splint
              </button>
            </div>
          </section>

          {caseMode === "restorations" ? (
            /* ---------------- Restorations cart ---------------- */
            <section>
              <div className="mb-4 flex items-center justify-between">
                <SectionHeader icon={Layers3} n="c" title="Restorations" subtitle="Add each restoration independently — its own teeth, material and shade" />
                {!draftOpen && (
                  <button
                    type="button"
                    onClick={openAddRestoration}
                    className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                  >
                    <Plus size={14} /> Add Restoration
                  </button>
                )}
              </div>

              {restorations.length === 0 && !draftOpen && (
                <div className={`rounded-lg border border-dashed px-4 py-6 text-center text-xs ${err("restorations") ? "border-rose-300 bg-rose-50 text-rose-600" : "border-slate-300 bg-slate-50 text-slate-400"}`}>
                  {err("restorations") ? "Add at least one restoration to continue." : "No restorations added yet."}
                </div>
              )}

              {restorations.length > 0 && (
                <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {restorations.map((r) => (
                    <RestorationCard key={r.id} r={r} notation={notation} justAdded={r.id === justAddedId} onEdit={() => openEditRestoration(r)} onDelete={() => deleteRestoration(r.id)} />
                  ))}
                </div>
              )}

              {draftOpen && (
                <div className="rounded-xl border-2 border-blue-200 bg-blue-50/40 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h5 className="text-sm font-bold text-slate-800">{draft.id ? "Edit Restoration" : "New Restoration"}</h5>
                      <div className="flex overflow-hidden rounded-lg border border-slate-300">
                        {["FDI", "Universal"].map((nn) => (
                          <button key={nn} type="button" onClick={() => setNotation(nn)} className={`px-2.5 py-1 text-[11px] font-semibold transition ${notation === nn ? "bg-slate-800 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
                            {nn}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button type="button" onClick={() => setDraftOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                      <X size={16} />
                    </button>
                  </div>

                  {/* Category first — everything after (chart mode, then
                      material/shade/implant fields) depends on it */}
                  <div className="mb-3">
                    <Field label="Restoration Type" required>
                      <select className={inputCls} value={draft.category} onChange={(e) => changeDraftCategory(e.target.value)}>
                        {RESTORATION_CATEGORIES.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </Field>
                  </div>

                  <ToothChart
                    notation={notation}
                    selection={draft.selection}
                    mode={draft.mode}
                    setMode={(m) => updateDraft({ mode: m })}
                    onToggle={toggleDraftTooth}
                    onArch={toggleDraftArch}
                    onClear={() => updateDraft({ selection: {} })}
                    onGroup={toggleDraftGroup}
                    disabled={takenTeeth}
                    modes={
                      BRIDGE_CATEGORIES.includes(draft.category)
                        ? [
                            { k: "unit", txt: "Abutment", on: "bg-blue-600 text-white", swatch: "bg-blue-600" },
                            { k: "pontic", txt: "Pontic", on: "bg-amber-500 text-white", swatch: "border border-dashed border-amber-600 bg-amber-500" },
                          ]
                        : []
                    }
                  />
                  <div className={`mb-3 mt-2 rounded-lg px-3 py-2 text-xs ${draftTouched && draftErrors.includes("teeth") ? "bg-rose-50 text-rose-600" : "bg-white text-slate-600"}`}>
                    {draftTeeth.length === 0
                      ? draftTouched && draftErrors.includes("teeth")
                        ? "Select at least one tooth for this restoration."
                        : `Tap teeth for this ${draft.category.toLowerCase()} — material and shade appear once at least one is picked.`
                      : `${draftTeeth.length} unit${draftTeeth.length > 1 ? "s" : ""} selected: ${draftTeeth
                          .map((t) => `${notation === "FDI" ? t.fdi : t.universal}${t.role === "pontic" ? " (pontic)" : ""}`)
                          .join(", ")}`}
                  </div>

                  {draftTeeth.length > 0 && <RestorationFields draft={draft} onChange={updateDraft} errors={draftTouched ? draftErrors : []} />}

                  {/* Selecting teeth looks like progress, but nothing is
                      stored until this button is pressed — so say so loudly
                      the moment there's something to lose. */}
                  {draftDirty && (
                    <div className="mt-3 flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
                      <AlertTriangle size={13} className="mt-px shrink-0" />
                      <span>
                        Not saved yet — {draftTeeth.length} tooth{draftTeeth.length === 1 ? "" : "/teeth"} selected.
                        Press <b>{draft.id ? "Save Changes" : "Add to Case"}</b> below or this restoration is discarded.
                      </span>
                    </div>
                  )}

                  <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
                    <button type="button" onClick={() => setDraftOpen(false)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 sm:order-1 sm:py-1.5">
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDraftTouched(true);
                        confirmDraft();
                      }}
                      className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white sm:order-2 sm:py-1.5 ${
                        draftDirty
                          ? "animate-pulse bg-rose-600 ring-2 ring-rose-300 hover:animate-none hover:bg-rose-700"
                          : "bg-blue-600 hover:bg-blue-700"
                      }`}
                    >
                      <Check size={13} /> {draft.id ? "Save Changes" : "Add to Case"}
                    </button>
                  </div>
                </div>
              )}
            </section>
          ) : (
            <>
              {/* ---------------- Appliance mode: unchanged from before ---------------- */}
              <section className="mb-6">
                <div className="mb-4 flex items-center justify-between">
                  <SectionHeader icon={ScanLine} n="c" title="Tooth Selection" subtitle="Tap teeth, or use a quick-select group" />
                  <div className="flex overflow-hidden rounded-lg border border-slate-300">
                    {["FDI", "Universal"].map((nn) => (
                      <button key={nn} type="button" onClick={() => setNotation(nn)} className={`px-3 py-1.5 text-xs font-semibold transition ${notation === nn ? "bg-slate-800 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
                        {nn}
                      </button>
                    ))}
                  </div>
                </div>
                {/* No "Veneer" marking here — a veneer is a fixed
                    restoration, meaningless on a denture or splint. */}
                <ToothChart
                  notation={notation}
                  selection={selection}
                  mode={mode}
                  setMode={setMode}
                  onToggle={toggleTooth}
                  onArch={toggleArch}
                  onClear={() => setSelection({})}
                  onGroup={toggleGroup}
                  modes={APPLIANCE_TOOTH_MODES}
                />
                <div className={`mt-3 rounded-lg px-3 py-2 text-xs ${err("teeth") ? "bg-rose-50 text-rose-600" : "bg-slate-50 text-slate-600"}`}>
                  {selectedTeeth.length === 0 ? (
                    err("teeth") ? "Select at least one tooth." : "No teeth selected yet."
                  ) : (
                    <span>
                      <span className="font-semibold">{selectedTeeth.length} unit{selectedTeeth.length > 1 ? "s" : ""}:</span>{" "}
                      {selectedTeeth
                        .map((t) => {
                          const n = notation === "FDI" ? t.fdi : t.universal;
                          return `${n}${t.role === "pontic" ? " (pontic)" : t.role === "veneer" ? " (veneer)" : ""}`;
                        })
                        .join(", ")}
                    </span>
                  )}
                </div>
              </section>

              <section>
                <SectionHeader icon={Layers} n="d" title="Work Order & Materials" subtitle="Restoration category drives the material menu" />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Appliance Type" required>
                    <select className={inputCls} value={category} onChange={(e) => onCategoryChange(e.target.value)}>
                      {APPLIANCE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </Field>
                  {ARCH_CATEGORIES.includes(category) && (
                    <Field label="Arch" required hint="Which jaw is this appliance for?">
                      <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
                        {[["upper", "Upper"], ["lower", "Lower"], ["both", "Both"]].map(([id, label]) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setArches(id)}
                            className={`rounded-lg px-2 py-2 text-sm font-semibold transition ${
                              arches === id ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </Field>
                  )}
                  {!isSplint && (
                    <Field label="Material" required>
                      {isRefer ? (
                        <input className={inputCls} value={REFER} disabled readOnly />
                      ) : (
                        <select className={inputCls} value={material} onChange={(e) => setMaterial(e.target.value)}>
                          {CATEGORIES[category].materials.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      )}
                    </Field>
                  )}
                  {!SPLINT_CATEGORIES.includes(category) && (
                    <>
                      <Field label="Shade Guide">
                        {isRefer ? (
                          <input className={inputCls} value={REFER} disabled readOnly />
                        ) : (
                          <select
                            className={inputCls}
                            value={shadeGuide}
                            onChange={(e) => {
                              setShadeGuide(e.target.value);
                              setVitaShade(e.target.value === SHADE_BY_LAB ? SHADE_BY_LAB : SHADE_GUIDES[e.target.value][0]);
                            }}
                          >
                            {SHADE_GUIDE_NAMES.map((g) => (
                              <option key={g} value={g}>{g}</option>
                            ))}
                          </select>
                        )}
                      </Field>
                      {isRefer ? (
                        <Field label="Shade">
                          <input className={inputCls} value={REFER} disabled readOnly />
                        </Field>
                      ) : (
                        shadeGuide !== SHADE_BY_LAB && (
                          <Field label="Shade">
                            <select className={inputCls} value={vitaShade} onChange={(e) => setVitaShade(e.target.value)}>
                              {SHADE_GUIDES[shadeGuide].map((s) => (
                                <option key={s} value={s}>{s}</option>
                              ))}
                            </select>
                          </Field>
                        )
                      )}
                    </>
                  )}
                </div>
              </section>
            </>
          )}
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => setStep(3)} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                Next · Logistics <ChevronDown size={15} className="-rotate-90" />
              </button>
            </div>
          </Step>

          {/* ---------------- STEP 3 · Logistics & attachments ---------------- */}
          <Step
            n={3}
            title="Logistics & Attachments"
            subtitle="Delivery, express handling, scans and instructions"
            summary={stepSummary[3]}
            open={step === 3}
            onToggle={() => setStep(step === 3 ? 0 : 3)}
            complete={stepComplete(3)}
            invalid={touched && stepInvalid(3)}
          >
          <section>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Deliver to Clinic on" required>
                {/* iOS shows no hint text inside an empty date input (and the
                    appearance reset removed even the grey dd/mm/yyyy), so an
                    empty field read as a weird blank bar that was easy to
                    miss entirely. While empty: blue-highlighted with an
                    explicit "tap to pick" prompt overlaid; the overlay hides
                    on focus so desktop keyboard entry stays visible. */}
                <div className="relative">
                  <input
                    type="date"
                    required
                    className={`peer ${inputCls} min-h-[42px] ${
                      err("insertionDate")
                        ? "border-rose-400 ring-rose-100"
                        : !insertionDate
                        ? "border-blue-400 bg-blue-50/60 ring-2 ring-blue-100"
                        : ""
                    }`}
                    value={insertionDate}
                    onChange={(e) => setInsertionDate(e.target.value)}
                  />
                  {!insertionDate && (
                    <span
                      className={`pointer-events-none absolute inset-0 flex items-center gap-1.5 rounded-lg px-3 text-base font-medium peer-focus:hidden sm:text-sm ${
                        err("insertionDate") ? "bg-rose-50 text-rose-600" : "bg-blue-50 text-blue-600"
                      }`}
                    >
                      <Calendar size={15} /> Tap to pick a delivery date
                    </span>
                  )}
                </div>
              </Field>
              <Field label="Preferred Delivery Time">
                <select className={inputCls} value={deliveryTime} onChange={(e) => setDeliveryTime(e.target.value)}>
                  {DELIVERY_TIMES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Lab Pick-up">
                <button
                  type="button"
                  onClick={() => setPickupRequested((v) => !v)}
                  aria-pressed={pickupRequested}
                  className={`flex min-h-[42px] w-full items-center gap-2 rounded-lg border px-3 text-left text-base font-medium transition sm:text-sm ${
                    pickupRequested
                      ? "border-blue-400 bg-blue-50 text-blue-700 ring-2 ring-blue-100"
                      : "border-slate-300 bg-white text-slate-500 hover:border-slate-400"
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                      pickupRequested ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white"
                    }`}
                  >
                    {pickupRequested && <Check size={11} />}
                  </span>
                  <Truck size={15} className="shrink-0" />
                  Request a lab pick-up
                </button>
              </Field>
            </div>

          </section>

          {/* Attachments & notes */}
          <section className="mt-6">
            <SectionHeader icon={Upload} n="b" title="Digital Attachments & Notes" subtitle="Attach intraoral scans and clinical/shade photos for the lab" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* STL scans + PDFs — real uploads since Phase 61 */}
              <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700"><ScanLine size={16} className="text-blue-600" /> Scans &amp; Documents (STL / PDF)</div>
                <span className="flex flex-wrap items-center gap-3">
                  <label className="flex cursor-pointer items-center gap-1 text-xs font-semibold text-blue-600 hover:underline">
                    <Plus size={13} /> Add STL / PDF file
                    <input type="file" accept={scanPickerAccept()} multiple className="hidden" onChange={(e) => { addScans(e.target.files); e.target.value = ""; }} />
                  </label>
                  {/* Same QR session as the photos card — the phone page's
                      STL/PDF picker routes kind=scan entries back here. */}
                  {!isMobileDevice() && (
                    <button type="button" onClick={() => setQrOpen(true)} className="flex items-center gap-1 text-xs font-semibold text-violet-600 hover:underline">
                      <Smartphone size={13} /> From phone (QR)
                    </button>
                  )}
                </span>
                <ul className="mt-3 space-y-1.5">
                  {scans.length === 0 && <li className="text-[11px] text-slate-400">No files attached — up to 50 MB each.</li>}
                  {scans.map((f) => (
                    <li key={f.id ?? f.name} className="flex items-center justify-between rounded-md bg-white px-2.5 py-1.5 text-xs ring-1 ring-slate-200">
                      <span className="flex min-w-0 items-center gap-1.5 text-slate-700">
                        {/\.pdf$/i.test(f.name) ? <FileText size={13} className="shrink-0 text-rose-500" /> : <ScanLine size={13} className="shrink-0 text-blue-500" />}
                        <span className="truncate">{f.name}</span>
                      </span>
                      <span className="ml-2 flex shrink-0 items-center gap-2">
                        {f.uploading ? (
                          <Loader2 size={12} className="animate-spin text-blue-500" />
                        ) : f.error ? (
                          <span className="flex items-center gap-1 font-semibold text-rose-600">
                            {f.error}
                            {f.file && f.size <= SCAN_MAX_BYTES && (
                              <button type="button" onClick={() => retryScan(f)} className="underline">Retry</button>
                            )}
                          </span>
                        ) : (
                          <span className="text-slate-400">{fmtSize(f.size)}</span>
                        )}
                        <button type="button" onClick={() => setScans((p) => p.filter((s) => s !== f))} className="text-slate-400 hover:text-rose-500"><Trash2 size={13} /></button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Shade photos — real uploads, multiple at once, camera on mobile */}
              <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-700"><ImageIcon size={16} className="text-violet-600" /> Clinical / Shade Photos</div>
                  {photos.length > 0 && <span className="text-[11px] font-medium text-slate-400">{photos.length} photo{photos.length !== 1 ? "s" : ""}</span>}
                </div>
                <span className="flex flex-wrap items-center gap-3">
                  <label className="flex cursor-pointer items-center gap-1 text-xs font-semibold text-blue-600 hover:underline">
                    <Plus size={13} /> Add photos
                    {/* No `capture` attribute — that forces mobile browsers straight
                        into the camera, skipping the "Camera or Photo Library"
                        chooser. Plain accept="image/*" gives the normal picker. */}
                    <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }} />
                  </label>
                  {!isMobileDevice() && (
                    <button type="button" onClick={() => setQrOpen(true)} className="flex items-center gap-1 text-xs font-semibold text-violet-600 hover:underline">
                      <Smartphone size={13} /> From phone (QR)
                    </button>
                  )}
                </span>
                <MobilePhotoQR open={qrOpen ? photoGroupId : false} onClose={() => setQrOpen(false)} onPhotos={addMobilePhotos} />
                {photos.length === 0 ? (
                  <p className="mt-3 text-[11px] text-slate-400">No photos attached — the lab only sees what's uploaded here.</p>
                ) : (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {photos.map((f) => (
                      <div key={f.id} className="group relative aspect-square overflow-hidden rounded-lg bg-slate-200 ring-1 ring-slate-200">
                        <SignedImage url={f.url || f.previewUrl} alt={f.name} className="h-full w-full object-cover" />
                        {f.uploading && (
                          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/50">
                            <Loader2 size={18} className="animate-spin text-white" />
                          </div>
                        )}
                        {f.error && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-rose-900/70 px-1 text-center">
                            <AlertTriangle size={14} className="text-white" />
                            <button type="button" onClick={() => retryPhoto(f)} className="flex items-center gap-1 rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 hover:bg-white">
                              <RotateCcw size={10} /> Retry
                            </button>
                          </div>
                        )}
                        {/* Always visible, not hover-gated — a hover-only reveal
                            is invisible and unusable on a touch-only device
                            (iPad, phone) with no mouse to hover with. */}
                        <button
                          type="button"
                          onClick={() => removePhoto(f.id)}
                          className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-slate-900/70 text-white transition hover:bg-slate-900/90"
                          title="Remove"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-3">
              <Field label="Special Instructions">
                <textarea rows={3} className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Contacts, contour, staining, occlusal scheme, delivery notes…" />
              </Field>
            </div>
          </section>
          </Step>
        </div>

        {/* Sticky summary + action bar — always in reach, never scrolls away */}
        <div className={`border-t ${touched && !isValid ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-white"}`}>
          {/* live order summary */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 px-4 py-2 text-[11px] sm:px-6">
            {caseMode === "restorations" ? (
              <>
                <span className="flex items-center gap-1 font-semibold text-slate-700">
                  <ScanLine size={12} className="text-slate-400" />
                  {restorations.reduce((n, r) => n + r.teeth.length, 0)} units
                </span>
                <span className="text-slate-400">·</span>
                <span className="min-w-0 truncate text-slate-600">
                  {restorations.length ? `${restorations.length} restoration${restorations.length === 1 ? "" : "s"}: ${restorations.map((r) => r.category).join(", ")}` : "No restorations yet"}
                </span>
              </>
            ) : (
              <>
                <span className="flex items-center gap-1 font-semibold text-slate-700">
                  <ScanLine size={12} className="text-slate-400" />
                  {selectedTeeth.length} {selectedTeeth.length === 1 ? "unit" : "units"}
                </span>
                <span className="text-slate-400">·</span>
                <span className="min-w-0 truncate text-slate-600">{category}{material ? ` — ${material}` : ""}</span>
                {vitaShade && vitaShade !== "N/A" && vitaShade !== REFER && (
                  <>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-600">Shade {vitaShade}</span>
                  </>
                )}
              </>
            )}
            <span className="ml-auto flex shrink-0 items-center gap-3">
              {/* Always mounted, visibility-toggled: unmounting/remounting this
                  span next to translated siblings is exactly the DOM shuffle
                  that crashed React under browser page-translation. */}
              <span
                className={`items-center gap-1 font-semibold text-emerald-700 ${expectedPrice != null ? "flex" : "hidden"}`}
                title="Expected price from your price agreement with this lab — the lab may adjust the final amount"
              >
                <Banknote size={12} className="text-emerald-500" />
                <span>~{expectedPrice != null ? Number(expectedPrice).toLocaleString(undefined, { maximumFractionDigits: 3 }) : ""} OMR</span>
              </span>
              <span className={`flex items-center gap-1 font-semibold ${insufficientTime ? "text-rose-600" : "text-slate-700"}`}>
                <Calendar size={12} className="text-slate-400" />
                Ready {estReady ? iso(estReady) : "—"}
              </span>
            </span>
          </div>

          {/* actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            {touched && !isValid ? (
              <div className="flex items-start gap-1.5 text-xs text-rose-700">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  <b>Can't submit yet</b> — still needed: {missing.join(", ")}.
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <Info size={13} />
                {isEditing
                  ? "Changes go straight to the lab's live case."
                  : isValid
                    ? "Ready to submit to lab queue."
                    : "Complete required fields (*) to submit."}
              </div>
            )}
            {/* Stacked full-width on phones (three inline buttons overflow a
                320px viewport), inline once there's room. */}
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <button
                type="button"
                onClick={() => submit()}
                className={`flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white sm:order-2 sm:py-2 ${isValid ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-300 cursor-not-allowed"}`}
              >
                <Check size={15} /> {isEditing ? "Save Changes" : "Submit Prescription"}
              </button>
              {!isEditing && (
                <button
                  type="button"
                  onClick={() => submit({ share: true })}
                  title="Save the case and immediately share the Rx PDF with the patient"
                  className={`flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white sm:order-3 sm:py-2 ${isValid ? "bg-emerald-600 hover:bg-emerald-700" : "bg-slate-300 cursor-not-allowed"}`}
                >
                  <MessageCircle size={15} /> Submit &amp; Share
                </button>
              )}
              <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 sm:order-1 sm:py-2">
                Cancel
              </button>
              {/* Cancel keeps the draft (it minimizes to a pill); Discard
                  actually throws the started prescription away. */}
              {!isEditing && hasDraft && (
                discardConfirm ? (
                  <span className="flex items-center justify-center gap-1 sm:order-0">
                    <button
                      type="button"
                      onClick={() => { reset(); onClose(); discardRxDraft(); }}
                      className="rounded-lg bg-rose-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-rose-700 sm:py-2"
                    >
                      Discard
                    </button>
                    <button type="button" onClick={() => setDiscardConfirm(false)} className="rounded-lg px-2.5 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-100 sm:py-2">
                      Keep
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setDiscardConfirm(true)}
                    className="flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-semibold text-rose-600 hover:bg-rose-50 sm:order-0 sm:py-2"
                  >
                    <Trash2 size={14} /> Discard draft
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
