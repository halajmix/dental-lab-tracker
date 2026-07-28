import React, { useMemo, useState } from "react";
import {
  X,
  Check,
  FileText,
  Upload,
  Image as ImageIcon,
  Trash2,
  Zap,
  Calendar,
  Building2,
  Layers,
  Palette,
  AlertTriangle,
  Info,
  Sparkles,
  Clock,
  ScanLine,
  DollarSign,
} from "lucide-react";
import { caseFee } from "./Analytics.jsx";

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
  "Crown / bridge - tooth": {
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
  "Crown / bridge - implant": {
    materials: ["Zirconia", "E.max", "PFM", "PMMA", "Zirconia with metal bar"],
  },
  "Removable denture": {
    materials: [
      "Cobalt-Chrome RPD Framework",
      "Acrylic Complete Denture",
      "Removable Partial Denture - Acrylic (with clasps)",
      "Removable Partial Denture - Acrylic (no clasps)",
      "Acrylic Overdenture",
      "Flexible Partial (Nylon / Valplast)",
      "Cast Metal Partial",
      "Immediate Denture",
    ],
  },
  "Orthodontics splint": { materials: [] },
  "Single layer splint - soft": { materials: [] },
  "Double layer splint - soft": { materials: [] },
  "Double layer splint - outer hard, inner soft": { materials: [] },
  "Michigan splint": { materials: [] },
  "Others - refer to notes": { materials: ["Refer to notes"] },
};

// Crown/bridge categories where pontic design is relevant (when pontics selected).
const BRIDGE_CATEGORIES = ["Crown / bridge - tooth", "Crown / bridge - implant"];
// Only natural-tooth crowns/bridges have a prepared die → a stump shade.
const HAS_STUMP = ["Crown / bridge - tooth"];
// Splints are clear/acrylic appliances → no tooth shade or shade guide.
const SPLINT_CATEGORIES = [
  "Orthodontics splint",
  "Single layer splint - soft",
  "Double layer splint - soft",
  "Double layer splint - outer hard, inner soft",
  "Michigan splint",
];
const CATEGORY_NAMES = Object.keys(CATEGORIES);

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
const SHADE_GUIDE_NAMES = Object.keys(SHADE_GUIDES);

const STUMP_SHADES = ["N/A", "ND1", "ND2", "ND3", "ND4", "ND5", "ND6", "ND7", "ND8", "ND9"];


// When the category is "Others - refer to notes", spec fields collapse to this.
const REFER = "Refer to notes";
const REFER_CATEGORY = "Others - refer to notes";
const PONTIC_DESIGNS = ["Modified Ridge Lap", "Ovate", "Sanitary / Hygienic", "Conical", "Ridge Lap (Full)"];

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
  const parts = prescription.teeth.map(
    (t) => `${n === "FDI" ? t.fdi : t.universal}${t.role === "pontic" ? "(p)" : ""}`
  );
  return parts.join(", ");
}

/* ================================================================== */
/*  Interactive Tooth Chart                                            */
/* ================================================================== */

const TOOTH_W = 30;
const STEP = 37;
const MARGIN_X = 26;
const MIDGAP = 20;
const colX = (i) => MARGIN_X + i * STEP + (i >= 8 ? MIDGAP : 0);
const CHART_W = colX(15) + TOOTH_W + MARGIN_X;

function ToothChart({ notation, selection, mode, setMode, onToggle, onArch, onClear }) {
  const rows = [
    { key: "upper", teeth: UPPER_ROW, y: 34 },
    { key: "lower", teeth: LOWER_ROW, y: 150 },
  ];

  const isSel = (u) => !!selection[u];

  // Contiguous selected spans (per row) → draw a connector bar behind them.
  const spans = [];
  rows.forEach((row) => {
    let start = null;
    row.teeth.forEach((u, i) => {
      const sel = isSel(u);
      if (sel && start === null) start = i;
      const atEnd = i === row.teeth.length - 1;
      const next = !atEnd && isSel(row.teeth[i + 1]);
      if (sel && (atEnd || !next)) {
        if (i > start) spans.push({ y: row.y, x1: colX(start), x2: colX(i) + TOOTH_W });
        start = null;
      }
    });
  });

  const upperAllSelected = UPPER_ROW.every((u) => isSel(u));
  const lowerAllSelected = LOWER_ROW.every((u) => isSel(u));

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-slate-300">
          {[
            { k: "unit", txt: "Unit / Crown", on: "bg-blue-600 text-white" },
            { k: "pontic", txt: "Pontic", on: "bg-amber-500 text-white" },
          ].map((m) => (
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

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
        <svg viewBox={`0 0 ${CHART_W} 210`} className="w-full select-none" style={{ maxHeight: 260 }}>
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
              const role = selection[u]; // undefined | 'unit' | 'pontic'
              const x = colX(i);
              const fill = role === "unit" ? "#2563eb" : role === "pontic" ? "#f59e0b" : "#f8fafc";
              const stroke = role === "unit" ? "#1d4ed8" : role === "pontic" ? "#d97706" : "#cbd5e1";
              const textFill = role ? "#ffffff" : "#475569";
              const tt = toothType(u);
              // crown height varies slightly by type for a chart-like feel
              const h = tt === "molar" ? 56 : tt === "premolar" ? 52 : 48;
              const yTop = row.y + (60 - h) / 2;
              return (
                <g key={u} className={`tooth-hit ${role ? "" : "tooth-empty"}`} onClick={() => onToggle(u)}>
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
                    strokeDasharray={role === "pontic" ? "3 2" : "none"}
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
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-blue-600" /> Unit / Crown</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm border border-dashed border-amber-600 bg-amber-500" /> Pontic</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-blue-500/20" /> Bridge span</span>
        <span className="ml-auto font-medium text-slate-600">{notation} notation</span>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Small field helpers                                                */
/* ================================================================== */

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400";

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

/* ================================================================== */
/*  Digital Laboratory Prescription Form                               */
/* ================================================================== */

export default function PrescriptionForm({ open, onClose, labs, onSave }) {
  const [notation, setNotation] = useState("FDI");
  const [mode, setMode] = useState("unit");
  const [selection, setSelection] = useState({}); // { universal: 'unit'|'pontic' }

  const [patientName, setPatientName] = useState("");
  const [patientId, setPatientId] = useState("");
  const [patientPhone, setPatientPhone] = useState("");

  const [category, setCategory] = useState("Crown / bridge - tooth");
  const [material, setMaterial] = useState(CATEGORIES["Crown / bridge - tooth"].materials[0]);
  const [shadeGuide, setShadeGuide] = useState("Vita Classical");
  const [vitaShade, setVitaShade] = useState("A2");
  const [stumpShade, setStumpShade] = useState("N/A");
  const [ponticDesign, setPonticDesign] = useState(PONTIC_DESIGNS[0]);

  const [labId, setLabId] = useState("");
  const [rush, setRush] = useState(false);
  const [insertionDate, setInsertionDate] = useState("");

  const [scans, setScans] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [notes, setNotes] = useState("");

  const [touched, setTouched] = useState(false);

  const labById = useMemo(() => Object.fromEntries(labs.map((l) => [l.id, l])), [labs]);

  if (!open) return null;

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

  const selectedTeeth = Object.keys(selection)
    .map(Number)
    .sort((a, b) => a - b)
    .map((u) => ({ universal: u, fdi: UNIVERSAL_TO_FDI[u], role: selection[u] }));

  const hasPontics = selectedTeeth.some((t) => t.role === "pontic");
  const isRefer = category === REFER_CATEGORY; // spec fields collapse to "Refer to notes"
  const isSplint = SPLINT_CATEGORIES.includes(category); // no material / shade

  /* ---------------- TAT auto-calculation ---------------- */
  const lab = labById[labId];
  const baseTat = lab?.tat ?? 0;
  const effTat = rush ? Math.max(1, Math.ceil(baseTat / 2)) : baseTat;
  const today = new Date();
  const estReady = lab ? addDays(today, effTat) : null;
  const insufficientTime =
    insertionDate && estReady && new Date(insertionDate) < new Date(iso(estReady));

  // Live fee preview (base + express surcharge from the selected lab).
  const fee = caseFee({ labId, prescription: { category, teeth: selectedTeeth, rush } }, labs);

  /* ---------------- category change resets dependent spec fields ---------------- */
  const onCategoryChange = (c) => {
    setCategory(c);
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

  /* ---------------- file handling (simulated) ---------------- */
  const addFiles = (fileList, setter) => {
    const arr = Array.from(fileList).map((f) => ({ name: f.name, size: f.size }));
    setter((prev) => [...prev, ...arr]);
  };
  const addSampleScan = () =>
    setScans((p) => [...p, { name: `IOS_scan_${p.length + 1}.stl`, size: 4_800_000 + p.length * 512_000 }]);

  /* ---------------- validation & submit ---------------- */
  const errors = {
    patientName: !patientName.trim(),
    teeth: selectedTeeth.length === 0,
    labId: !labId,
    material: !isSplint && !material,
  };
  const isValid = !Object.values(errors).some(Boolean);

  // Human-readable list of what is still missing, so the user is never left
  // guessing why the Submit button does nothing.
  const MISSING_LABEL = {
    patientName: "Patient name",
    teeth: "At least one tooth on the chart",
    labId: "Target lab",
    material: "Material",
  };
  const missing = Object.entries(errors)
    .filter(([, bad]) => bad)
    .map(([k]) => MISSING_LABEL[k]);

  const reset = () => {
    setNotation("FDI"); setMode("unit"); setSelection({});
    setPatientName(""); setPatientId(""); setPatientPhone("");
    setCategory("Crown / bridge - tooth"); setMaterial(CATEGORIES["Crown / bridge - tooth"].materials[0]);
    setShadeGuide("Vita Classical"); setVitaShade("A2"); setStumpShade("N/A");
    setPonticDesign(PONTIC_DESIGNS[0]);
    setLabId(""); setRush(false); setInsertionDate("");
    setScans([]); setPhotos([]); setNotes(""); setTouched(false);
  };

  const submit = () => {
    setTouched(true);
    if (!isValid) return;
    const prescription = {
      notation,
      teeth: selectedTeeth,
      category,
      material,
      shadeGuide,
      vitaShade,
      stumpShade,
      ponticDesign: BRIDGE_CATEGORIES.includes(category) && hasPontics ? ponticDesign : null,
      rush,
      baseTat,
      effTat,
      estReady: estReady ? iso(estReady) : null,
      files: [...scans.map((f) => ({ ...f, kind: "scan" })), ...photos.map((f) => ({ ...f, kind: "photo" }))],
      notes: notes.trim(),
    };
    onSave({
      patientName: patientName.trim(),
      patientId: patientId.trim() || "PT-NEW",
      patientPhone: patientPhone.trim(),
      appointmentDate: insertionDate || "—",
      labId,
      prescription,
    });
    reset();
    onClose();
  };

  const err = (k) => touched && errors[k];

  /* ---------------- render ---------------- */
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-5xl flex-col overflow-hidden bg-white shadow-2xl ring-1 ring-slate-200 sm:max-h-[92vh] sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-white px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-blue-700 text-white">
              <FileText size={18} />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800">Digital Laboratory Prescription</h3>
              <p className="text-[11px] text-slate-500">Phase 2 · Rx work order</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        {/* Scroll body */}
        <div className="flex-1 space-y-8 overflow-y-auto px-6 py-6">
          {/* Patient */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Patient Name" required>
              <input className={`${inputCls} ${err("patientName") ? "border-rose-400 ring-rose-100" : ""}`} value={patientName} onChange={(e) => setPatientName(e.target.value)} placeholder="Full name" />
            </Field>
            <Field label="Patient ID">
              <input className={inputCls} value={patientId} onChange={(e) => setPatientId(e.target.value)} placeholder="PT-00000" />
            </Field>
            <Field label="Patient WhatsApp" hint="Optional · to share the Rx PDF">
              <input className={inputCls} value={patientPhone} onChange={(e) => setPatientPhone(e.target.value)} placeholder="+968 90000000" />
            </Field>
          </div>

          {/* 1. Tooth selection */}
          <section>
            <div className="mb-4 flex items-center justify-between">
              <SectionHeader icon={ScanLine} n="1" title="Tooth Selection" subtitle="Click teeth to add units, pontic spans, or full arches" />
              <div className="flex overflow-hidden rounded-lg border border-slate-300">
                {["FDI", "Universal"].map((nn) => (
                  <button key={nn} type="button" onClick={() => setNotation(nn)} className={`px-3 py-1.5 text-xs font-semibold transition ${notation === nn ? "bg-slate-800 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
                    {nn}
                  </button>
                ))}
              </div>
            </div>
            <ToothChart notation={notation} selection={selection} mode={mode} setMode={setMode} onToggle={toggleTooth} onArch={toggleArch} onClear={() => setSelection({})} />
            <div className={`mt-3 rounded-lg px-3 py-2 text-xs ${err("teeth") ? "bg-rose-50 text-rose-600" : "bg-slate-50 text-slate-600"}`}>
              {selectedTeeth.length === 0 ? (
                err("teeth") ? "Select at least one tooth." : "No teeth selected yet."
              ) : (
                <span>
                  <span className="font-semibold">{selectedTeeth.length} unit{selectedTeeth.length > 1 ? "s" : ""}:</span>{" "}
                  {selectedTeeth.map((t) => `${notation === "FDI" ? t.fdi : t.universal}${t.role === "pontic" ? " (pontic)" : ""}`).join(", ")}
                </span>
              )}
            </div>
          </section>

          {/* 2. Work order */}
          <section>
            <SectionHeader icon={Layers} n="2" title="Work Order & Materials" subtitle="Restoration category drives the material menu" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Restoration Category" required>
                <select className={inputCls} value={category} onChange={(e) => onCategoryChange(e.target.value)}>
                  {Object.keys(CATEGORIES).map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </Field>
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
                          setVitaShade(SHADE_GUIDES[e.target.value][0]);
                        }}
                      >
                        {SHADE_GUIDE_NAMES.map((g) => (
                          <option key={g} value={g}>{g}</option>
                        ))}
                      </select>
                    )}
                  </Field>
                  <Field label="Shade">
                    {isRefer ? (
                      <input className={inputCls} value={REFER} disabled readOnly />
                    ) : (
                      <select className={inputCls} value={vitaShade} onChange={(e) => setVitaShade(e.target.value)}>
                        {SHADE_GUIDES[shadeGuide].map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    )}
                  </Field>
                </>
              )}
              {HAS_STUMP.includes(category) && (
                <Field label="Stump Shade" hint="Ivoclar ND system">
                  {isRefer ? (
                    <input className={inputCls} value={REFER} disabled readOnly />
                  ) : (
                    <select className={inputCls} value={stumpShade} onChange={(e) => setStumpShade(e.target.value)}>
                      {STUMP_SHADES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  )}
                </Field>
              )}
              {BRIDGE_CATEGORIES.includes(category) && hasPontics && (
                <Field label="Pontic Design" hint="Applied to pontic units">
                  <select className={inputCls} value={ponticDesign} onChange={(e) => setPonticDesign(e.target.value)}>
                    {PONTIC_DESIGNS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
          </section>

          {/* 3. Lab & logistics */}
          <section>
            <SectionHeader icon={Building2} n="3" title="Target Lab & Logistics" subtitle="Turnaround auto-calculated from the lab profile" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Select Lab" required>
                <select className={`${inputCls} ${err("labId") ? "border-rose-400 ring-rose-100" : ""}`} value={labId} onChange={(e) => setLabId(e.target.value)}>
                  <option value="">Select lab…</option>
                  {labs.map((l) => (
                    <option key={l.id} value={l.id}>{l.name} — {l.tat}d TAT · +{l.expressPct ?? 20}% express</option>
                  ))}
                </select>
              </Field>
              <Field label="Deliver to Clinic on">
                <input type="date" className={inputCls} value={insertionDate} onChange={(e) => setInsertionDate(e.target.value)} />
              </Field>
              <div>
                <span className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">Express</span>
                <button
                  type="button"
                  onClick={() => setRush((r) => !r)}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                    rush ? "border-amber-400 bg-amber-50 text-amber-700" : "border-slate-300 bg-white text-slate-500"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Zap size={15} className={rush ? "text-amber-500" : "text-slate-400"} />
                    {rush ? `Express${lab ? ` +${lab.expressPct ?? 20}%` : ""}` : "Standard"}
                  </span>
                  <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${rush ? "bg-amber-500" : "bg-slate-300"}`}>
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${rush ? "translate-x-4" : "translate-x-0.5"}`} />
                  </span>
                </button>
                {rush && <p className="mt-1 text-[11px] text-amber-600">Lab charges {lab ? `${lab.expressPct ?? 20}%` : "a %"} extra for faster-than-usual work.</p>}
              </div>
            </div>

            {/* TAT + fee summary cards */}
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                <p className="flex items-center gap-1 text-[11px] font-medium text-slate-500"><Clock size={12} /> Estimated Turnaround</p>
                <p className="mt-0.5 text-lg font-bold text-slate-800">
                  {effTat} day{effTat !== 1 ? "s" : ""}{" "}
                  {rush && baseTat !== effTat && <span className="text-xs font-medium text-amber-600 line-through decoration-slate-300">{baseTat}d</span>}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                <p className="flex items-center gap-1 text-[11px] font-medium text-slate-500"><Calendar size={12} /> Est. Ready Date</p>
                <p className="mt-0.5 text-lg font-bold text-slate-800">{estReady ? iso(estReady) : "—"}</p>
              </div>
              <div className={`rounded-lg border px-3 py-2.5 ${insufficientTime ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}>
                <p className={`flex items-center gap-1 text-[11px] font-medium ${insufficientTime ? "text-rose-600" : "text-emerald-600"}`}>
                  {insufficientTime ? <AlertTriangle size={12} /> : <Check size={12} />} Schedule Check
                </p>
                <p className={`mt-0.5 text-xs font-semibold ${insufficientTime ? "text-rose-700" : "text-emerald-700"}`}>
                  {!insertionDate ? "Set an insertion date" : insufficientTime ? "Insertion is before ready date" : "Fits before insertion"}
                </p>
              </div>
              {rush && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <p className="flex items-center gap-1 text-[11px] font-medium text-slate-500"><DollarSign size={12} /> Estimated Fee</p>
                  <p className="mt-0.5 text-lg font-bold text-slate-800">${fee.total.toLocaleString()}</p>
                  {fee.surcharge > 0 && (
                    <p className="text-[11px] text-amber-600">${fee.base.toLocaleString()} + ${fee.surcharge.toLocaleString()} express</p>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* 4. Attachments & notes */}
          <section>
            <SectionHeader icon={Upload} n="4" title="Digital Attachments & Notes" subtitle="Attach STL scans and shade photos (simulated)" />
            <div className="grid gap-3 sm:grid-cols-2">
              {/* STL scans */}
              <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700"><ScanLine size={16} className="text-blue-600" /> Intraoral Scans (STL)</div>
                <div className="flex flex-wrap gap-2">
                  <label className="cursor-pointer rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
                    Choose .stl
                    <input type="file" accept=".stl,.ply,.obj" multiple className="hidden" onChange={(e) => addFiles(e.target.files, setScans)} />
                  </label>
                  <button type="button" onClick={addSampleScan} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                    <Sparkles size={12} className="mr-1 inline" /> Attach sample scan
                  </button>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {scans.length === 0 && <li className="text-[11px] text-slate-400">No scans attached.</li>}
                  {scans.map((f, i) => (
                    <li key={i} className="flex items-center justify-between rounded-md bg-white px-2.5 py-1.5 text-xs ring-1 ring-slate-200">
                      <span className="flex items-center gap-1.5 truncate text-slate-700"><ScanLine size={13} className="shrink-0 text-blue-500" /> <span className="truncate">{f.name}</span></span>
                      <span className="ml-2 flex items-center gap-2">
                        <span className="text-slate-400">{fmtSize(f.size)}</span>
                        <button type="button" onClick={() => setScans((p) => p.filter((_, j) => j !== i))} className="text-slate-400 hover:text-rose-500"><Trash2 size={13} /></button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Shade photos */}
              <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700"><ImageIcon size={16} className="text-violet-600" /> Clinical / Shade Photos</div>
                <label className="cursor-pointer rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700">
                  Choose images
                  <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => addFiles(e.target.files, setPhotos)} />
                </label>
                <ul className="mt-3 space-y-1.5">
                  {photos.length === 0 && <li className="text-[11px] text-slate-400">No photos attached.</li>}
                  {photos.map((f, i) => (
                    <li key={i} className="flex items-center justify-between rounded-md bg-white px-2.5 py-1.5 text-xs ring-1 ring-slate-200">
                      <span className="flex items-center gap-1.5 truncate text-slate-700"><ImageIcon size={13} className="shrink-0 text-violet-500" /> <span className="truncate">{f.name}</span></span>
                      <span className="ml-2 flex items-center gap-2">
                        <span className="text-slate-400">{fmtSize(f.size)}</span>
                        <button type="button" onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))} className="text-slate-400 hover:text-rose-500"><Trash2 size={13} /></button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-3">
              <Field label="Special Instructions">
                <textarea rows={3} className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Contacts, contour, staining, occlusal scheme, delivery notes…" />
              </Field>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className={`flex items-center justify-between gap-3 border-t px-6 py-4 ${touched && !isValid ? "border-rose-200 bg-rose-50" : "border-slate-100 bg-slate-50"}`}>
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
              {isValid ? "Ready to submit to lab queue." : "Complete required fields (*) to submit."}
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white ${isValid ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-300 cursor-not-allowed"}`}
            >
              <Check size={15} /> Submit Prescription
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
