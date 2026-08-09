import React, { useState, useMemo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Building2,
  Stethoscope,
  X,
  Search,
  ClipboardCheck,
  Clock,
  FlaskConical,
  FileText,
  Zap,
  Layers,
  AlertTriangle,
  CheckCheck,
  BarChart3,
  Download,
  RefreshCcw,
  History as HistoryIcon,
  MessageCircle,
  PackageCheck,
  Phone,
  Mail,
  LogOut,
  Settings,
  CircleUser,
  ChevronDown,
  MoreVertical,
  Plus,
  Eye,
} from "lucide-react";
import PrescriptionForm, { toothSummary, includedSummary } from "./PrescriptionForm.jsx";
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
} from "./LifecycleEngine.jsx";
import { AnalyticsDashboard, computeAnalytics, caseFee } from "./Analytics.jsx";
import { RemakeModal } from "./Remake.jsx";
import PrintRx from "./PrintRx.jsx";
import ContactLabModal from "./ContactLab.jsx";
import { exportCasesCSV } from "./exportCsv.js";
import { fetchLabs, insertLab, fetchCases, insertCase, updateCase, subscribeCases, fetchClinicsByIds, caseFromRow } from "./lib/data.js";

/* ------------------------------------------------------------------ */
/*  Small shared UI pieces                                             */
/* ------------------------------------------------------------------ */

function Modal({ open, onClose, title, icon: Icon, wide, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative z-10 w-full ${wide ? "max-w-4xl" : "max-w-lg"} max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200`}>
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-6 py-4">
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

/**
 * Right-hand slide-over used for admin/settings actions that don't belong
 * cluttering the main, data-first dashboard (lab directory, SLA reports).
 */
function SlideOver({ open, onClose, title, icon: Icon, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex h-full w-full max-w-sm flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2.5">
            {Icon && <Icon size={18} className="text-blue-600" />}
            <h3 className="text-base font-semibold text-slate-800">{title}</h3>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/** Small generic "click outside to close" dropdown wrapper. */
function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onEsc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);
  return { open, setOpen, ref };
}

/** Header identity — org + user, with Sign out tucked behind a dropdown. */
function ProfileMenu({ isDentist, clinic, lab, currentUser, onSignOut }) {
  const { open, setOpen, ref } = useDropdown();
  const orgName = isDentist ? clinic?.name : lab?.name;
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
      >
        <CircleUser size={20} className="text-slate-400" />
        <span className="hidden text-left sm:block">
          <span className="block leading-tight text-slate-800">{currentUser}</span>
          <span className="block text-[11px] font-normal leading-tight text-slate-400">{orgName}</span>
        </span>
        <ChevronDown size={14} className={`text-slate-400 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1.5 w-56 rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl">
          <div className="border-b border-slate-100 px-3.5 py-2.5">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
              {isDentist ? <Stethoscope size={13} className="text-blue-600" /> : <Building2 size={13} className="text-blue-600" />}
              {orgName}
            </p>
            <p className="mt-0.5 text-xs text-slate-400">{currentUser} · {isDentist ? "Dentist" : "Lab"}</p>
          </div>
          <button
            onClick={onSignOut}
            className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-rose-600"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Per-row "···" actions menu — keeps the table dense by hiding secondary
 * actions. Rendered through a portal to document.body: the table's rounded
 * corners rely on `overflow-hidden`, which would otherwise clip a dropdown
 * anchored to a row near the bottom edge.
 */
function CaseActionsMenu({ c, lab, onOpenCase, onContactLab, onShareRx, onAdvance }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const MENU_WIDTH = 208;

  const openMenu = () => {
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: Math.max(8, r.right - MENU_WIDTH) });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e) => {
      if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onEsc = (e) => e.key === "Escape" && setOpen(false);
    // Scrolling/resizing would leave the menu anchored to a stale position, so just close it.
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("scroll", setOpen.bind(null, false), true);
    window.addEventListener("resize", setOpen.bind(null, false));
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("scroll", setOpen.bind(null, false), true);
      window.removeEventListener("resize", setOpen.bind(null, false));
    };
  }, [open]);

  const item = (onClick, icon, label, extraCls = "") => (
    <button
      onClick={() => { setOpen(false); onClick(); }}
      className={`flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm font-medium text-slate-600 hover:bg-slate-50 ${extraCls}`}
    >
      {icon} {label}
    </button>
  );

  return (
    <div className="flex justify-end">
      <button
        ref={btnRef}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        title="Actions"
      >
        <MoreVertical size={16} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", top: pos.top, left: pos.left, width: MENU_WIDTH }}
            className="z-50 rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl"
          >
            {c.stageIndex === STAGE_INDEX.WORK_COMPLETE &&
              item(() => onAdvance(c.id), <ClipboardCheck size={14} className="text-emerald-600" />, "Mark Received", "text-emerald-700")}
            {item(() => onOpenCase(c.id), <Eye size={14} />, "View / Manage")}
            {item(() => onContactLab(c.id), <Phone size={14} />, `Contact ${lab?.name ?? "Lab"}`)}
            {item(() => onShareRx(c.id), <MessageCircle size={14} />, "Share Rx PDF")}
          </div>,
          document.body
        )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component — data now lives in Supabase, scoped per account    */
/*  by RLS (a clinic sees only its cases, a lab sees only its own).    */
/* ------------------------------------------------------------------ */

export default function DentalLabTracker({ auth }) {
  const { profile, clinic, lab, signOut } = auth;
  const isDentist = profile.role === "dentist";

  const [labs, setLabs] = useState([]);
  const [cases, setCases] = useState([]);
  const [clinicsById, setClinicsById] = useState({});
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Initial load, re-run if the signed-in org changes.
  useEffect(() => {
    let cancelled = false;
    setLoadingData(true);
    Promise.all([fetchLabs(), fetchCases()])
      .then(([labsData, casesData]) => {
        if (cancelled) return;
        setLabs(labsData);
        setCases(casesData);
        setLoadError("");
      })
      .catch((err) => !cancelled && setLoadError(err.message))
      .finally(() => !cancelled && setLoadingData(false));
    return () => {
      cancelled = true;
    };
  }, [profile.id]);

  // Realtime — the other side of a case (dentist <-> lab) sees changes live.
  useEffect(() => {
    const scope = isDentist ? { clinicId: clinic?.id } : { labId: lab?.id };
    if (!scope.clinicId && !scope.labId) return;
    const unsubscribe = subscribeCases(scope, (payload) => {
      setCases((prev) => {
        if (payload.eventType === "DELETE") {
          return prev.filter((c) => c.id !== payload.old.id);
        }
        const updated = caseFromRow(payload.new);
        const idx = prev.findIndex((c) => c.id === updated.id);
        if (idx === -1) return [updated, ...prev];
        const next = [...prev];
        next[idx] = updated;
        return next;
      });
    });
    return unsubscribe;
  }, [isDentist, clinic?.id, lab?.id]);

  // A lab may serve several clinics — fetch the ordering clinic's letterhead
  // (for Print Rx / CSV attribution) the first time a case from it is seen.
  useEffect(() => {
    const ids = [...new Set(cases.map((c) => c.clinicId).filter(Boolean))];
    const missing = ids.filter((id) => !clinicsById[id]);
    if (missing.length === 0) return;
    fetchClinicsByIds(missing)
      .then((rows) => {
        setClinicsById((prev) => {
          const next = { ...prev };
          for (const c of rows) next[c.id] = c;
          return next;
        });
      })
      .catch((err) => console.error("Failed to load clinic info", err));
  }, [cases]);

  // Modals
  const [showLabModal, setShowLabModal] = useState(false);
  const [showCaseModal, setShowCaseModal] = useState(false);
  // Admin actions (lab directory, SLA analytics) live off the main dashboard.
  const [showSettings, setShowSettings] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);

  // Filters (dentist view)
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");

  const labById = useMemo(() => Object.fromEntries(labs.map((l) => [l.id, l])), [labs]);

  // Which case's lifecycle drawer is open.
  const [drawerCaseId, setDrawerCaseId] = useState(null);
  // Phase 4 UI state: remake modal, print view.
  const [remakeCaseId, setRemakeCaseId] = useState(null);
  const [printCaseId, setPrintCaseId] = useState(null);
  const [autoShare, setAutoShare] = useState(false);
  const [contactCaseId, setContactCaseId] = useState(null);

  const currentRole = isDentist ? "dentist" : "lab";
  const currentUser = profile.name || (isDentist ? clinic?.dentist : lab?.name) || "Unknown";

  /* ---------------- Stage mutation helpers (append audit history, then persist) ---------------- */

  const logEntry = (action, toStage, by, role, label) => ({
    at: new Date().toISOString(),
    action,
    toStage,
    label: label ?? STAGES[toStage].label,
    by,
    role,
  });

  const persist = async (caseId, patch) => {
    setCases((prev) => prev.map((c) => (c.id === caseId ? { ...c, ...patch } : c)));
    try {
      await updateCase(caseId, patch);
    } catch (err) {
      console.error("Failed to save case update", err);
      alert("Couldn't save that change — " + err.message);
    }
  };

  const advanceStage = (caseId, by, role) => {
    const c = cases.find((x) => x.id === caseId);
    if (!c) return;
    const next = c.stageIndex + 1;
    if (next > LAST_STAGE) return;
    persist(caseId, { stageIndex: next, history: [...(c.history ?? []), logEntry("advance", next, by, role)] });
  };

  const revertStage = (caseId, by, role) => {
    const c = cases.find((x) => x.id === caseId);
    if (!c) return;
    const prevIdx = c.stageIndex - 1;
    if (prevIdx < 0) return;
    // Reverting out of Clinic Received discards any handover record.
    const clearHandover = c.stageIndex === LAST_STAGE ? { handover: null } : {};
    persist(caseId, { stageIndex: prevIdx, ...clearHandover, history: [...(c.history ?? []), logEntry("revert", prevIdx, by, role)] });
  };

  const saveHandover = (caseId, data, by) => {
    const c = cases.find((x) => x.id === caseId);
    if (!c) return;
    const label = `${data.type}${data.confirmed ? " (confirmed)" : ""}`;
    persist(caseId, { handover: { ...data }, history: [...(c.history ?? []), logEntry("handover", LAST_STAGE, by, "dentist", label)] });
  };

  const logRemake = (caseId, data, by) => {
    const c = cases.find((x) => x.id === caseId);
    if (!c) return;
    const cls = data.classification === "clinical" ? "Clinical" : "Laboratory";
    const label = `Remake · ${cls}: ${data.reason}`;
    persist(caseId, { remake: { ...data }, history: [...(c.history ?? []), logEntry("remake", c.stageIndex, by, currentRole, label)] });
  };

  /* ---------------- Add lab / add case ---------------- */

  const addLab = async (data) => {
    try {
      const saved = await insertLab(clinic.id, data);
      setLabs((p) => [...p, saved]);
    } catch (err) {
      console.error(err);
      alert("Couldn't save the lab — " + err.message);
    }
  };

  const addCase = async (data, opts = {}) => {
    const newCaseData = {
      ...data,
      createdDate: new Date().toISOString().slice(0, 10),
      stageIndex: STAGE_INDEX.STILL_AT_CLINIC, // Rx submitted, work still at clinic (20%)
      handover: null,
      remake: null,
      history: [logEntry("created", STAGE_INDEX.STILL_AT_CLINIC, currentUser, "dentist")],
    };
    try {
      const saved = await insertCase(clinic.id, newCaseData);
      setCases((p) => [saved, ...p]);
      // "Submit & Share" → jump straight into the share flow for the new case.
      if (opts.share) {
        setAutoShare(true);
        setPrintCaseId(saved.id);
      }
    } catch (err) {
      console.error(err);
      alert("Couldn't save the case — " + err.message);
    }
  };

  /* ---------------- Derived lists ---------------- */

  // Search-filtered but NOT status-filtered — the base the filter pill counts
  // are computed from, so a count reflects "if you clicked this pill", not
  // whatever pill happens to be active right now.
  const searchedDentistCases = useMemo(() => {
    if (!query) return cases;
    const q = query.toLowerCase();
    return cases.filter(
      (c) =>
        c.patientName.toLowerCase().includes(q) ||
        c.patientId.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q)
    );
  }, [cases, query]);

  const filteredDentistCases = useMemo(() => {
    if (statusFilter === "all") return searchedDentistCases;
    return searchedDentistCases.filter((c) => {
      if (statusFilter === "in_lab") return c.stageIndex >= STAGE_INDEX.PICKED_UP_BY_LAB && c.stageIndex <= STAGE_INDEX.WORK_COMPLETE;
      if (statusFilter === "received") return c.stageIndex === STAGE_INDEX.CLINIC_RECEIVED;
      if (statusFilter === "urgent") return isUrgent(c);
      return true;
    });
  }, [searchedDentistCases, statusFilter]);

  // RLS already scopes `cases` to this lab's own queue when role === "lab".
  const labQueue = useMemo(() => (!isDentist && lab ? cases.filter((c) => c.labId === lab.id) : []), [cases, isDentist, lab]);

  // Lifecycle drawer context (role + acting user depend on the active account).
  const drawerCase = cases.find((c) => c.id === drawerCaseId) || null;
  const remakeCase = cases.find((c) => c.id === remakeCaseId) || null;
  const printCase = cases.find((c) => c.id === printCaseId) || null;
  const contactCase = cases.find((c) => c.id === contactCaseId) || null;
  const printClinic = printCase ? clinicsById[printCase.clinicId] ?? clinic : null;
  const contactClinic = contactCase ? clinicsById[contactCase.clinicId] ?? clinic : null;

  /* ================================================================ */
  /*  Render                                                          */
  /* ================================================================ */

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      {/* ------------------------- Header / Identity ------------------------- */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-blue-700 text-white">
              <FlaskConical size={18} />
            </div>
            <div>
              <h1 className="text-sm font-bold leading-tight text-slate-800">DentaTrack</h1>
              <p className="text-[11px] leading-tight text-slate-500">{isDentist ? clinic?.name : lab?.name}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isDentist && (
              <button
                onClick={() => setShowSettings(true)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                title="Settings"
              >
                <Settings size={18} />
              </button>
            )}
            <ProfileMenu isDentist={isDentist} clinic={clinic} lab={lab} currentUser={currentUser} onSignOut={signOut} />
            {isDentist && (
              <button
                onClick={() => setShowCaseModal(true)}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
              >
                <FileText size={15} /> New Prescription
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {loadError && (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
            Couldn't load your data: {loadError}
          </div>
        )}
        {loadingData ? (
          <div className="flex items-center justify-center py-24 text-sm text-slate-400">Loading…</div>
        ) : isDentist ? (
          <DentistDashboard
            labById={labById}
            cases={filteredDentistCases}
            countBase={searchedDentistCases}
            totalCases={cases.length}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            query={query}
            setQuery={setQuery}
            onAdvance={(id) => advanceStage(id, currentUser, "dentist")}
            onOpenCase={setDrawerCaseId}
            onShareRx={(id) => { setAutoShare(true); setPrintCaseId(id); }}
            onContactLab={setContactCaseId}
            onExportCsv={() => exportCasesCSV(filteredDentistCases, labs, clinic?.dentist, "dentatrack-clinic-cases.csv")}
          />
        ) : (
          <LabDashboard
            lab={lab}
            queue={labQueue}
            onAdvance={(id) => advanceStage(id, `${lab.name} — ${currentUser}`, "lab")}
            onRevert={(id) => revertStage(id, `${lab.name} — ${currentUser}`, "lab")}
            onOpenCase={setDrawerCaseId}
            onLogRemake={setRemakeCaseId}
            onExportCsv={() => exportCasesCSV(labQueue, labs, (c) => clinicsById[c.clinicId]?.dentist ?? "—", `dentatrack-${lab.id}-cases.csv`)}
          />
        )}
      </main>

      {/* ------------------------- Modals ------------------------- */}
      {isDentist && <AddLabModal open={showLabModal} onClose={() => setShowLabModal(false)} onSave={addLab} />}
      {isDentist && (
        <PrescriptionForm
          open={showCaseModal}
          onClose={() => setShowCaseModal(false)}
          onSave={addCase}
          labs={labs}
        />
      )}

      {/* ------------------- Settings (admin actions live here, off the main dashboard) ------------------- */}
      {isDentist && (
        <SlideOver open={showSettings} onClose={() => setShowSettings(false)} title="Settings" icon={Settings}>
          <div className="space-y-6">
            <div>
              <div className="mb-2.5 flex items-center justify-between">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <Building2 size={13} /> Registered Labs ({labs.length})
                </h4>
                <button
                  onClick={() => { setShowLabModal(true); setShowSettings(false); }}
                  className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
                >
                  <Plus size={13} /> Add Lab
                </button>
              </div>
              <div className="space-y-2">
                {labs.length === 0 && <p className="text-sm text-slate-400">No labs registered yet.</p>}
                {labs.map((l) => (
                  <div key={l.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-800">{l.name}</p>
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                        <Clock size={11} /> {l.tat}d TAT
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {l.contact && l.contact !== "—" && (
                        <a href={`tel:${l.contact.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
                          <Phone size={11} /> {l.contact}
                        </a>
                      )}
                      {l.email && (
                        <a href={`mailto:${l.email}`} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-blue-600">
                          <Mail size={11} /> {l.email}
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="border-t border-slate-100 pt-4">
              <h4 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Reports</h4>
              <button
                onClick={() => { setShowAnalytics(true); setShowSettings(false); }}
                className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <BarChart3 size={16} className="text-blue-600" /> SLA Analytics
              </button>
            </div>
          </div>
        </SlideOver>
      )}
      {isDentist && (
        <Modal open={showAnalytics} onClose={() => setShowAnalytics(false)} title="SLA Analytics" icon={BarChart3} wide>
          <AnalyticsDashboard cases={cases} labs={labs} />
        </Modal>
      )}

      {/* ------------------- Case lifecycle drawer ------------------- */}
      <CaseDrawer
        open={!!drawerCase}
        caseObj={drawerCase}
        role={currentRole}
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
        clinic={printClinic}
        lab={printCase ? labById[printCase.labId] : null}
        autoShare={autoShare}
        onClose={() => { setPrintCaseId(null); setAutoShare(false); }}
      />
      {isDentist && (
        <ContactLabModal
          open={!!contactCase}
          caseObj={contactCase}
          lab={contactCase ? labById[contactCase.labId] : null}
          clinic={contactClinic}
          onClose={() => setContactCaseId(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Dentist Dashboard                                                  */
/* ------------------------------------------------------------------ */

/** Clickable filter pill with a live count — replaces the old bulky stat cards. */
function FilterPill({ active, onClick, label, count, tone }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
        active
          ? "bg-blue-600 text-white shadow-sm"
          : "bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
      }`}
    >
      {label}
      <span
        className={`rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${
          active ? "bg-white/20" : tone === "alert" && count > 0 ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-500"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function DentistDashboard({
  labById,
  cases,
  countBase,
  totalCases,
  statusFilter,
  setStatusFilter,
  query,
  setQuery,
  onAdvance,
  onOpenCase,
  onShareRx,
  onContactLab,
  onExportCsv,
}) {
  // Counts for the filter pills always reflect the searched-but-unfiltered set,
  // so switching pills never has to fight the currently active one.
  const inLabCount = countBase.filter((c) => c.stageIndex >= STAGE_INDEX.PICKED_UP_BY_LAB && c.stageIndex <= STAGE_INDEX.WORK_COMPLETE).length;
  const receivedCount = countBase.filter((c) => c.stageIndex === STAGE_INDEX.CLINIC_RECEIVED).length;
  const urgentCases = countBase.filter(isUrgent);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-800">Cases</h2>
        <p className="flex items-center gap-1.5 text-sm text-slate-500">
          {totalCases} total
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600" title="Live-synced with your lab partners">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> synced
          </span>
        </p>
      </div>

      {/* Appointment alert banner — computed off the full case list, independent of the active pill */}
      {urgentCases.length > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm">
          <AlertTriangle size={16} className="shrink-0 text-rose-600" />
          <span className="font-semibold text-rose-700">{urgentCases.length} case{urgentCases.length > 1 ? "s" : ""} need attention</span>
          <span className="text-rose-600">— appointment within 48h and not yet Clinic Received:</span>
          <span className="font-medium text-rose-700">{urgentCases.map((c) => c.id).join(", ")}</span>
        </div>
      )}

      {/* Toolbar: filter pills (left) + search & export (right), directly above the table */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <FilterPill active={statusFilter === "all"} onClick={() => setStatusFilter("all")} label="All Cases" count={countBase.length} />
          <FilterPill active={statusFilter === "in_lab"} onClick={() => setStatusFilter("in_lab")} label="In Lab" count={inLabCount} />
          <FilterPill active={statusFilter === "received"} onClick={() => setStatusFilter("received")} label="Clinic Received" count={receivedCount} />
          <FilterPill active={statusFilter === "urgent"} onClick={() => setStatusFilter("urgent")} label="Appt. Alerts" count={urgentCases.length} tone="alert" />
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search patient / case ID"
              className="w-56 rounded-lg border border-slate-300 py-1.5 pl-8 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <button
            onClick={onExportCsv}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            title="Export CSV"
          >
            <Download size={15} /> Export CSV
          </button>
        </div>
      </div>

      {/* Cases table — dense, light, built for quick scanning */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Case ID</th>
                <th className="px-4 py-3 font-semibold">Patient Name</th>
                <th className="px-4 py-3 font-semibold">Lab Name</th>
                <th className="px-4 py-3 font-semibold">Appt Date</th>
                <th className="px-4 py-3 font-semibold">Status</th>
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
                  <td className="px-4 py-3.5 align-top font-semibold text-slate-800">
                    {c.id}
                    {c.remake && (
                      <div className="mt-1">
                        <span className="inline-flex items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                          <RefreshCcw size={9} /> Remake
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3.5 align-top">
                    <div className="flex flex-wrap items-baseline gap-x-1.5">
                      <span className="font-semibold text-slate-800">{c.patientName}</span>
                      {c.prescription?.rush && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                          <Zap size={9} /> EXPRESS
                        </span>
                      )}
                    </div>
                    {c.prescription?.category && <div className="mt-0.5 text-[11px] text-slate-400">{c.prescription.category}</div>}
                  </td>
                  <td className="px-4 py-3.5 align-top text-slate-600">{labById[c.labId]?.name ?? "—"}</td>
                  <td className="px-4 py-3.5 align-top whitespace-nowrap">
                    <div className="text-slate-600">{c.appointmentDate}</div>
                    <AppointmentBadge caseObj={c} className="mt-1" />
                  </td>
                  <td className="px-4 py-3.5 align-top">
                    <StatusPill caseObj={c} />
                    {c.handover?.confirmed && (
                      <div className="mt-1">
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                          <CheckCheck size={11} /> {c.handover.type === "Delivered to Clinic" ? "Delivered" : "Picked Up"}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3.5 align-top">
                    <CaseActionsMenu
                      c={c}
                      lab={labById[c.labId]}
                      onOpenCase={onOpenCase}
                      onContactLab={onContactLab}
                      onShareRx={onShareRx}
                      onAdvance={onAdvance}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
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
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500">
            <Clock size={11} /> Deliver {c.appointmentDate}
            {c.deliveryTime && c.deliveryTime !== "Anytime" && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-600">{c.deliveryTime}</span>
            )}
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
          {c.prescription.implantSystem && (
            <div className="mt-1.5 border-t border-slate-200 pt-1.5">
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <span className="rounded bg-indigo-100 px-1.5 py-0.5 font-semibold text-indigo-700">
                  {c.prescription.implantSystem}
                </span>
                <span className="text-slate-600">{c.prescription.abutmentType}</span>
                <span className="font-semibold text-slate-700">{c.prescription.abutmentDiameter}</span>
              </span>
            </div>
          )}
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

// Light, borderless input — sits on a soft gray fill until focused, when it
// lifts to white with a colored ring. Used only by AddLabModal's lighter style.
const lightInputCls =
  "w-full rounded-xl border border-transparent bg-gray-50 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:bg-white focus:ring-2 focus:ring-blue-500";

function AddLabModal({ open, onClose, onSave }) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [tat, setTat] = useState(5);
  const [expressPct, setExpressPct] = useState(20);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const reset = () => {
    setName("");
    setContact("");
    setEmail("");
    setTat(5);
    setExpressPct(20);
    setShowAdvanced(false);
  };

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      contact: contact.trim() || "—",
      email: email.trim(),
      tat: Number(tat) || 1,
      expressPct: Number(expressPct) || 0,
    });
    reset();
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Add Laboratory">
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Laboratory Name</span>
          <input
            className={`${lightInputCls} py-3.5 text-base font-medium placeholder:font-normal`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Summit Prosthetics"
            autoFocus
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Phone Number</span>
          <input
            className={lightInputCls}
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="+968 9000 0000"
            inputMode="tel"
          />
        </label>

        {showAdvanced ? (
          <div className="space-y-3.5 rounded-xl border border-dashed border-gray-200 p-3.5">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Email</span>
              <input type="email" className={lightInputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="orders@lab.com" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">Default Turnaround (Days)</span>
                <input type="number" min={1} className={lightInputCls} value={tat} onChange={(e) => setTat(e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">Express Surcharge (%)</span>
                <input type="number" min={0} className={lightInputCls} value={expressPct} onChange={(e) => setExpressPct(e.target.value)} />
              </label>
            </div>
            <button
              type="button"
              onClick={() => setShowAdvanced(false)}
              className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-600"
            >
              <ChevronDown size={13} className="rotate-180" /> Hide advanced settings
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowAdvanced(true)}
            className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:underline"
          >
            <ChevronDown size={14} /> Show advanced settings
            <span className="font-normal text-slate-400">(email, turnaround, express fee)</span>
          </button>
        )}

        <div className="flex items-center justify-between pt-2">
          <button type="button" onClick={onClose} className="text-sm font-semibold text-slate-500 hover:text-slate-700">
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/30 transition hover:bg-blue-700"
          >
            Save Lab
          </button>
        </div>
      </form>
    </Modal>
  );
}
