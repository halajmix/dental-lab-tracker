import React, { useState, useMemo, useEffect } from "react";
import {
  Building2,
  Stethoscope,
  X,
  Search,
  Filter,
  Hammer,
  ClipboardCheck,
  Home,
  Clock,
  FlaskConical,
  RefreshCw,
  FileText,
  Zap,
  Layers,
  AlertTriangle,
  SlidersHorizontal,
  CheckCheck,
  BarChart3,
  Download,
  RefreshCcw,
  ListChecks,
  History as HistoryIcon,
  MessageCircle,
  PackageCheck,
} from "lucide-react";
import PrescriptionForm, { toothSummary, includedSummary, UNIVERSAL_TO_FDI } from "./PrescriptionForm.jsx";
import {
  STAGES,
  STAGE_INDEX,
  LAST_STAGE,
  StatusPill,
  ProgressBar,
  ProgressTracker,
  AppointmentBadge,
  CaseDrawer,
  isUrgent,
  buildHistory,
} from "./LifecycleEngine.jsx";
import { AnalyticsDashboard, computeAnalytics, caseFee } from "./Analytics.jsx";
import { RemakeModal } from "./Remake.jsx";
import PrintRx from "./PrintRx.jsx";
import { exportCasesCSV } from "./exportCsv.js";

/* ------------------------------------------------------------------ */
/*  Clinic profile (used by the printable prescription + CSV)          */
/* ------------------------------------------------------------------ */

const CLINIC = {
  name: "Muscat Smile Dental Clinic",
  address: "Al Khuwair, Muscat, Oman",
  contact: "+968 2400 0000 · care@muscatsmile.om",
  license: "OM-DC-4471",
  dentist: "Dr. A. Chen, BDS",
  dentistLicense: "OM-DDS-88213",
};

/* ------------------------------------------------------------------ */
/*  Seed data — stage semantics + audit history come from the engine   */
/* ------------------------------------------------------------------ */

const SEED_LABS = [
  { id: "lab-apex", name: "Apex Dental Lab", contact: "+1 (555) 210-4471", address: "12 Prosthetic Way, Portland OR", tat: 5, expressPct: 20 },
  { id: "lab-precision", name: "Precision Ceramics", contact: "+1 (555) 883-1120", address: "88 Ceramic Blvd, Seattle WA", tat: 7, expressPct: 25 },
  { id: "lab-digital", name: "Digital Craft Ortho", contact: "+1 (555) 640-9932", address: "5 Aligner Ave, Austin TX", tat: 4, expressPct: 15 },
];

// Build a prescription object for seed cases (teeth as [universal, role] pairs).
const seedRx = (notation, teeth, category, material, vitaShade, opts = {}) => ({
  notation,
  teeth: teeth.map(([u, role]) => ({ universal: u, fdi: UNIVERSAL_TO_FDI[u], role })),
  category,
  material,
  shadeGuide: opts.shadeGuide ?? "Vita Classical",
  vitaShade,
  stumpShade: opts.stump ?? "N/A",
  ponticDesign: opts.ponticDesign ?? null,
  rush: opts.rush ?? false,
  files: opts.files ?? [],
  notes: opts.notes ?? "",
});

// Appointment dates are computed relative to "now" so the ≤48h alert logic
// is always demonstrable regardless of the wall clock.
const daysFromNow = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

function makeSeedCases() {
  const base = (id, patientName, patientId, labId, labName, apptOffset, stageIndex, prescription, extra = {}) => ({
    id,
    patientName,
    patientId,
    patientPhone: extra.patientPhone ?? "",
    labId,
    appointmentDate: daysFromNow(apptOffset),
    createdDate: daysFromNow(-4),
    stageIndex,
    handover: extra.handover ?? null,
    remake: extra.remake ?? null,
    prescription,
    history: buildHistory(stageIndex, labName),
  });
  return [
    base("C-1042", "Sarah Mitchell", "PT-88213", "lab-apex", "Apex Dental Lab", 5, STAGE_INDEX.WORK_IN_PROGRESS,
      seedRx("FDI", [[8, "unit"], [9, "unit"]], "Crown - tooth", "Lithium Disilicate (E.max)", "A2")),
    // ≤48h away, still in lab → red alert
    base("C-1043", "James Okafor", "PT-88220", "lab-precision", "Precision Ceramics", 1, STAGE_INDEX.WORK_IN_PROGRESS,
      seedRx("FDI", [[30, "unit"]], "Crown - tooth", "Monolithic Zirconia", "A3", { rush: true, notes: "Deep chamfer, tight contacts." })),
    // work complete but appointment is today → dentist needs to receive (alert)
    base("C-1044", "Elena Rodríguez", "PT-88231", "lab-apex", "Apex Dental Lab", 0, STAGE_INDEX.WORK_COMPLETE,
      seedRx("FDI", [[3, "unit"], [4, "unit"], [5, "unit"]], "Crown - implant", "Zirconia", "B1")),
    base("C-1045", "Toshiro Yamada", "PT-88240", "lab-digital", "Digital Craft Ortho", 9, STAGE_INDEX.STILL_AT_CLINIC,
      seedRx("Universal", [], "Orthodontics splint", "", "N/A", { shadeGuide: "N/A", notes: "Vacuum-formed retainer." })),
    base("C-1046", "Grace Bennett", "PT-88255", "lab-precision", "Precision Ceramics", -2, STAGE_INDEX.CLINIC_RECEIVED,
      seedRx("FDI", [[13, "unit"], [12, "pontic"], [11, "unit"]], "Bridge - tooth (conventional)", "PFM (Porcelain-Fused-to-Metal)", "A3.5", { ponticDesign: "Modified Ridge Lap" }),
      {
        handover: { type: "Patient Picked Up", pickupDate: daysFromNow(-2), staffNotes: "Collected by patient at front desk.", confirmed: true },
        remake: { classification: "laboratory", reason: "Porcelain fracture", cost: 120, replacementDate: daysFromNow(6), loggedAt: new Date().toISOString() },
      }),
  ];
}

const SEED_CASES = makeSeedCases();

/* ------------------------------------------------------------------ */
/*  Small shared UI pieces                                             */
/* ------------------------------------------------------------------ */

function Modal({ open, onClose, title, icon: Icon, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2.5">
            {Icon && <Icon size={18} className="text-blue-600" />}
            <h3 className="text-base font-semibold text-slate-800">{title}</h3>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

/* ------------------------------------------------------------------ */
/*  Persistence — localStorage-backed state                            */
/* ------------------------------------------------------------------ */

// Bump when the shape of persisted data changes incompatibly; a mismatch
// discards the old blob and falls back to seed data instead of crashing.
// v13: crown/bridge categories split into 5 + Veneer added.
const STORAGE_VERSION = 13;
const STORAGE_KEY = "dentatrack.v" + STORAGE_VERSION;
const CLINIC_USER = "Dr. Chen (Clinic)";

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== STORAGE_VERSION) return null;
    return parsed;
  } catch {
    return null; // corrupt / unavailable storage → seed data
  }
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function DentalLabTracker() {
  // Lazy-init from localStorage once, falling back to seed data.
  const persisted = loadState();
  const [labs, setLabs] = useState(persisted?.labs ?? SEED_LABS);
  const [cases, setCases] = useState(persisted?.cases ?? SEED_CASES);

  // Persist on every change to labs or cases.
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: STORAGE_VERSION, labs, cases })
      );
    } catch {
      /* storage full or blocked — non-fatal, app keeps working in-memory */
    }
  }, [labs, cases]);

  // View: "dentist" or a specific lab id.
  const [view, setView] = useState("dentist");

  // Modals
  const [showLabModal, setShowLabModal] = useState(false);
  const [showCaseModal, setShowCaseModal] = useState(false);

  // Filters (dentist view)
  const [statusFilter, setStatusFilter] = useState("all");
  const [labFilter, setLabFilter] = useState("all");
  const [query, setQuery] = useState("");

  const labById = useMemo(() => Object.fromEntries(labs.map((l) => [l.id, l])), [labs]);

  // Which case's lifecycle drawer is open.
  const [drawerCaseId, setDrawerCaseId] = useState(null);
  // Phase 4 UI state: remake modal, print view, and dentist sub-tab.
  const [remakeCaseId, setRemakeCaseId] = useState(null);
  const [printCaseId, setPrintCaseId] = useState(null);
  const [autoShare, setAutoShare] = useState(false);
  const [dentistTab, setDentistTab] = useState("cases"); // "cases" | "analytics"

  /* ---------------- Stage mutation helpers (append audit history) ---------------- */

  const logEntry = (action, toStage, by, role, label) => ({
    at: new Date().toISOString(),
    action,
    toStage,
    label: label ?? STAGES[toStage].label,
    by,
    role,
  });

  const advanceStage = (caseId, by, role) =>
    setCases((prev) =>
      prev.map((c) => {
        if (c.id !== caseId) return c;
        const next = c.stageIndex + 1;
        if (next > LAST_STAGE) return c;
        return { ...c, stageIndex: next, history: [...(c.history ?? []), logEntry("advance", next, by, role)] };
      })
    );

  const revertStage = (caseId, by, role) =>
    setCases((prev) =>
      prev.map((c) => {
        if (c.id !== caseId) return c;
        const prevIdx = c.stageIndex - 1;
        if (prevIdx < 0) return c;
        // Reverting out of Clinic Received discards any handover record.
        const clearHandover = c.stageIndex === LAST_STAGE ? { handover: null } : {};
        return { ...c, stageIndex: prevIdx, ...clearHandover, history: [...(c.history ?? []), logEntry("revert", prevIdx, by, role)] };
      })
    );

  const saveHandover = (caseId, data, by) =>
    setCases((prev) =>
      prev.map((c) => {
        if (c.id !== caseId) return c;
        const label = `${data.type}${data.confirmed ? " (confirmed)" : ""}`;
        return { ...c, handover: { ...data }, history: [...(c.history ?? []), logEntry("handover", LAST_STAGE, by, "dentist", label)] };
      })
    );

  const logRemake = (caseId, data, by) =>
    setCases((prev) =>
      prev.map((c) => {
        if (c.id !== caseId) return c;
        const cls = data.classification === "clinical" ? "Clinical" : "Laboratory";
        const label = `Remake · ${cls}: ${data.reason}`;
        return { ...c, remake: { ...data }, history: [...(c.history ?? []), logEntry("remake", c.stageIndex, by, currentRole, label)] };
      })
    );

  /* ---------------- Add lab / add case ---------------- */

  const addLab = (data) => {
    const id = `lab-${data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 20)}-${Date.now().toString().slice(-4)}`;
    setLabs((p) => [...p, { id, ...data }]);
  };

  const addCase = (data, opts = {}) => {
    // Highest existing C-#### + 1, so ids stay unique across reloads.
    const maxNum = cases
      .map((c) => parseInt(c.id.replace(/\D/g, ""), 10))
      .filter((n) => !isNaN(n))
      .reduce((m, n) => Math.max(m, n), 1046);
    const id = `C-${maxNum + 1}`;
    setCases((p) => [
      {
        id,
        createdDate: new Date().toISOString().slice(0, 10),
        stageIndex: STAGE_INDEX.STILL_AT_CLINIC, // Rx submitted, work still at clinic (20%)
        handover: null,
        remake: null,
        history: [logEntry("created", STAGE_INDEX.STILL_AT_CLINIC, CLINIC_USER, "dentist")],
        ...data,
      },
      ...p,
    ]);
    // "Submit & Share" → jump straight into the share flow for the new case.
    if (opts.share) {
      setAutoShare(true);
      setPrintCaseId(id);
    }
  };

  // Restore seed data and clear persisted state (dev / demo escape hatch).
  const resetDemoData = () => {
    if (!window.confirm("Reset to demo data? This clears all saved labs and cases.")) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setLabs(SEED_LABS);
    setCases(makeSeedCases());
    setView("dentist");
  };

  /* ---------------- Derived lists ---------------- */

  const filteredDentistCases = useMemo(() => {
    return cases.filter((c) => {
      if (labFilter !== "all" && c.labId !== labFilter) return false;
      if (statusFilter !== "all") {
        if (statusFilter === "prepared" && c.stageIndex !== STAGE_INDEX.STILL_AT_CLINIC) return false;
        if (statusFilter === "in_lab" && !(c.stageIndex >= STAGE_INDEX.PICKED_UP_BY_LAB && c.stageIndex <= STAGE_INDEX.WORK_COMPLETE)) return false;
        if (statusFilter === "received" && c.stageIndex !== STAGE_INDEX.CLINIC_RECEIVED) return false;
        if (statusFilter === "handover" && !c.handover?.confirmed) return false;
        if (statusFilter === "urgent" && !isUrgent(c)) return false;
      }
      if (query) {
        const q = query.toLowerCase();
        if (
          !c.patientName.toLowerCase().includes(q) &&
          !c.patientId.toLowerCase().includes(q) &&
          !c.id.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [cases, labFilter, statusFilter, query]);

  const labQueue = useMemo(
    () => (view !== "dentist" ? cases.filter((c) => c.labId === view) : []),
    [cases, view]
  );

  const isDentist = view === "dentist";
  const activeLab = !isDentist ? labById[view] : null;

  // Lifecycle drawer context (role + acting user depend on the active view).
  const drawerCase = cases.find((c) => c.id === drawerCaseId) || null;
  const remakeCase = cases.find((c) => c.id === remakeCaseId) || null;
  const printCase = cases.find((c) => c.id === printCaseId) || null;
  const currentRole = isDentist ? "dentist" : "lab";
  const currentUser = isDentist ? CLINIC_USER : `${activeLab?.name ?? "Lab"} Tech`;

  /* ================================================================ */
  /*  Render                                                          */
  /* ================================================================ */

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      {/* ------------------------- Header / Role Switcher ------------------------- */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-blue-700 text-white">
              <FlaskConical size={18} />
            </div>
            <div>
              <h1 className="text-sm font-bold leading-tight text-slate-800">DentaTrack</h1>
              <p className="text-[11px] leading-tight text-slate-500">Lab Case Tracking · Lifecycle Engine</p>
            </div>
          </div>

          {/* Role Switcher */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-slate-100 p-1">
            <button
              onClick={() => setView("dentist")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                isDentist ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Stethoscope size={14} />
              Dentist Dashboard
            </button>
            <div className="mx-0.5 hidden h-5 w-px bg-slate-300 sm:block" />
            {labs.map((l) => (
              <button
                key={l.id}
                onClick={() => setView(l.id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  view === l.id ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <Building2 size={14} />
                {l.name}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {isDentist ? (
          <DentistDashboard
            labs={labs}
            labById={labById}
            cases={filteredDentistCases}
            allCases={cases}
            totalCases={cases.length}
            onAddLab={() => setShowLabModal(true)}
            onAddCase={() => setShowCaseModal(true)}
            onResetDemo={resetDemoData}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            labFilter={labFilter}
            setLabFilter={setLabFilter}
            query={query}
            setQuery={setQuery}
            onAdvance={(id) => advanceStage(id, CLINIC_USER, "dentist")}
            onOpenCase={setDrawerCaseId}
            onShareRx={(id) => { setAutoShare(true); setPrintCaseId(id); }}
            onExportCsv={() => exportCasesCSV(filteredDentistCases, labs, CLINIC.dentist, "dentatrack-clinic-cases.csv")}
            dentistTab={dentistTab}
            setDentistTab={setDentistTab}
          />
        ) : (
          <LabDashboard
            lab={activeLab}
            queue={labQueue}
            onAdvance={(id) => advanceStage(id, `${activeLab.name} Tech`, "lab")}
            onRevert={(id) => revertStage(id, `${activeLab.name} Tech`, "lab")}
            onOpenCase={setDrawerCaseId}
            onLogRemake={setRemakeCaseId}
            onExportCsv={() => exportCasesCSV(labQueue, labs, CLINIC.dentist, `dentatrack-${activeLab.id}-cases.csv`)}
          />
        )}
      </main>

      {/* ------------------------- Modals ------------------------- */}
      <AddLabModal open={showLabModal} onClose={() => setShowLabModal(false)} onSave={addLab} />
      <PrescriptionForm
        open={showCaseModal}
        onClose={() => setShowCaseModal(false)}
        onSave={addCase}
        labs={labs}
      />

      {/* ------------------- Case lifecycle drawer ------------------- */}
      <CaseDrawer
        open={!!drawerCase}
        caseObj={drawerCase}
        role={isDentist ? "dentist" : "lab"}
        onClose={() => setDrawerCaseId(null)}
        onAdvance={() => drawerCase && advanceStage(drawerCase.id, currentUser, currentRole)}
        onRevert={() => drawerCase && revertStage(drawerCase.id, currentUser, currentRole)}
        onSaveHandover={(data) => drawerCase && saveHandover(drawerCase.id, data, currentUser)}
        onLogRemake={() => drawerCase && setRemakeCaseId(drawerCase.id)}
        onPrint={() => drawerCase && setPrintCaseId(drawerCase.id)}
      />

      {/* ------------------- Phase 4 overlays ------------------- */}
      <RemakeModal
        open={!!remakeCase}
        caseObj={remakeCase}
        onClose={() => setRemakeCaseId(null)}
        onSave={(data) => remakeCase && logRemake(remakeCase.id, data, currentUser)}
      />
      <PrintRx
        open={!!printCase}
        caseObj={printCase}
        clinic={CLINIC}
        lab={printCase ? labById[printCase.labId] : null}
        autoShare={autoShare}
        onClose={() => { setPrintCaseId(null); setAutoShare(false); }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Dentist Dashboard                                                  */
/* ------------------------------------------------------------------ */

function StatCard({ icon: Icon, label, value, tone }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <Icon size={16} className={tone} />
      </div>
      <p className="mt-1 text-2xl font-bold text-slate-800 tabular-nums">{value}</p>
    </div>
  );
}

function DentistDashboard({
  labs,
  labById,
  cases,
  allCases,
  totalCases,
  onAddLab,
  onAddCase,
  onResetDemo,
  statusFilter,
  setStatusFilter,
  labFilter,
  setLabFilter,
  query,
  setQuery,
  onAdvance,
  onOpenCase,
  onShareRx,
  onExportCsv,
  dentistTab,
  setDentistTab,
}) {
  const inLab = cases.filter((c) => c.stageIndex >= STAGE_INDEX.PICKED_UP_BY_LAB && c.stageIndex <= STAGE_INDEX.WORK_COMPLETE).length;
  const atClinic = cases.filter((c) => c.stageIndex === STAGE_INDEX.CLINIC_RECEIVED).length;
  const urgentCases = cases.filter(isUrgent);

  return (
    <div className="space-y-6">
      {/* Title row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Dentist Dashboard</h2>
          <p className="flex items-center gap-1.5 text-sm text-slate-500">
            Cases originating from your clinic · {totalCases} total
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600" title="Data is saved to this browser">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> saved locally
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onResetDemo}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-50 hover:text-rose-600"
            title="Restore demo data and clear saved state"
          >
            <RefreshCw size={15} /> Reset
          </button>
          <button
            onClick={onAddLab}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Building2 size={15} /> Add Lab
          </button>
          <button
            onClick={onAddCase}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <FileText size={15} /> New Prescription
          </button>
        </div>
      </div>

      {/* Cases | SLA Analytics tabs + CSV export */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200">
        <div className="flex gap-1">
          {[
            { k: "cases", label: "Cases", icon: ListChecks },
            { k: "analytics", label: "SLA Analytics", icon: BarChart3 },
          ].map((t) => (
            <button
              key={t.k}
              onClick={() => setDentistTab(t.k)}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold transition ${
                dentistTab === t.k ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              <t.icon size={15} /> {t.label}
            </button>
          ))}
        </div>
        {dentistTab === "cases" && (
          <button
            onClick={onExportCsv}
            className="mb-1 flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            <Download size={15} /> Export CSV
          </button>
        )}
      </div>

      {dentistTab === "analytics" && <AnalyticsDashboard cases={allCases} labs={labs} />}

      {dentistTab === "cases" && (
      <>
      {/* Appointment alert banner (Phase 3, req 4) */}
      {urgentCases.length > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm">
          <AlertTriangle size={16} className="shrink-0 text-rose-600" />
          <span className="font-semibold text-rose-700">{urgentCases.length} case{urgentCases.length > 1 ? "s" : ""} need attention</span>
          <span className="text-rose-600">— appointment within 48h and not yet Clinic Received:</span>
          <span className="font-medium text-rose-700">{urgentCases.map((c) => c.id).join(", ")}</span>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={ClipboardCheck} label="Visible Cases" value={cases.length} tone="text-slate-400" />
        <StatCard icon={Hammer} label="In Lab" value={inLab} tone="text-blue-500" />
        <StatCard icon={Home} label="Clinic Received" value={atClinic} tone="text-emerald-500" />
        <StatCard icon={AlertTriangle} label="Appt. Alerts" value={urgentCases.length} tone={urgentCases.length ? "text-rose-500" : "text-slate-400"} />
      </div>

      {/* Lab directory */}
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          <Building2 size={15} className="text-slate-400" /> Registered Labs ({labs.length})
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {labs.map((l) => (
            <div key={l.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{l.name}</p>
                  <p className="text-xs text-slate-500">{l.contact}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                    <Clock size={11} /> {l.tat}d TAT
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 ring-1 ring-inset ring-violet-200">
                    <Zap size={11} /> +{l.expressPct ?? 20}% express
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <Filter size={14} /> Filters
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search patient / case ID"
            className="w-56 rounded-lg border border-slate-300 py-1.5 pl-8 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`${inputCls} w-auto py-1.5`}>
          <option value="all">All statuses</option>
          <option value="prepared">Still at Clinic</option>
          <option value="in_lab">In Lab</option>
          <option value="received">Clinic Received</option>
          <option value="handover">Handed Over</option>
          <option value="urgent">⚠ Appt Alerts</option>
        </select>
        <select value={labFilter} onChange={(e) => setLabFilter(e.target.value)} className={`${inputCls} w-auto py-1.5`}>
          <option value="all">All labs</option>
          {labs.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      {/* Cases table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Case</th>
                <th className="px-4 py-3 font-semibold">Patient</th>
                <th className="px-4 py-3 font-semibold">Lab</th>
                <th className="px-4 py-3 font-semibold">Appointment</th>
                <th className="px-4 py-3 font-semibold w-56">Progress</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cases.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">
                    No cases match the current filters.
                  </td>
                </tr>
              )}
              {cases.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-800">{c.id}</div>
                    <StatusPill caseObj={c} />
                    {c.remake && (
                      <div className="mt-1">
                        <span className="inline-flex items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                          <RefreshCcw size={9} /> Remake
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{c.patientName}</div>
                    <div className="text-xs text-slate-500">{c.patientId}</div>
                    {c.prescription && (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                        <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
                          <Layers size={10} /> {c.prescription.category}
                        </span>
                        {c.prescription.material && <span className="text-slate-400">{c.prescription.material}</span>}
                        {c.prescription.rush && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-700">
                            <Zap size={10} /> EXPRESS +${caseFee(c, labs).surcharge.toLocaleString()}
                          </span>
                        )}
                        {toothSummary(c.prescription) && (
                          <span className="w-full text-slate-400">
                            Teeth <span className="font-medium text-slate-600">{toothSummary(c.prescription)}</span>
                            {c.prescription.vitaShade && c.prescription.vitaShade !== "N/A" && <> · Shade {c.prescription.vitaShade}</>}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{labById[c.labId]?.name ?? "—"}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="text-slate-600">{c.appointmentDate}</div>
                    <AppointmentBadge caseObj={c} className="mt-1" />
                  </td>
                  <td className="px-4 py-3">
                    <ProgressBar caseObj={c} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      {c.handover?.confirmed && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                          <CheckCheck size={11} /> {c.handover.type === "Delivered to Clinic" ? "Delivered" : "Picked Up"}
                        </span>
                      )}
                      {c.stageIndex === STAGE_INDEX.WORK_COMPLETE && (
                        <button
                          onClick={() => onAdvance(c.id)}
                          className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                          title="Mark case as received at the clinic"
                        >
                          <ClipboardCheck size={13} /> Receive
                        </button>
                      )}
                      <button
                        onClick={() => onShareRx(c.id)}
                        className="flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                        title={c.patientPhone ? `Send Rx PDF to ${c.patientPhone}` : "Share Rx PDF (no patient number saved)"}
                      >
                        <MessageCircle size={13} /> Share
                      </button>
                      <button
                        onClick={() => onOpenCase(c.id)}
                        className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        <SlidersHorizontal size={13} /> Manage
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Laboratory Dashboard                                               */
/* ------------------------------------------------------------------ */

function LabDashboard({ lab, queue, onAdvance, onRevert, onOpenCase, onLogRemake, onExportCsv }) {
  if (!lab) return null;

  const incoming = queue.filter((c) => c.stageIndex === STAGE_INDEX.STILL_AT_CLINIC).length;
  const inProduction = queue.filter((c) => c.stageIndex >= STAGE_INDEX.PICKED_UP_BY_LAB && c.stageIndex < STAGE_INDEX.WORK_COMPLETE).length;
  const completed = queue.filter((c) => c.stageIndex >= STAGE_INDEX.WORK_COMPLETE).length;

  // This lab's own SLA snapshot.
  const { perLab } = computeAnalytics(queue, [lab]);
  const sla = perLab[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800">
            <Building2 size={18} className="text-blue-600" /> {lab.name}
          </h2>
          <p className="text-sm text-slate-500">
            Production Queue · {lab.contact} · {lab.tat}-day standard TAT · +{lab.expressPct ?? 20}% express
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-sky-50 px-3 py-1.5 text-center">
            <p className="text-[11px] font-medium text-sky-500">Incoming</p>
            <p className="text-lg font-bold text-sky-700 tabular-nums">{incoming}</p>
          </div>
          <div className="rounded-lg bg-blue-50 px-3 py-1.5 text-center">
            <p className="text-[11px] font-medium text-blue-500">In Production</p>
            <p className="text-lg font-bold text-blue-700 tabular-nums">{inProduction}</p>
          </div>
          <div className="rounded-lg bg-emerald-50 px-3 py-1.5 text-center">
            <p className="text-[11px] font-medium text-emerald-500">Completed</p>
            <p className="text-lg font-bold text-emerald-700 tabular-nums">{completed}</p>
          </div>
          <button
            onClick={onExportCsv}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            <Download size={15} /> Export CSV
          </button>
        </div>
      </div>

      {/* Lab SLA snapshot */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-[11px] font-medium text-slate-500">Actual TAT</p>
          <p className="mt-0.5 text-lg font-bold text-slate-800">{sla.actualTat != null ? `${sla.actualTat.toFixed(1)}d` : "—"} <span className="text-xs font-medium text-slate-400">/ {sla.promisedTat}d</span></p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-[11px] font-medium text-slate-500">On-Time Rate</p>
          <p className="mt-0.5 text-lg font-bold text-slate-800">{sla.onTimeRate == null ? "—" : `${Math.round(sla.onTimeRate * 100)}%`}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-[11px] font-medium text-slate-500">Remake Rate</p>
          <p className="mt-0.5 text-lg font-bold text-slate-800">{Math.round(sla.remakeRate * 100)}% <span className="text-xs font-medium text-slate-400">({sla.remakes})</span></p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-[11px] font-medium text-slate-500">Quality Score</p>
          <p className="mt-0.5 text-lg font-bold" style={{ color: sla.qualityScore >= 85 ? "#16a34a" : sla.qualityScore >= 70 ? "#d97706" : "#dc2626" }}>{sla.qualityScore}</p>
        </div>
      </div>

      {queue.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-sm text-slate-400">
          No cases assigned to {lab.name} yet.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {queue.map((c) => (
            <LabCaseCard key={c.id} c={c} lab={lab} onAdvance={onAdvance} onRevert={onRevert} onOpenCase={onOpenCase} onLogRemake={onLogRemake} />
          ))}
        </div>
      )}
    </div>
  );
}

function LabCaseCard({ c, lab, onAdvance, onRevert, onOpenCase, onLogRemake }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-800">{c.id}</span>
            <StatusPill caseObj={c} />
            <AppointmentBadge caseObj={c} />
            {c.remake && (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                <RefreshCcw size={10} /> Remake
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-slate-600">
            {c.patientName} <span className="text-slate-400">· {c.patientId}</span>
          </p>
        </div>
        <button
          onClick={() => onOpenCase(c.id)}
          className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-50"
          title="Open lifecycle & history"
        >
          <HistoryIcon size={12} /> History
        </button>
      </div>

      {c.prescription && (
        <div className="mb-3 rounded-lg bg-slate-50 p-2.5 text-xs ring-1 ring-inset ring-slate-100">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 font-semibold text-blue-700">
              <Layers size={10} /> {c.prescription.category}
            </span>
            {c.prescription.material && <span className="font-medium text-slate-700">{c.prescription.material}</span>}
            {c.prescription.rush && (
              <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-700">
                <Zap size={10} /> EXPRESS +${caseFee(c, lab ? [lab] : []).surcharge.toLocaleString()}
              </span>
            )}
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-slate-500">
            <span>Teeth: <span className="font-medium text-slate-700">{toothSummary(c.prescription)}</span></span>
            {c.prescription.vitaShade && c.prescription.vitaShade !== "N/A" && (
              <span>Shade: <span className="font-medium text-slate-700">{c.prescription.vitaShade}</span></span>
            )}
            {c.prescription.stumpShade && c.prescription.stumpShade !== "N/A" && (
              <span>Stump: <span className="font-medium text-slate-700">{c.prescription.stumpShade}</span></span>
            )}
            {c.prescription.files?.length > 0 && (
              <span>Files: <span className="font-medium text-slate-700">{c.prescription.files.length} attached</span></span>
            )}
          </div>
          {includedSummary(c.prescription) && (
            <div className="mt-1.5 border-t border-slate-200 pt-1.5 text-slate-500">
              <span className="inline-flex items-center gap-1 font-medium text-slate-600">
                <PackageCheck size={11} /> Included:
              </span>{" "}
              <span className="font-medium text-slate-700">{includedSummary(c.prescription)}</span>
            </div>
          )}
          {c.prescription.notes && (
            <div className="mt-1.5 border-t border-slate-200 pt-1.5 text-slate-500">
              <span className="font-medium text-slate-600">Notes:</span> {c.prescription.notes}
            </div>
          )}
        </div>
      )}

      {/* Interactive stage controller — single-click advance/revert for the lab */}
      <ProgressTracker caseObj={c} role="lab" onAdvance={() => onAdvance(c.id)} onRevert={() => onRevert(c.id)} />

      <div className="mt-3 flex justify-end border-t border-slate-100 pt-3">
        <button
          onClick={() => onLogRemake(c.id)}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
            c.remake ? "bg-rose-100 text-rose-700 hover:bg-rose-200" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          <RefreshCcw size={13} /> {c.remake ? "Update Remake" : "Log Remake"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Add-Lab modal                                                      */
/* ------------------------------------------------------------------ */

function AddLabModal({ open, onClose, onSave }) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [tat, setTat] = useState(5);
  const [expressPct, setExpressPct] = useState(20);

  const reset = () => {
    setName("");
    setContact("");
    setTat(5);
    setExpressPct(20);
  };

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({ name: name.trim(), contact: contact.trim() || "—", tat: Number(tat) || 1, expressPct: Number(expressPct) || 0 });
    reset();
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Register New Laboratory" icon={Building2}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Lab Name *">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Summit Prosthetics" autoFocus />
        </Field>
        <Field label="Contact">
          <input className={inputCls} value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Phone or email" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Standard TAT (days)">
            <input type="number" min={1} className={inputCls} value={tat} onChange={(e) => setTat(e.target.value)} />
          </Field>
          <Field label="Express surcharge (%)">
            <input type="number" min={0} className={inputCls} value={expressPct} onChange={(e) => setExpressPct(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            Save Lab
          </button>
        </div>
      </form>
    </Modal>
  );
}
