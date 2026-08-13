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
  AlertTriangle,
  CheckCheck,
  BarChart3,
  Download,
  RefreshCcw,
  MessageCircle,
  Phone,
  Mail,
  LogOut,
  Settings,
  CircleUser,
  ChevronDown,
  ChevronRight,
  MoreVertical,
  Plus,
  Eye,
  Undo2,
  Receipt,
  Lock,
  Check,
  UserCog,
  Camera,
  Image as ImageIcon,
  ScanLine,
} from "lucide-react";
import PrescriptionForm, { toothSummary, includedSummary, CATEGORY_NAMES } from "./PrescriptionForm.jsx";
import DeviceManagement from "./DeviceManagement.jsx";
import {
  STAGES,
  STAGE_INDEX,
  LAST_STAGE,
  StatusPill,
  AppointmentBadge,
  CaseDrawer,
  isUrgent,
} from "./LifecycleEngine.jsx";
import { AnalyticsDashboard, computeAnalytics } from "./Analytics.jsx";
import { RemakeModal } from "./Remake.jsx";
import PrintRx from "./PrintRx.jsx";
import ContactLabModal from "./ContactLab.jsx";
import { exportCasesCSV } from "./exportCsv.js";
import {
  fetchLabs,
  insertLab,
  fetchCases,
  insertCase,
  updateCase,
  subscribeCases,
  fetchClinicsByIds,
  caseFromRow,
  updateProfile,
  uploadAvatar,
  updateLab,
} from "./lib/data.js";

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
function Avatar({ url, size = 20 }) {
  if (url) {
    return <img src={url} alt="" className="rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return <CircleUser size={size} className="text-slate-400" />;
}

function ProfileMenu({ isDentist, clinic, lab, currentUser, avatarUrl, onSignOut, onOpenProfile }) {
  const { open, setOpen, ref } = useDropdown();
  const orgName = isDentist ? clinic?.name : lab?.name;
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
      >
        <Avatar url={avatarUrl} size={20} />
        <span className="hidden text-left sm:block">
          <span className="block leading-tight text-slate-800">{currentUser}</span>
          <span className="block text-[11px] font-normal leading-tight text-slate-400">{orgName}</span>
        </span>
        <ChevronDown size={14} className={`text-slate-400 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1.5 w-56 rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl">
          <div className="flex items-center gap-2.5 border-b border-slate-100 px-3.5 py-2.5">
            <Avatar url={avatarUrl} size={30} />
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                {isDentist ? <Stethoscope size={13} className="text-blue-600" /> : <Building2 size={13} className="text-blue-600" />}
                <span className="truncate">{orgName}</span>
              </p>
              <p className="mt-0.5 truncate text-xs text-slate-400">{currentUser} · {isDentist ? "Dentist" : "Lab"}</p>
            </div>
          </div>
          <button
            onClick={() => { setOpen(false); onOpenProfile(); }}
            className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <UserCog size={14} /> Profile settings
          </button>
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
 * Self-service profile — photo, name, phone. Email is deliberately
 * read-only: it's the auth.users login identity, not something either
 * role should be able to drift away from what they actually sign in with.
 */
function ProfileSettingsModal({ open, onClose, auth }) {
  const { session, profile, refreshProfile } = auth;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  // Initialize ONLY on open — `profile` gets a new identity on every auth
  // event (token refresh, tab focus), which would wipe unsaved edits if it
  // were a dependency here. Same bug class as LabSettingsDrawer's form.
  useEffect(() => {
    if (!open) return;
    setName(profile?.name ?? "");
    setPhone(profile?.phone ?? "");
    setAvatarUrl(profile?.avatar_url ?? "");
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const url = await uploadAvatar(session.user.id, file);
      setAvatarUrl(url);
    } catch (err) {
      setError("Couldn't upload that photo — " + err.message);
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await updateProfile(session.user.id, { name: name.trim(), phone: phone.replace(/\D/g, "").slice(0, 8), avatarUrl });
      await refreshProfile();
      onClose();
    } catch (err) {
      setError("Couldn't save — " + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Profile Settings" icon={UserCog}>
      <div className="space-y-4">
        {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200"
            title="Change photo"
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <CircleUser size={34} className="absolute inset-0 m-auto text-slate-300" />
            )}
            <span className="absolute inset-0 flex items-center justify-center bg-slate-900/0 opacity-0 transition group-hover:bg-slate-900/50 group-hover:opacity-100">
              <Camera size={18} className="text-white" />
            </span>
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
          <div className="text-xs text-slate-500">
            <p className="font-medium text-slate-700">{uploading ? "Uploading…" : "Profile photo"}</p>
            <p>JPG or PNG works best.</p>
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={lightInputCls} placeholder="Your name" />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Email</span>
          <input
            value={session?.user?.email ?? ""}
            disabled
            className={`${lightInputCls} cursor-not-allowed text-slate-400`}
            title="Email is your login and can't be changed here"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Phone (Oman)</span>
          <div className="flex items-center gap-2">
            <span className="shrink-0 rounded-xl bg-gray-50 px-3.5 py-2.5 text-sm font-medium text-slate-500">00968</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 8))}
              className={lightInputCls}
              placeholder="9XXXXXXX"
              inputMode="numeric"
            />
          </div>
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="text-sm font-semibold text-slate-500 hover:text-slate-700">
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || uploading}
            className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/30 transition hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Full prescription read-out for the case drawer — what the dentist ordered
 * and sent. This is the lab's primary reference for a case (the compact lab
 * card only surfaces Material/Teeth/Shade), and doubles as the dentist's own
 * record of what was submitted.
 */
function CaseRxDetails({ c }) {
  const p = c.prescription;
  const restorations = p?.restorations ?? [];
  const hasCart = restorations.length > 0;
  if (!p?.category && !hasCart) return <p className="text-sm text-slate-400">No prescription details on this case.</p>;

  const row = (label, value) =>
    value ? (
      <div className="flex items-start justify-between gap-3 py-1.5">
        <span className="shrink-0 text-xs font-medium text-slate-400">{label}</span>
        <span className="text-right text-sm font-semibold text-slate-700">{value}</span>
      </div>
    ) : null;

  // Rows for ONE restoration — reused per card in cart mode, and (with the
  // whole prescription as the "restoration") for the legacy single-item shape.
  const specRows = (r) => {
    const shade = r.vitaShade && r.vitaShade !== "N/A" ? `${r.vitaShade}${r.shadeGuide && r.shadeGuide !== "N/A" ? ` (${r.shadeGuide})` : ""}` : null;
    const teethLabel = toothSummary({ teeth: r.teeth, notation: p.notation });
    return (
      <div className="divide-y divide-slate-100">
        {row("Procedure", r.category)}
        {row("Material", r.material !== "Refer to notes" ? r.material : null)}
        {row("Teeth", teethLabel)}
        {row("Shade", shade)}
        {row("Stump shade", r.stumpShade && r.stumpShade !== "N/A" ? r.stumpShade : null)}
        {row("Pontic design", r.ponticDesign && (hasCart || teethLabel.includes("(p)")) ? r.ponticDesign : null)}
        {row("Implant system", r.implantSystem)}
        {row("Abutment", r.implantSystem ? `${r.abutmentType ?? ""} ${r.abutmentDiameter ?? ""}`.trim() : null)}
        {row("Abutment colour code", r.abutmentColor || null)}
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-2">
      {p.rush && (
        <div className="my-1.5 flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 ring-1 ring-inset ring-amber-100">
          <Zap size={12} /> EXPRESS ORDER
        </div>
      )}
      {hasCart ? (
        <div className="space-y-2.5 py-1.5">
          {restorations.map((r, i) => (
            <div key={r.id ?? i} className="rounded-lg border border-slate-200 bg-white px-3">
              <p className="pt-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Restoration {i + 1} of {restorations.length}</p>
              {specRows(r)}
            </div>
          ))}
        </div>
      ) : (
        specRows(p)
      )}
      <div className="divide-y divide-slate-100">
        {row("Deliver by", c.appointmentDate ? `${c.appointmentDate}${c.deliveryTime && c.deliveryTime !== "Anytime" ? ` · ${c.deliveryTime}` : ""}` : null)}
        {row("Included", includedSummary(p))}
        {row("Scans", p.files?.filter((f) => f.kind === "scan").length ? `${p.files.filter((f) => f.kind === "scan").length} STL file(s)` : null)}
        {row("Patient ID", c.patientId !== "PT-NEW" ? c.patientId : null)}
        {row("Patient WhatsApp", c.patientPhone || null)}
      </div>
      {p.notes && (
        <div className="mb-2 mt-1.5 rounded-lg bg-white px-3 py-2 text-sm text-slate-600 ring-1 ring-inset ring-slate-100">
          <span className="mr-1 text-xs font-semibold text-slate-400">Notes:</span>
          {p.notes}
        </div>
      )}
      <CaseRxPhotos files={p.files} />
    </div>
  );
}

/**
 * Clinical/shade photos, shown as real thumbnails (not just a filename
 * count) — this is the whole point: the lab should actually see what the
 * dentist sent. Click a thumbnail to view it full-size in an in-app
 * lightbox — NOT a target="_blank" link: in the installed PWA (and some
 * mobile browsers) that navigates the app itself to the image URL instead
 * of opening a real new tab, so "back" lands on the dashboard instead of
 * reopening this drawer. A lightbox never leaves the page at all.
 */
function CaseRxPhotos({ files }) {
  const [lightbox, setLightbox] = useState(null);
  const photos = (files ?? []).filter((f) => f.kind === "photo" && f.url);
  if (photos.length === 0) return null;
  return (
    <div className="mb-2 mt-1.5">
      <span className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-slate-400">
        <ImageIcon size={12} /> Photos ({photos.length})
      </span>
      <div className="grid grid-cols-4 gap-1.5">
        {photos.map((f, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setLightbox(f)}
            className="aspect-square overflow-hidden rounded-lg bg-slate-100 ring-1 ring-inset ring-slate-200 transition hover:ring-2 hover:ring-blue-300"
            title={f.name}
          >
            <img src={f.url} alt={f.name} className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
      {lightbox &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/80 p-6"
            onClick={() => setLightbox(null)}
          >
            <img src={lightbox.url} alt={lightbox.name} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
            <button
              type="button"
              onClick={() => setLightbox(null)}
              className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
              title="Close"
            >
              <X size={22} />
            </button>
            <a
              href={lightbox.url}
              download={lightbox.name}
              onClick={(e) => e.stopPropagation()}
              className="absolute bottom-4 right-4 flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/20"
            >
              <Download size={15} /> Download
            </a>
          </div>,
          document.body
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
  const { profile, clinic, lab, signOut, refreshProfile } = auth;
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
  // Self-service profile (photo/name/phone) — available to both roles.
  const [showProfileSettings, setShowProfileSettings] = useState(false);

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

  // Lab's own internal billing/job reference for a case — no history entry,
  // this isn't a lifecycle event, just a label the lab attaches for its
  // own accounting.
  const setInvoiceNumber = (caseId, invoiceNumber) => persist(caseId, { invoiceNumber });

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
              <h1 className="text-sm font-bold leading-tight text-slate-800">Dr-Crown</h1>
              <p className="text-[11px] leading-tight text-slate-500">{isDentist ? clinic?.name : lab?.name}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(true)}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              title="Settings"
            >
              <Settings size={18} />
            </button>
            <ProfileMenu
              isDentist={isDentist}
              clinic={clinic}
              lab={lab}
              currentUser={currentUser}
              avatarUrl={profile.avatar_url}
              onSignOut={signOut}
              onOpenProfile={() => setShowProfileSettings(true)}
            />
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
            onSetInvoiceNumber={setInvoiceNumber}
            onExportCsv={() => exportCasesCSV(labQueue, labs, (c) => clinicsById[c.clinicId]?.dentist ?? "—", `dentatrack-${lab.id}-cases.csv`)}
          />
        )}
      </main>

      {/* ------------------------- Modals ------------------------- */}
      <ProfileSettingsModal open={showProfileSettings} onClose={() => setShowProfileSettings(false)} auth={auth} />
      {isDentist && <AddLabModal open={showLabModal} onClose={() => setShowLabModal(false)} onSave={addLab} />}
      {isDentist && (
        <PrescriptionForm
          open={showCaseModal}
          onClose={() => setShowCaseModal(false)}
          onSave={addCase}
          labs={labs}
          userId={auth.session?.user?.id}
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
                        <Clock size={11} /> {l.tat}d Turn around time
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
            <div className="border-t border-slate-100 pt-4">
              <h4 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Signed-in devices
              </h4>
              <DeviceManagement />
            </div>
          </div>
        </SlideOver>
      )}
      {isDentist && (
        <Modal open={showAnalytics} onClose={() => setShowAnalytics(false)} title="SLA Analytics" icon={BarChart3} wide>
          <AnalyticsDashboard cases={cases} labs={labs} />
        </Modal>
      )}
      {!isDentist && lab && (
        <LabSettingsDrawer
          open={showSettings}
          onClose={() => setShowSettings(false)}
          lab={lab}
          onSaved={refreshProfile}
        />
      )}

      {/* ------------------- Case lifecycle drawer ------------------- */}
      <CaseDrawer
        open={!!drawerCase}
        caseObj={drawerCase}
        role={currentRole}
        authorName={currentUser}
        rxDetails={drawerCase ? <CaseRxDetails c={drawerCase} /> : null}
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
                    {c.prescription?.restorations?.length ? (
                      <div className="mt-0.5 text-[11px] text-slate-400">
                        {c.prescription.restorations.length} restoration{c.prescription.restorations.length === 1 ? "" : "s"}: {c.prescription.restorations.map((r) => r.category).join(", ")}
                      </div>
                    ) : (
                      c.prescription?.category && <div className="mt-0.5 text-[11px] text-slate-400">{c.prescription.category}</div>
                    )}
                  </td>
                  <td className="px-4 py-3.5 align-top text-slate-600">{labById[c.labId]?.name ?? "—"}</td>
                  <td className="px-4 py-3.5 align-top whitespace-nowrap">
                    <div className="text-slate-600">{c.appointmentDate}</div>
                    <AppointmentBadge caseObj={c} className="mt-1" />
                  </td>
                  <td className="px-4 py-3.5 align-top">
                    <StatusPill caseObj={c} />
                    {/* Lab's invoice number — appears once the lab enters one */}
                    {c.invoiceNumber && (
                      <div className="mt-1">
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200"
                          title="Invoice number from the lab"
                        >
                          <Check size={11} /> {c.invoiceNumber}
                        </span>
                      </div>
                    )}
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

// Soft-tinted active state per tab — "Completed" reads as a calm green,
// "Incoming" a fresh sky blue, "In Production" mid-blue, so the active tab
// is unmistakable without relying on color alone (the label is always there).
const QUEUE_TAB_DEFS = [
  { key: "incoming", label: "Incoming", activeCls: "bg-sky-100 text-sky-700 ring-sky-200" },
  { key: "in_production", label: "In Production", activeCls: "bg-blue-100 text-blue-700 ring-blue-200" },
  { key: "completed", label: "Completed", activeCls: "bg-emerald-100 text-emerald-700 ring-emerald-200" },
];

function LabDashboard({ lab, queue, onAdvance, onRevert, onOpenCase, onLogRemake, onSetInvoiceNumber, onExportCsv }) {
  const [queueTab, setQueueTab] = useState("incoming");
  // Brief confirmation after a stage change moves a case out of the tab
  // you're looking at — without this, advancing the only case in "Incoming"
  // just makes the list go blank with no explanation (looked like the case
  // vanished; it just moved to the "In Production" tab).
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  if (!lab) return null;

  const inIncoming = (c) => c.stageIndex === STAGE_INDEX.STILL_AT_CLINIC;
  const inProduction = (c) => c.stageIndex >= STAGE_INDEX.PICKED_UP_BY_LAB && c.stageIndex < STAGE_INDEX.WORK_COMPLETE;
  const inCompleted = (c) => c.stageIndex >= STAGE_INDEX.WORK_COMPLETE;
  const BUCKET = { incoming: inIncoming, in_production: inProduction, completed: inCompleted };
  const bucketOf = (stageIndex) =>
    Object.entries(BUCKET).find(([, test]) => test({ stageIndex }))?.[0] ?? "incoming";

  const tabs = QUEUE_TAB_DEFS.map((t) => ({ ...t, count: queue.filter(BUCKET[t.key]).length }));
  const visibleQueue = queue.filter(BUCKET[queueTab]);
  const activeLabel = tabs.find((t) => t.key === queueTab)?.label ?? "";

  // Wrap advance/revert so the view follows the case to wherever it lands —
  // and says so — instead of silently leaving the current tab empty.
  const followCase = (caseId, nextStageIndex) => {
    const nextTab = bucketOf(nextStageIndex);
    if (nextTab !== queueTab) {
      setQueueTab(nextTab);
      const label = QUEUE_TAB_DEFS.find((t) => t.key === nextTab)?.label ?? nextTab;
      setToast(`Case moved to "${label}" — showing it here now.`);
    }
  };
  const handleAdvance = (caseId) => {
    const c = queue.find((x) => x.id === caseId);
    onAdvance(caseId);
    if (c) followCase(caseId, c.stageIndex + 1);
  };
  const handleRevert = (caseId) => {
    const c = queue.find((x) => x.id === caseId);
    onRevert(caseId);
    if (c) followCase(caseId, c.stageIndex - 1);
  };

  // This lab's own SLA snapshot.
  const { perLab } = computeAnalytics(queue, [lab]);
  const sla = perLab[0];

  return (
    <div className="space-y-5">
      {/* Lab info sub-header — contact/turnaround details live in Settings now */}
      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800">
          <Building2 size={18} className="text-blue-600" /> {lab.name}
        </h2>
        <p className="text-sm text-slate-500">Production Queue</p>
      </div>

      {/* Queue tabs + Export, in one row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setQueueTab(t.key)}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 ring-inset transition ${
                queueTab === t.key ? t.activeCls : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              {t.label}
              <span className={`rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${queueTab === t.key ? "bg-white/60" : "bg-slate-100 text-slate-500"}`}>
                {t.count}
              </span>
            </button>
          ))}
        </div>
        <button
          onClick={onExportCsv}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          <Download size={15} /> Export CSV
        </button>
      </div>

      {/* Lab SLA snapshot */}
      <div className="w-full max-w-[220px] rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:max-w-[240px]">
        <p className="text-[11px] font-medium text-slate-500">Actual Turn around time</p>
        <p className="mt-0.5 text-lg font-bold text-slate-800">{sla.actualTat != null ? `${sla.actualTat.toFixed(1)}d` : "—"} <span className="text-xs font-medium text-slate-400">/ {sla.promisedTat}d</span></p>
      </div>

      {/* Case list — compact rows, not cards, so several fit without scrolling */}
      {visibleQueue.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-sm text-slate-400">
          No {activeLabel.toLowerCase()} cases right now.
        </div>
      ) : (
        <div className="space-y-2.5">
          {visibleQueue.map((c) => (
            <LabCaseCard
              key={c.id}
              c={c}
              onAdvance={handleAdvance}
              onRevert={handleRevert}
              onOpenCase={onOpenCase}
              onLogRemake={onLogRemake}
              onSetInvoiceNumber={onSetInvoiceNumber}
            />
          ))}
        </div>
      )}

      {/* Toast: confirms a stage change moved the case to a different tab */}
      {toast && (
        <div className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <div className="flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg">
            <CheckCheck size={16} className="text-emerald-400" /> {toast}
          </div>
        </div>
      )}
    </div>
  );
}

const STAGE_SHORT_LABEL = ["Clinic", "Lab received", "In Progress", "Complete", "Clinic received"];

/** Minimal 5-dot lifecycle indicator — replaces the old percentage + text stepper. */
function CaseStageDots({ stageIndex }) {
  return (
    <div className="flex">
      {STAGES.map((s, i) => {
        const done = i < stageIndex;
        const current = i === stageIndex;
        const Icon = s.icon;
        const leftFilled = i <= stageIndex;
        const rightFilled = i < stageIndex;
        return (
          <div key={s.key} className="relative flex flex-1 flex-col items-center">
            {i > 0 && (
              <div className="absolute left-0 right-1/2 top-3 h-1 rounded-full" style={{ background: leftFilled ? STAGES[i - 1].color : "#e2e8f0" }} />
            )}
            {i < STAGES.length - 1 && (
              <div className="absolute left-1/2 right-0 top-3 h-1 rounded-full" style={{ background: rightFilled ? s.color : "#e2e8f0" }} />
            )}
            <div
              className="relative z-10 flex shrink-0 items-center justify-center rounded-full transition-all"
              style={
                current
                  ? { width: 28, height: 28, background: s.color, color: "#fff", boxShadow: `0 0 0 4px ${s.color}26` }
                  : done
                  ? { width: 22, height: 22, background: s.color, color: "#fff" }
                  : { width: 22, height: 22, background: "#fff", color: "#94a3b8", border: "2px solid #e2e8f0" }
              }
            >
              <Icon size={current ? 14 : 11} />
            </div>
            <span className={`mt-1 text-center text-[10px] font-bold leading-tight ${current ? "text-slate-800" : done ? "text-slate-400" : "text-slate-300"}`}>
              {STAGE_SHORT_LABEL[i]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * "···" options menu — Revert and Log Remake are real but easy-to-misclick
 * actions on a busy bench, so they live here instead of next to the one
 * button a tech is meant to actually reach for.
 */
function CaseCardOptionsMenu({ c, canRevert, revertLabel, onRevert, onLogRemake, onOpenCase }) {
  const { open, setOpen, ref } = useDropdown();
  const item = (onClick, icon, label, extraCls = "") => (
    <button
      onClick={() => { setOpen(false); onClick(); }}
      className={`flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm font-medium text-slate-600 hover:bg-slate-50 ${extraCls}`}
    >
      {icon} {label}
    </button>
  );
  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        title="More options"
      >
        <MoreVertical size={18} />
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-20 w-52 rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl">
          {item(() => onOpenCase(c.id), <Eye size={14} />, "View Details")}
          {canRevert && item(onRevert, <Undo2 size={14} />, revertLabel)}
          {item(
            () => onLogRemake(c.id),
            <RefreshCcw size={14} className={c.remake ? "text-rose-600" : ""} />,
            c.remake ? "Update Remake" : "Log Remake",
            c.remake ? "text-rose-700" : ""
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The lab's own internal billing/job reference for a case — click to edit,
 * Enter/blur saves, Escape cancels. Distinct from the system case id: this
 * is a free-text number the lab assigns itself, never the dentist.
 */
function InvoiceNumberField({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== (value || "")) onSave(trimmed);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") cancel();
          }}
          placeholder="e.g. INV-1042"
          className="w-32 rounded-lg border border-blue-300 px-2 py-1 font-mono text-base font-black tracking-wide text-slate-800 outline-none ring-2 ring-blue-100"
        />
        <button onMouseDown={(e) => e.preventDefault()} onClick={commit} className="rounded-lg p-1 text-emerald-600 hover:bg-emerald-50" title="Save">
          <Check size={16} />
        </button>
      </div>
    );
  }

  // Once set, an invoice number is pushed to the clinic and LOCKED — no
  // editing (also enforced by a DB trigger, so this isn't just cosmetic).
  return value ? (
    <div
      className="flex items-center gap-1.5"
      title="Invoice number is locked once pushed to the clinic"
    >
      <Receipt size={15} className="shrink-0 text-slate-400" />
      <span className="font-mono text-lg font-black leading-tight tracking-wide text-slate-800">{value}</span>
      <Lock size={12} className="text-slate-300" />
    </div>
  ) : (
    <button
      onClick={() => setEditing(true)}
      className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:underline"
    >
      <Receipt size={14} /> Add invoice #
    </button>
  );
}

function LabCaseCard({ c, onAdvance, onRevert, onOpenCase, onLogRemake, onSetInvoiceNumber }) {
  const idx = c.stageIndex;
  const cur = STAGES[idx];
  const next = STAGES[idx + 1];
  const canAdvance = !!next && next.actor === "lab";
  const canRevert = idx > 0 && cur.actor === "lab";
  const waitingOn = next && !canAdvance ? (next.actor === "lab" ? "Lab" : "Clinic") : null;
  const urgent = isUrgent(c);

  return (
    <div className={`rounded-2xl border bg-white p-4 shadow-sm ${urgent ? "border-rose-300" : "border-slate-200"}`}>
      {/* Identity — the lab's own invoice number, not the system case id
          (still available via View Details for cross-referencing with the clinic) */}
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <InvoiceNumberField value={c.invoiceNumber} onSave={(v) => onSetInvoiceNumber(c.id, v)} />
          <p className="truncate text-sm font-semibold text-slate-600">{c.patientName}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {urgent && <AppointmentBadge caseObj={c} />}
          {c.remake && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-700">
              <RefreshCcw size={11} /> Remake
            </span>
          )}
          <CaseCardOptionsMenu
            c={c}
            canRevert={canRevert}
            revertLabel={canRevert ? `Revert to ${STAGES[idx - 1].label}` : ""}
            onRevert={() => onRevert(c.id)}
            onLogRemake={onLogRemake}
            onOpenCase={onOpenCase}
          />
        </div>
      </div>

      {/* Critical info — Material / Teeth / Shade in one subtly shaded row, not a wall of text */}
      {c.prescription && (
        <div className="mb-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg bg-slate-50 px-3.5 py-2.5 text-sm ring-1 ring-inset ring-slate-100">
          {c.prescription.restorations?.length ? (
            <span>
              <span className="font-medium text-slate-400">Restorations </span>
              <span className="font-bold text-slate-700">
                {c.prescription.restorations.length} ·{" "}
                {c.prescription.restorations
                  .map((r) => `${r.category} (${toothSummary({ teeth: r.teeth, notation: c.prescription.notation }) || "—"})`)
                  .join(", ")}
              </span>
            </span>
          ) : (
            <>
              <span>
                <span className="font-medium text-slate-400">Material </span>
                <span className="font-bold text-slate-700">{c.prescription.material || "—"}</span>
              </span>
              <span>
                <span className="font-medium text-slate-400">Teeth </span>
                <span className="font-bold text-slate-700">{toothSummary(c.prescription) || "—"}</span>
              </span>
              <span>
                <span className="font-medium text-slate-400">Shade </span>
                <span className="font-bold text-slate-700">
                  {c.prescription.vitaShade && c.prescription.vitaShade !== "N/A" ? c.prescription.vitaShade : "—"}
                </span>
              </span>
            </>
          )}
          {c.prescription.files?.some((f) => f.kind === "photo" && f.url) && (
            <span className="ml-auto flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-bold text-violet-700">
              <ImageIcon size={11} /> {c.prescription.files.filter((f) => f.kind === "photo" && f.url).length}
            </span>
          )}
        </div>
      )}

      {c.prescription?.rush && (
        <div className="mb-2.5 flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 ring-1 ring-inset ring-amber-100">
          <Zap size={12} /> EXPRESS · deliver {c.appointmentDate || "—"}
          {c.deliveryTime && c.deliveryTime !== "Anytime" && ` · ${c.deliveryTime}`}
        </div>
      )}

      {/* Visual progress — 5 dots, current step highlighted, no percentages or paragraphs */}
      <div className="mb-3">
        <CaseStageDots stageIndex={idx} />
      </div>

      {/* ONE primary action — tidy and right-aligned rather than a full-width banner */}
      {next ? (
        canAdvance ? (
          <div className="flex justify-end">
            <button
              onClick={() => onAdvance(c.id)}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold text-white shadow-sm transition active:scale-[0.98]"
              style={{ background: next.color }}
              title={`Move to ${next.label}`}
            >
              Next
              <ChevronRight size={15} />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-1.5 text-xs font-semibold text-slate-400">
            <Clock size={13} /> Waiting on {waitingOn}
          </div>
        )
      ) : (
        <div className="flex items-center justify-end gap-1.5 text-xs font-bold text-emerald-600">
          {React.createElement(cur.icon, { size: 14 })} Complete
        </div>
      )}
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
  const [showAdvanced, setShowAdvanced] = useState(false);

  const reset = () => {
    setName("");
    setContact("");
    setEmail("");
    setTat(5);
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
            placeholder="00968 9000 0000"
            inputMode="tel"
          />
        </label>

        {showAdvanced ? (
          <div className="space-y-3.5 rounded-xl border border-dashed border-gray-200 p-3.5">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Email</span>
              <input type="email" className={lightInputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="orders@lab.com" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Default Turnaround (Days)</span>
              <input type="number" min={1} className={lightInputCls} value={tat} onChange={(e) => setTat(e.target.value)} />
            </label>
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
            <span className="font-normal text-slate-400">(email, turnaround)</span>
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

/* ------------------------------------------------------------------ */
/*  Lab Settings — contact/turnaround info (moved off the dashboard    */
/*  header) plus a per-procedure turnaround time list. Each procedure  */
/*  mirrors the Rx form's category dropdown; a blank value falls back  */
/*  to the lab's standard turnaround.                                  */
/* ------------------------------------------------------------------ */

function LabSettingsDrawer({ open, onClose, lab, onSaved }) {
  const [contact, setContact] = useState("");
  const [tat, setTat] = useState(5);
  const [procTats, setProcTats] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Initialize ONLY on open — not on every `lab` identity change. Supabase
  // re-emits auth events (token refresh, tab focus) which reload the profile
  // and recreate `lab`; with `lab` in the deps this effect would wipe the
  // user's unsaved edits mid-typing (found live: saved {} over real input).
  useEffect(() => {
    if (!open) return;
    setContact(lab.contact ?? "");
    setTat(lab.tat ?? 5);
    setProcTats(lab.procedureTats ?? {});
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const setProc = (name, value) => {
    setProcTats((prev) => {
      const next = { ...prev };
      const n = Number(value);
      if (!value || !n || n < 1) delete next[name];
      else next[name] = n;
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await updateLab(lab.id, {
        contact: contact.trim(),
        tat: Math.max(1, Number(tat) || 1),
        procedureTats: procTats,
      });
      await onSaved();
      onClose();
    } catch (err) {
      setError("Couldn't save — " + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SlideOver open={open} onClose={onClose} title="Lab Settings" icon={Settings}>
      <div className="space-y-6">
        <div>
          <h4 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Lab Info</h4>
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Phone</span>
              <input value={contact} onChange={(e) => setContact(e.target.value)} className={lightInputCls} placeholder="00968 9000 0000" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Standard turn around (days)</span>
              <input type="number" min={1} value={tat} onChange={(e) => setTat(e.target.value)} className={lightInputCls} />
            </label>
          </div>
        </div>

        <div className="border-t border-slate-100 pt-4">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Turn around time per procedure</h4>
          <p className="mb-3 text-[11px] text-slate-400">
            Days for each procedure. Leave blank to use your standard ({Number(tat) || 1}d). Dentists see these when scheduling.
          </p>
          <div className="space-y-1.5">
            {CATEGORY_NAMES.map((name) => (
              <div key={name} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{name}</span>
                <div className="flex shrink-0 items-center gap-1.5">
                  <input
                    type="number"
                    min={1}
                    value={procTats[name] ?? ""}
                    onChange={(e) => setProc(name, e.target.value)}
                    placeholder={String(Number(tat) || 1)}
                    className="w-16 rounded-lg border border-transparent bg-gray-50 px-2 py-1.5 text-center text-sm text-slate-800 outline-none transition focus:bg-white focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-xs text-slate-400">d</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-slate-100 pt-4">
          <h4 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Signed-in devices
          </h4>
          <DeviceManagement />
        </div>

        <div className="sticky bottom-0 -mx-5 border-t border-slate-100 bg-white px-5 py-3">
          {/* Error lives in the sticky footer so it can't be scrolled out of view */}
          {error && <div className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
          <button
            onClick={save}
            disabled={saving}
            className="w-full rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/30 transition hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save Settings"}
          </button>
        </div>
      </div>
    </SlideOver>
  );
}
