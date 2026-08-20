import React, { useState, useMemo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Building2,
  Stethoscope,
  Pencil,
  MapPin,
  CheckCircle2,
  X,
  Search,
  ClipboardCheck,
  Clock,
  FlaskConical,
  FileText,
  Wallet,
  Ban,
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
  ArrowRight,
  MoreVertical,
  Plus,
  Eye,
  Undo2,
  Receipt,
  Check,
  UserCog,
  Camera,
  Image as ImageIcon,
  History as HistoryIcon,
  ScanLine,
  Truck,
  Shield,
  Wrench,
  LayoutDashboard,
  Users,
  Tags,
  UserPlus,
} from "lucide-react";
import PrescriptionForm, { toothSummary, includedSummary, CATEGORY_NAMES, SHADE_BY_LAB } from "./PrescriptionForm.jsx";
import DeviceManagement from "./DeviceManagement.jsx";
import {
  STAGES,
  STAGE_INDEX,
  LAST_STAGE,
  StatusPill,
  AppointmentBadge,
  CaseDrawer,
  isUrgent,
  CasePriceField,
  LabShadeField,
  needsLabShade,
} from "./LifecycleEngine.jsx";
import { AnalyticsDashboard, computeAnalytics, caseFee } from "./Analytics.jsx";
import { PriceListsManager, OverviewDashboard, TechniciansPanel, StaffPanel } from "./LabAdmin.jsx";
import { BillingPanel, ExpensesPanel } from "./LabFinance.jsx";
import { RemakeModal } from "./Remake.jsx";
import PrintRx from "./PrintRx.jsx";
import ContactLabModal from "./ContactLab.jsx";
import { exportCasesCSV } from "./exportCsv.js";
import {
  fetchLabs,
  fetchCases,
  insertCase,
  updateCase,
  subscribeCases,
  fetchClinicsByIds,
  fetchClinicsByOwner,
  insertClinic,
  updateClinic,
  caseFromRow,
  updateProfile,
  uploadAvatar,
  updateLab,
  fetchLabRoster,
} from "./lib/data.js";
import { OmanLocationFields } from "./lib/omanRegions.jsx";

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
                {isDentist ? <Stethoscope size={13} className="shrink-0 text-blue-600" /> : <Building2 size={13} className="shrink-0 text-blue-600" />}
                <span className="min-w-0 truncate">{orgName}</span>
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
            {/* Full-overlay hint on hover for mouse users, but also a small
                persistent badge — a hover-only affordance gives no visual
                cue at all that this is tappable on a touch-only device. */}
            <span className="absolute inset-0 flex items-center justify-center bg-slate-900/0 opacity-0 transition group-hover:bg-slate-900/50 group-hover:opacity-100">
              <Camera size={18} className="text-white" />
            </span>
            <span className="absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-white ring-2 ring-white">
              <Camera size={11} />
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
    const shade =
      r.shadeGuide === SHADE_BY_LAB
        ? c.labShade
          ? `${SHADE_BY_LAB} — ${c.labShade}`
          : SHADE_BY_LAB
        : r.vitaShade && r.vitaShade !== "N/A"
        ? `${r.vitaShade}${r.shadeGuide && r.shadeGuide !== "N/A" ? ` (${r.shadeGuide})` : ""}`
        : null;
    const teethLabel = toothSummary({ teeth: r.teeth, notation: p.notation });
    return (
      <div className="divide-y divide-slate-100">
        {row("Procedure", r.category)}
        {row("Material", r.material !== "Refer to notes" ? r.material : null)}
        {row("Teeth", teethLabel)}
        {row("Shade", shade)}
        {row("Stump shade", r.stumpShade && r.stumpShade !== "N/A" ? r.stumpShade : null)}
        {row("Implant brand", r.implantSystem)}
        {row("Abutment size", r.abutmentType)}
        {row("Abutment colour code", r.abutmentColor || null)}
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-2">
      {p.pickupRequested && (
        <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 ring-1 ring-inset ring-blue-100">
          <Truck size={13} /> Lab pick-up requested — collect this case from the clinic
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
function CaseActionsMenu({ c, lab, onOpenCase, onContactLab, onShareRx, onAdvance, onEditRx, onRequestCancel, onWithdrawCancel }) {
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
            {/* Only offered inside the 30-minute post-submission window
                (parent passes null past it — the DB trigger enforces it
                regardless). */}
            {onEditRx && item(() => onEditRx(c.id), <Pencil size={14} className="text-blue-600" />, "Edit Rx", "text-blue-700")}
            {item(() => onContactLab(c.id), <Phone size={14} />, `Contact ${lab?.name ?? "Lab"}`)}
            {item(() => onShareRx(c.id), <MessageCircle size={14} />, "Share Rx PDF")}
            {/* Cancellation: request before the lab completes the work; the
                lab must approve and may charge a fee for work already done. */}
            {onRequestCancel && c.cancelStatus === "none" && c.stageIndex < STAGE_INDEX.WORK_COMPLETE &&
              item(() => onRequestCancel(c.id), <Ban size={14} className="text-rose-500" />, "Request cancellation", "text-rose-600")}
            {onWithdrawCancel && c.cancelStatus === "requested" &&
              item(() => onWithdrawCancel(c.id), <Ban size={14} />, "Withdraw cancellation")}
          </div>,
          document.body
        )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Lab workspace RBAC (Phase 16) — dual-role users (lab_admin +       */
/*  lab_tech) switch between an Admin workspace and the tech queue.    */
/* ------------------------------------------------------------------ */

// Segmented workspace control, shown only to dual-role lab users.
function WorkspaceSwitcher({ workspace, onChange, hasAdminRole, hasTechRole, hasAccountantRole }) {
  const seg = (id, Icon, label) => (
    <button
      key={id}
      onClick={() => onChange(id)}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
        workspace === id ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
      }`}
      title={`Switch workspace: ${label}`}
    >
      <Icon size={14} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
      {hasAdminRole && seg("admin", Shield, "Lab Admin")}
      {/* Admins can preview the accountant workspace; real accountants land
          here as their own back-office view. */}
      {(hasAdminRole || hasAccountantRole) && seg("accountant", Wallet, "Accountant")}
      {(hasTechRole || hasAdminRole) && seg("tech", Wrench, "Technician")}
    </div>
  );
}

const ADMIN_TABS = [
  { id: "queue", label: "Case Queue", icon: ClipboardCheck },
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "technicians", label: "Technicians", icon: Users },
  { id: "billing", label: "Billing", icon: FileText },
  { id: "expenses", label: "Expenses", icon: Wallet },
  { id: "prices", label: "Price Lists", icon: Tags },
  { id: "staff", label: "Staff", icon: UserPlus },
];

const ACCOUNTANT_TAB_IDS = ["queue", "billing", "expenses", "prices"];

function LabAdminWorkspace({ queue, lab, clinicsById, cases, meId, financeOnly = false, isAdminPreview = false }) {
  const [tab, setTab] = useState("queue");
  const tabs = financeOnly ? ADMIN_TABS.filter((t) => ACCOUNTANT_TAB_IDS.includes(t.id)) : ADMIN_TABS;
  return (
    <div>
      {isAdminPreview && (
        <p className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-medium text-emerald-800">
          Viewing as Accountant — these are the tabs an accountant gets. Note: a real accountant also only
          sees the last 2 months of bills, payments and expenses (plus any statement a clinic still owes on);
          as an admin you're shown everything.
        </p>
      )}
      <nav className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
              tab === id ? "bg-blue-600 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            }`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </nav>
      {tab === "queue" ? (
        queue
      ) : tab === "overview" ? (
        <OverviewDashboard cases={cases} clinicsById={clinicsById} lab={lab} />
      ) : tab === "technicians" ? (
        <TechniciansPanel lab={lab} cases={cases} />
      ) : tab === "billing" ? (
        <BillingPanel lab={lab} clinicsById={clinicsById} cases={cases} />
      ) : tab === "expenses" ? (
        <ExpensesPanel lab={lab} />
      ) : tab === "prices" ? (
        <PriceListsManager lab={lab} clinicsById={clinicsById} cases={cases} />
      ) : (
        <StaffPanel lab={lab} meId={meId} />
      )}
    </div>
  );
}

function SuspendedScreen({ labName, message, onSignOut }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-rose-200 bg-rose-50 px-6 py-20 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-100 text-rose-600">
        <AlertTriangle size={22} />
      </div>
      <div>
        <h3 className="text-sm font-bold text-rose-700">Account suspended</h3>
        <p className="mt-1 max-w-sm text-sm text-rose-600">
          {message || `Your access to ${labName || "this lab"} has been suspended. Contact your lab administrator.`}
        </p>
      </div>
      <button
        onClick={onSignOut}
        className="flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
      >
        <LogOut size={15} /> Sign out
      </button>
    </div>
  );
}

/* Phase 30 — new clinics and labs start 'pending' and see this screen
   until the Dr-Crown super admin activates them. RLS keeps a pending org
   fully dark server-side; this is just the honest face on top of it. */
function PendingApprovalScreen({ orgType, orgName, onRefresh, onSignOut }) {
  const [checking, setChecking] = useState(false);
  const check = async () => {
    setChecking(true);
    try {
      await onRefresh?.();
    } finally {
      setChecking(false);
    }
  };
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-amber-200 bg-amber-50 px-6 py-20 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
        <Clock size={22} />
      </div>
      <div>
        <h3 className="text-sm font-bold text-amber-800">Awaiting activation</h3>
        <p className="mt-1 max-w-sm text-sm text-amber-700">
          {orgName ? `"${orgName}"` : `Your ${orgType}`} has been registered and is waiting for the
          Dr-Crown team to review and activate it. You'll get full access as soon as it's approved.
        </p>
      </div>
      <div className="flex flex-col items-center gap-2 sm:flex-row">
        <button
          onClick={check}
          disabled={checking}
          className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
        >
          <RefreshCcw size={15} className={checking ? "animate-spin" : ""} /> Check again
        </button>
        <button
          onClick={onSignOut}
          className="flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <LogOut size={15} /> Sign out
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component — data now lives in Supabase, scoped per account    */
/*  by RLS (a clinic sees only its cases, a lab sees only its own).    */
/* ------------------------------------------------------------------ */

export default function DentalLabTracker({ auth }) {
  const { profile, clinic, lab, labMemberships, signOut, refreshProfile } = auth;
  const isDentist = profile.role === "dentist";

  // ---- Lab staff RBAC (Phase 16) ----
  // No membership rows = legacy owner account; RLS grants those full
  // access, so the client mirrors that as dual-role.
  const memberships = labMemberships ?? [];
  const isLegacyLabOwner = !isDentist && memberships.length === 0;
  const activeRoles = memberships
    .filter((m) => m.status === "active" || m.status === "read_only")
    .map((m) => m.role);
  const hasAdminRole = !isDentist && (isLegacyLabOwner || activeRoles.includes("lab_admin"));
  const hasTechRole = !isDentist && (isLegacyLabOwner || activeRoles.includes("lab_tech"));
  // Phase 37: accountants run billing/expenses/price lists + the case
  // queue, but none of the admin-only panels (Overview/Technicians/Staff).
  const hasAccountantRole = !isDentist && activeRoles.includes("accountant");
  const hasBackOffice = hasAdminRole || hasAccountantRole;
  const isDualLab = hasBackOffice && hasTechRole;
  // Mirrors RLS: my_lab_id() nulls out when ANY membership row is suspended.
  const isSuspended = !isDentist && memberships.some((m) => m.status === "suspended");
  // Phase 30 signup-approval gate: the whole org (clinic or lab) is pending
  // admin activation, or was suspended platform-wide by the admin. RLS-side
  // my_clinic_id()/my_lab_id() already return null for these, so the data
  // is dark regardless — these flags just pick the right screen.
  const orgStatus = (isDentist ? clinic?.status : lab?.status) ?? "active";
  const isPendingApproval = orgStatus === "pending";
  const isOrgSuspended = orgStatus === "suspended";
  const orgBlocked = isPendingApproval || isOrgSuspended;

  const [workspacePref, setWorkspacePref] = useState(() => {
    try {
      return localStorage.getItem("drcrown.workspace") || "tech";
    } catch {
      return "tech";
    }
  });
  const switchWorkspace = (w) => {
    setWorkspacePref(w);
    try {
      localStorage.setItem("drcrown.workspace", w);
    } catch {
      /* private mode — non-persistent preference is fine */
    }
  };
  // Single-role members are pinned to their one workspace regardless of
  // any stale stored preference.
  // Workspaces this user may open: admins get all three (Accountant is a
  // preview of that role's workspace); accountants get theirs + tech.
  const allowedWorkspaces = hasAdminRole
    ? ["admin", "accountant", "tech"]
    : hasAccountantRole
      ? [...(hasTechRole ? ["tech"] : []), "accountant"]
      : ["tech"];
  const activeWorkspace = allowedWorkspaces.includes(workspacePref)
    ? workspacePref
    : hasAdminRole
      ? "admin"
      : hasAccountantRole
        ? "accountant"
        : "tech";

  const [labs, setLabs] = useState([]);
  const [cases, setCases] = useState([]);
  const [clinicsById, setClinicsById] = useState({});
  const [myClinics, setMyClinics] = useState([]); // multi-clinic: every clinic this dentist owns
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
    // Including clinicsById is safe, not a loop: once a fetch lands, the
    // re-run finds `missing` empty and bails at the guard above.
  }, [cases, clinicsById]);

  // Multi-clinic: load every clinic this dentist owns (Settings "My Clinics"
  // + the Rx form's "Sending Clinic" selector). clinics_select already
  // matches owner_id=auth.uid(), so no new policy is needed for this read.
  useEffect(() => {
    if (!isDentist || !profile.id) return;
    let cancelled = false;
    fetchClinicsByOwner(profile.id)
      .then((rows) => !cancelled && setMyClinics(rows))
      .catch((err) => console.error("Failed to load owned clinics", err));
    return () => {
      cancelled = true;
    };
  }, [isDentist, profile.id]);

  // Modals
  const [clinicModal, setClinicModal] = useState(null); // { editing: clinicObj | null } | null
  const [showCaseModal, setShowCaseModal] = useState(false);
  // Case being edited in the Rx form (30-minute window), null = new case.
  const [editingCase, setEditingCase] = useState(null);
  // Green confirmation after submitting/editing an Rx — the modal just
  // closes otherwise, with nothing telling the dentist it actually saved.
  const [rxToast, setRxToast] = useState(null);
  useEffect(() => {
    if (!rxToast) return;
    const t = setTimeout(() => setRxToast(null), 4500);
    return () => clearTimeout(t);
  }, [rxToast]);
  // Admin actions (lab directory, SLA analytics) live off the main dashboard.
  const [showSettings, setShowSettings] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  // Self-service profile (photo/name/phone) — available to both roles.
  const [showProfileSettings, setShowProfileSettings] = useState(false);

  // Filters (dentist view)
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");

  // labById intentionally indexes ALL labs, including unclaimed placeholder
  // rows: existing cases may still point at one, and their name must keep
  // resolving on the dashboard even though it's no longer selectable.
  const labById = useMemo(() => Object.fromEntries(labs.map((l) => [l.id, l])), [labs]);

  // Only labs that actually registered on the platform (a real lab account
  // owns the row) can be picked for new work or listed as partners —
  // dentists can no longer create placeholder lab rows themselves.
  // Suspended labs (deactivated tenants) drop out of dentist-facing pickers;
  // labById still resolves their names on old cases.
  // Dentists only ever see fully activated labs — 'pending' (awaiting admin
  // approval, Phase 30) and 'suspended' labs are both hidden.
  const registeredLabs = useMemo(() => labs.filter((l) => l.ownerId && l.status === "active"), [labs]);

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
  // Phase 32: the lab's manual final price. Overridden prices are sticky —
  // the DB pricing trigger skips them until reset, which re-sends the
  // unchanged prescription purely to re-fire automatic pricing.
  const setCasePrice = (caseId, totalPrice) => persist(caseId, { totalPrice, priceOverridden: true });
  const setLabShade = (caseId, labShade) => persist(caseId, { labShade });
  const resetCasePrice = (c) => persist(c.id, { priceOverridden: false, prescription: c.prescription });

  /* ---------------- Cancellation workflow (Phase 27) ----------------
     Dentist requests / withdraws; lab approves with a fee (work already
     done, capped at the case price by the DB guard) or declines. */
  const cancelEntry = (c, label) => [...(c.history ?? []), logEntry("cancellation", c.stageIndex, currentUser, currentRole, label)];
  const requestCancellation = (caseId) => {
    const c = cases.find((x) => x.id === caseId);
    if (!c) return;
    persist(caseId, { cancelStatus: "requested", history: cancelEntry(c, "Cancellation requested") });
  };
  const withdrawCancellation = (caseId) => {
    const c = cases.find((x) => x.id === caseId);
    if (!c) return;
    persist(caseId, { cancelStatus: "none", history: cancelEntry(c, "Cancellation request withdrawn") });
  };
  const resolveCancellation = (caseId, approved, fee) => {
    const c = cases.find((x) => x.id === caseId);
    if (!c) return;
    persist(caseId, {
      cancelStatus: approved ? "cancelled" : "declined",
      ...(approved ? { cancellationFee: Number(fee) || 0 } : {}),
      history: cancelEntry(c, approved ? `Cancellation approved — fee ${Number(fee) || 0} OMR` : "Cancellation declined"),
    });
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

  /* ---------------- Add clinic / add case ---------------- */

  // Multi-clinic: same form (AddClinicModal) handles both create and edit —
  // editingId present means update in place, absent means insert + append.
  const saveClinic = async (data, editingId) => {
    try {
      if (editingId) {
        const saved = await updateClinic(editingId, data);
        setMyClinics((p) => p.map((c) => (c.id === editingId ? saved : c)));
      } else {
        const saved = await insertClinic(auth.session.user.id, data);
        setMyClinics((p) => [...p, saved]);
      }
    } catch (err) {
      console.error(err);
      alert("Couldn't save the clinic — " + err.message);
    }
  };

  const addCase = async (data, opts = {}) => {
    // Multi-clinic: the Rx form's "Sending Clinic" selector (only shown when
    // the dentist owns more than one) passes clinicId explicitly; falls
    // back to the profile's default clinic for everyone else.
    const { clinicId, ...caseFields } = data;
    const newCaseData = {
      ...caseFields,
      createdDate: new Date().toISOString().slice(0, 10),
      stageIndex: STAGE_INDEX.STILL_AT_CLINIC, // Rx submitted, work still at clinic (20%)
      handover: null,
      remake: null,
      history: [logEntry("created", STAGE_INDEX.STILL_AT_CLINIC, currentUser, "dentist")],
    };
    try {
      const saved = await insertCase(clinicId || clinic.id, newCaseData);
      setCases((p) => [saved, ...p]);
      setRxToast("Prescription submitted — you can edit it for the next 30 minutes.");
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

  // 30-minute Rx edit window (mirrors the cases_guard_prescription trigger,
  // which is the real enforcement — this just decides whether to show the
  // menu item). Legacy rows without created_at simply aren't editable.
  const RX_EDIT_WINDOW_MS = 30 * 60 * 1000;
  const canEditRx = (c) => !!c.createdAt && Date.now() - new Date(c.createdAt).getTime() < RX_EDIT_WINDOW_MS;

  const editCase = async (caseId, data) => {
    const c = cases.find((x) => x.id === caseId);
    if (!c) return;
    // labId/clinicId deliberately omitted: the case stays with its lab.
    const { labId: _lab, clinicId: _clinic, ...rxFields } = data;
    const patch = {
      ...rxFields,
      history: [...(c.history ?? []), logEntry("rx-edited", c.stageIndex, currentUser, "dentist", "Prescription edited")],
    };
    // No optimistic write (unlike persist): the DB trigger rejects edits
    // past the window, and showing changes that didn't save would be worse
    // than a beat of latency.
    try {
      const saved = await updateCase(caseId, patch);
      setCases((prev) => prev.map((x) => (x.id === caseId ? saved : x)));
      setRxToast("Prescription updated — the lab sees the new version.");
    } catch (err) {
      console.error(err);
      alert("Couldn't update the prescription — " + err.message);
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
            {allowedWorkspaces.length > 1 && !isDentist && !isSuspended && !orgBlocked && (
              <WorkspaceSwitcher
                workspace={activeWorkspace}
                onChange={switchWorkspace}
                hasAdminRole={hasAdminRole}
                hasTechRole={hasTechRole}
                hasAccountantRole={hasAccountantRole}
              />
            )}
            {(isDentist || hasAdminRole) && !orgBlocked && (
              <button
                onClick={() => setShowSettings(true)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                title="Settings"
              >
                <Settings size={18} />
              </button>
            )}
            <ProfileMenu
              isDentist={isDentist}
              clinic={clinic}
              lab={lab}
              currentUser={currentUser}
              avatarUrl={profile.avatar_url}
              onSignOut={signOut}
              onOpenProfile={() => setShowProfileSettings(true)}
            />
            {isDentist && !orgBlocked && (
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
        {/* Location nudge: orgs registered before onboarding asked for a
            governorate can't join the Rx form's "Near you" lab grouping.
            One button opens the right editor directly. Lab side gates on
            hasAdminRole (techs can't open Lab Settings to fix it). */}
        {!loadingData && !orgBlocked && isDentist && myClinics.some((c) => !c.governorate) && (
          <div className="mb-4 flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-2 text-sm font-medium text-amber-800">
              <MapPin size={16} className="mt-0.5 shrink-0" />
              <span>
                {myClinics.length > 1 ? "A clinic of yours has" : "Your clinic has"} no location set —
                add your governorate so nearby labs are grouped for you when sending a case.
              </span>
            </p>
            <button
              onClick={() => setClinicModal({ editing: myClinics.find((c) => !c.governorate) })}
              className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700"
            >
              Set location
            </button>
          </div>
        )}
        {!loadingData && !orgBlocked && !isDentist && lab && hasAdminRole && !isSuspended && !lab.governorate && (
          <div className="mb-4 flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-2 text-sm font-medium text-amber-800">
              <MapPin size={16} className="mt-0.5 shrink-0" />
              <span>
                Your lab has no location set — clinics browsing for a lab see "Location not set"
                on your card. Add your governorate in Lab Settings.
              </span>
            </p>
            <button
              onClick={() => setShowSettings(true)}
              className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700"
            >
              Set location
            </button>
          </div>
        )}
        {loadingData ? (
          <div className="flex items-center justify-center py-24 text-sm text-slate-400">Loading…</div>
        ) : isPendingApproval ? (
          <PendingApprovalScreen
            orgType={isDentist ? "clinic" : "lab"}
            orgName={isDentist ? clinic?.name : lab?.name}
            onRefresh={refreshProfile}
            onSignOut={signOut}
          />
        ) : isOrgSuspended ? (
          <SuspendedScreen
            message={`${(isDentist ? clinic?.name : lab?.name) || (isDentist ? "Your clinic" : "Your lab")} has been suspended by Dr-Crown. Contact support to restore access.`}
            onSignOut={signOut}
          />
        ) : isDentist ? (
          <DentistDashboard
            labById={labById}
            clinicsById={clinicsById}
            cases={filteredDentistCases}
            allCases={cases}
            countBase={searchedDentistCases}
            totalCases={cases.length}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            query={query}
            setQuery={setQuery}
            onAdvance={(id) => advanceStage(id, currentUser, "dentist")}
            onOpenCase={setDrawerCaseId}
            canEditRx={canEditRx}
            onRequestCancel={requestCancellation}
            onWithdrawCancel={withdrawCancellation}
            onEditRx={(id) => {
              const c = cases.find((x) => x.id === id);
              if (!c) return;
              setEditingCase(c);
              setShowCaseModal(true);
            }}
            onShareRx={(id) => { setAutoShare(true); setPrintCaseId(id); }}
            onContactLab={setContactCaseId}
            onExportCsv={() => exportCasesCSV(filteredDentistCases, labs, clinic?.dentist, "dentatrack-clinic-cases.csv")}
          />
        ) : isSuspended ? (
          <SuspendedScreen labName={lab?.name} onSignOut={signOut} />
        ) : (() => {
          const labDashboard = (
            <LabDashboard
              lab={lab}
              queue={labQueue}
              clinicsById={clinicsById}
              onAdvance={(id) => advanceStage(id, `${lab.name} — ${currentUser}`, "lab")}
              onRevert={(id) => revertStage(id, `${lab.name} — ${currentUser}`, "lab")}
              onOpenCase={setDrawerCaseId}
              onLogRemake={hasTechRole || hasAdminRole ? setRemakeCaseId : undefined}
              onSetInvoiceNumber={setInvoiceNumber}
              onSetCasePrice={setCasePrice}
              onResetCasePrice={resetCasePrice}
              onSetLabShade={setLabShade}
              onResolveCancellation={resolveCancellation}
              onExportCsv={() => exportCasesCSV(labQueue, labs, (c) => clinicsById[c.clinicId]?.dentist ?? "—", `dentatrack-${lab.id}-cases.csv`)}
            />
          );
          return activeWorkspace === "admin" || activeWorkspace === "accountant" ? (
            <LabAdminWorkspace
              queue={labDashboard}
              lab={lab}
              clinicsById={clinicsById}
              cases={labQueue}
              meId={profile.id}
              financeOnly={activeWorkspace === "accountant" || !hasAdminRole}
              isAdminPreview={activeWorkspace === "accountant" && hasAdminRole}
            />
          ) : (
            labDashboard
          );
        })()}
      </main>

      {/* ------------------------- Modals ------------------------- */}
      <ProfileSettingsModal open={showProfileSettings} onClose={() => setShowProfileSettings(false)} auth={auth} />
      {/* Green confirmation after an Rx submit/edit — z-above the modals so
          it's visible the instant the form closes. */}
      {rxToast && (
        <div className="fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4">
          <div className="flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg">
            <CheckCircle2 size={16} /> {rxToast}
          </div>
        </div>
      )}
      {isDentist && (
        <AddClinicModal
          open={!!clinicModal}
          editing={clinicModal?.editing ?? null}
          onClose={() => setClinicModal(null)}
          onSave={saveClinic}
        />
      )}
      {isDentist && (
        <PrescriptionForm
          open={showCaseModal}
          onClose={() => { setShowCaseModal(false); setEditingCase(null); }}
          onResume={() => setShowCaseModal(true)}
          onSave={addCase}
          onSaveEdit={editCase}
          editing={editingCase}
          labs={registeredLabs}
          userId={auth.session?.user?.id}
          clinics={myClinics.filter((c) => c.status === "active")}
          defaultClinicId={clinic?.id}
        />
      )}

      {/* ------------------- Settings (admin actions live here, off the main dashboard) ------------------- */}
      {isDentist && (
        <SlideOver open={showSettings} onClose={() => setShowSettings(false)} title="Settings" icon={Settings}>
          <div className="space-y-6">
            <div>
              <div className="mb-2.5 flex items-center justify-between">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <Stethoscope size={13} /> My Clinics ({myClinics.length})
                </h4>
                <button
                  onClick={() => { setClinicModal({ editing: null }); setShowSettings(false); }}
                  className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
                >
                  <Plus size={13} /> Add Clinic
                </button>
              </div>
              <div className="space-y-2">
                {myClinics.length === 0 && <p className="text-sm text-slate-400">Loading…</p>}
                {myClinics.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { setClinicModal({ editing: c }); setShowSettings(false); }}
                    className="block w-full rounded-lg border border-slate-200 p-3 text-left hover:border-blue-300 hover:bg-blue-50/40"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-800">{c.name}</p>
                      <span className="flex shrink-0 items-center gap-1">
                        {c.status === "pending" && (
                          <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                            Awaiting approval
                          </span>
                        )}
                        {c.status === "suspended" && (
                          <span className="inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 ring-1 ring-inset ring-rose-200">
                            Suspended
                          </span>
                        )}
                        {c.id === clinic?.id && (
                          <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 ring-1 ring-inset ring-blue-200">
                            Default
                          </span>
                        )}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {[c.wilayat, c.governorate].filter(Boolean).join(", ") || "No location set"}
                    </p>
                  </button>
                ))}
              </div>
            </div>
            <div className="border-t border-slate-100 pt-4">
              <div className="mb-2.5">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <Building2 size={13} /> Registered Labs ({registeredLabs.length})
                </h4>
                <p className="mt-1 text-[11px] text-slate-400">
                  Read-only directory of labs registered on Dr-Crown. Pick which one receives a case in the prescription form.
                </p>
              </div>
              <div className="space-y-2">
                {registeredLabs.length === 0 && <p className="text-sm text-slate-400">No registered labs on the platform yet.</p>}
                {registeredLabs.map((l) => (
                  <div key={l.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800">{l.name}</p>
                        {orgLocation(l) && <p className="mt-0.5 text-[11px] text-slate-400">{orgLocation(l)}</p>}
                      </div>
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
      {!isDentist && lab && hasAdminRole && (
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
        onLogRemake={hasTechRole || hasAdminRole || isDentist ? () => drawerCase && setRemakeCaseId(drawerCase.id) : undefined}
        onPrint={() => drawerCase && setPrintCaseId(drawerCase.id)}
        onSetCasePrice={!isDentist ? setCasePrice : undefined}
        onResetCasePrice={!isDentist ? resetCasePrice : undefined}
        onSetLabShade={!isDentist ? setLabShade : undefined}
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

// Clinics and labs both carry governorate/wilayat now; `address` predates
// those and is still empty for every org created through the app, so fall
// back to it only if it was somehow filled in.
const orgLocation = (org) =>
  [org?.wilayat, org?.governorate].filter(Boolean).join(", ") || org?.address || "";

function DentistDashboard({
  labById,
  clinicsById,
  cases,
  allCases,
  countBase,
  totalCases,
  statusFilter,
  setStatusFilter,
  query,
  setQuery,
  onAdvance,
  onOpenCase,
  canEditRx,
  onEditRx,
  onShareRx,
  onContactLab,
  onExportCsv,
  onRequestCancel,
  onWithdrawCancel,
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
        <div className="flex flex-wrap items-center gap-2">
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
                <th className="px-4 py-3 font-semibold">Sent to Lab</th>
                <th className="px-4 py-3 font-semibold">Patient Name</th>
                <th className="px-4 py-3 font-semibold">Clinic → Lab</th>
                <th className="px-4 py-3 font-semibold">Appt Date</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Price</th>
                <th className="px-4 py-3 font-semibold text-right">Cancellation fee</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cases.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">
                    No cases match the current filters.
                  </td>
                </tr>
              )}
              {cases.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50/60">
                  {/* Case id lives in the details drawer only — the full id is
                      still on this cell's tooltip for quick cross-reference. */}
                  <td className="whitespace-nowrap px-4 py-3.5 align-top text-slate-600" title={`Case ${c.id}`}>
                    {fmtLogDate(c.createdAt ?? c.history?.[0]?.at ?? c.createdDate)}
                  </td>
                  <td className="px-4 py-3.5 align-top">
                    <div className="flex flex-wrap items-baseline gap-x-1.5">
                      <span className="font-semibold text-slate-800">{c.patientName}</span>
                      {c.remake && (
                        <span className="inline-flex items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                          <RefreshCcw size={9} /> Remake
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
                  {/* One column, not two: the green arrow makes the direction
                      of the work explicit and removes the wide dead gap the
                      separate Clinic / Lab columns used to leave. */}
                  <td className="px-4 py-3.5 align-top">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0">
                        <div className="text-slate-700">{clinicsById?.[c.clinicId]?.name ?? "—"}</div>
                        {orgLocation(clinicsById?.[c.clinicId]) && (
                          <div className="mt-0.5 text-[11px] text-slate-400">{orgLocation(clinicsById[c.clinicId])}</div>
                        )}
                      </div>
                      <ArrowRight size={15} className="shrink-0 text-emerald-500" />
                      <div className="min-w-0">
                        <div className="text-slate-700">{labById[c.labId]?.name ?? "—"}</div>
                        {orgLocation(labById[c.labId]) && (
                          <div className="mt-0.5 text-[11px] text-slate-400">{orgLocation(labById[c.labId])}</div>
                        )}
                      </div>
                    </div>
                  </td>
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
                    {c.cancelStatus === "requested" && (
                      <div className="mt-1">
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                          <Ban size={11} /> Cancellation requested
                        </span>
                      </div>
                    )}
                    {c.cancelStatus === "declined" && (
                      <div className="mt-1">
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-inset ring-slate-200">
                          <Ban size={11} /> Cancellation declined
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
                  <td className="px-4 py-3.5 align-top text-right whitespace-nowrap">
                    {/* Cancelled cases bill only their cancellation fee (next
                        column) — showing the dead work price just confuses. */}
                    {c.cancelStatus !== "cancelled" && c.totalPrice != null ? (
                      <span
                        className="font-semibold text-slate-700"
                        title={c.priceOverridden ? "Final price set by the lab" : "Estimated from the lab's price list — the lab may adjust it"}
                      >
                        {Number(c.totalPrice).toLocaleString(undefined, { maximumFractionDigits: 3 })} OMR
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 align-top text-right whitespace-nowrap">
                    {c.cancelStatus === "cancelled" && c.cancellationFee != null ? (
                      <span className="font-semibold text-rose-700">
                        {Number(c.cancellationFee).toLocaleString(undefined, { maximumFractionDigits: 3 })} OMR
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
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
                      onEditRx={canEditRx(c) ? onEditRx : null}
                      onRequestCancel={onRequestCancel}
                      onWithdrawCancel={onWithdrawCancel}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Every case this clinic has ever sent, unfiltered by the pill/search
          above — compact, log-style, click a row for the full case drawer. */}
      <CaseLogTable
        cases={allCases}
        otherPartyLabel="Lab"
        otherPartyName={(c) => labById[c.labId]?.name}
        onOpenCase={onOpenCase}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Case log — a dense, scrollable, click-for-details table of EVERY case  */
/*  (unfiltered by whatever tab/pill/search state the dashboard above it   */
/*  is in), shared by both the lab and dentist dashboards. Each row opens  */
/*  the same CaseDrawer the rest of the app uses.                          */
/* ------------------------------------------------------------------ */

const fmtLogDate = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
};

// Most recent thing that happened on a case — falls back to created date for
// a case with no history entries yet (shouldn't normally happen, but cheap
// to guard).
const lastActivityAt = (c) => (c.history?.length ? c.history[c.history.length - 1].at : c.createdDate);

function CaseLogTable({ cases, otherPartyLabel, otherPartyName, onOpenCase }) {
  const sorted = [...cases].sort((a, b) => new Date(lastActivityAt(b)) - new Date(lastActivityAt(a)));
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <HistoryIcon size={13} className="text-slate-400" />
        <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">All Cases ({cases.length})</h4>
      </div>
      {cases.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-slate-400">No cases yet.</p>
      ) : (
        <div className="max-h-[420px] overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-1.5">Case</th>
                <th className="px-4 py-1.5">Patient</th>
                <th className="px-4 py-1.5">{otherPartyLabel}</th>
                <th className="px-4 py-1.5">Stage</th>
                <th className="px-4 py-1.5">Last activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => onOpenCase(c.id)}
                  className="cursor-pointer transition hover:bg-slate-50"
                  title="Open case details"
                >
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-[11px] text-slate-500">{c.id}</td>
                  <td className="px-4 py-2 font-semibold text-slate-800">{c.patientName}</td>
                  <td className="px-4 py-2 text-slate-600">{otherPartyName(c) ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2"><StatusPill caseObj={c} /></td>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-400">{fmtLogDate(lastActivityAt(c))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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

function LabDashboard({ lab, queue, clinicsById, onAdvance, onRevert, onOpenCase, onLogRemake, onSetInvoiceNumber, onSetCasePrice, onResetCasePrice, onSetLabShade, onResolveCancellation, onExportCsv }) {
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

  // Approved cancellations drop out of the working queue — the work has
  // stopped; billing still sees them via the admin tabs.
  const live = (c) => c.cancelStatus !== "cancelled";
  const inIncoming = (c) => live(c) && c.stageIndex === STAGE_INDEX.STILL_AT_CLINIC;
  const inProduction = (c) => live(c) && c.stageIndex >= STAGE_INDEX.PICKED_UP_BY_LAB && c.stageIndex < STAGE_INDEX.WORK_COMPLETE;
  const inCompleted = (c) => live(c) && c.stageIndex >= STAGE_INDEX.WORK_COMPLETE;
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
              onResolveCancellation={onResolveCancellation}
              key={c.id}
              c={c}
              onAdvance={handleAdvance}
              onRevert={handleRevert}
              onOpenCase={onOpenCase}
              onLogRemake={onLogRemake}
              onSetInvoiceNumber={onSetInvoiceNumber}
              onSetCasePrice={onSetCasePrice}
              onResetCasePrice={onResetCasePrice}
              onSetLabShade={onSetLabShade}
            />
          ))}
        </div>
      )}

      {/* Every case this lab has ever had, unfiltered by the tab above —
          compact, log-style, click a row for the full case drawer. */}
      <CaseLogTable
        cases={queue}
        otherPartyLabel="Clinic"
        otherPartyName={(c) => clinicsById?.[c.clinicId]?.name}
        onOpenCase={onOpenCase}
      />

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

  // Always editable by the lab (Phase 29 dropped the once-set lock —
  // typos and renumbering are normal); dentists still can't write it.
  return value ? (
    <button
      onClick={() => { setDraft(value); setEditing(true); }}
      className="group flex items-center gap-1.5"
      title="Tap to edit the invoice number"
    >
      <Receipt size={15} className="shrink-0 text-slate-400" />
      <span className="font-mono text-lg font-black leading-tight tracking-wide text-slate-800">{value}</span>
      <Pencil size={12} className="text-slate-300 group-hover:text-blue-500" />
    </button>
  ) : (
    <button
      onClick={() => setEditing(true)}
      className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:underline"
    >
      <Receipt size={14} /> Add invoice #
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Cancellation request banner (lab card) — the dentist asked to       */
/*  cancel; the lab approves with a fee for work already done (the DB   */
/*  guard caps it at the case price) or declines and keeps working.     */
/* ------------------------------------------------------------------ */

function CancellationRequestBanner({ c, onResolve }) {
  const [fee, setFee] = useState("");
  const [confirming, setConfirming] = useState(false);
  const price = caseFee(c).total;

  return (
    <div className="mb-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5">
      <p className="flex items-center gap-1.5 text-xs font-bold text-amber-800">
        <Ban size={13} /> Dentist requested cancellation
      </p>
      <p className="mt-0.5 text-[11px] text-amber-700">
        Approve with a fee for the work already done (case price {price.toLocaleString(undefined, { maximumFractionDigits: 3 })} OMR), or decline to keep the case in production.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold text-amber-800">Fee</span>
          <input
            type="number"
            min="0"
            step="0.001"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            placeholder="0"
            className="w-24 rounded-lg border border-amber-200 bg-white px-2 py-1.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-amber-400"
          />
          <span className="text-[11px] text-amber-700">OMR</span>
        </label>
        {confirming ? (
          <>
            <button
              onClick={() => onResolve(c.id, true, fee)}
              className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700"
            >
              Confirm cancel{Number(fee) > 0 ? ` — ${Number(fee).toLocaleString(undefined, { maximumFractionDigits: 3 })} OMR` : " — no fee"}
            </button>
            <button onClick={() => setConfirming(false)} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:bg-white/60">
              Back
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setConfirming(true)}
              disabled={Number(fee) > price}
              className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-40"
            >
              Approve cancellation
            </button>
            <button
              onClick={() => onResolve(c.id, false)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Decline
            </button>
          </>
        )}
        {Number(fee) > price && (
          <p className="w-full text-[11px] font-semibold text-rose-600">Fee can't exceed the case price.</p>
        )}
      </div>
    </div>
  );
}

function LabCaseCard({ c, onAdvance, onRevert, onOpenCase, onLogRemake, onSetInvoiceNumber, onSetCasePrice, onResetCasePrice, onSetLabShade, onResolveCancellation }) {
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
          {c.cancelStatus === "cancelled" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-700">
              <Ban size={11} /> Cancelled
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

      {c.cancelStatus === "requested" && onResolveCancellation && (
        <CancellationRequestBanner c={c} onResolve={onResolveCancellation} />
      )}

      {/* Critical info — Material / Teeth / Shade in one subtly shaded row, not a wall of text */}
      {c.prescription && (
        <div className="mb-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg bg-slate-50 px-3.5 py-2.5 text-sm ring-1 ring-inset ring-slate-100">
          {c.prescription.restorations?.length ? (
            <span className="min-w-0">
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
          {c.prescription.pickupRequested && (
            <span className="ml-auto flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">
              <Truck size={11} /> Pick-up
            </span>
          )}
          {c.prescription.files?.some((f) => f.kind === "photo" && f.url) && (
            <span className={`flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-bold text-violet-700 ${c.prescription.pickupRequested ? "" : "ml-auto"}`}>
              <ImageIcon size={11} /> {c.prescription.files.filter((f) => f.kind === "photo" && f.url).length}
            </span>
          )}
        </div>
      )}

      {/* The lab's final price — hand-editable any time before invoicing */}
      {onSetCasePrice && (
        <CasePriceField c={c} onSave={(n) => onSetCasePrice(c.id, n)} onReset={() => onResetCasePrice(c)} />
      )}

      {/* "Shade by Lab" cases: the technician records the shade here */}
      {onSetLabShade && (needsLabShade(c) || c.labShade) && (
        <LabShadeField c={c} onSave={(v) => onSetLabShade(c.id, v)} />
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
/*  Add-Clinic modal                                                   */
/* ------------------------------------------------------------------ */

// Light, borderless input — sits on a soft gray fill until focused, when it
// lifts to white with a colored ring. Used by AddClinicModal,
// ProfileSettingsModal and LabSettingsDrawer. text-base (16px) below sm:
// avoids iOS Safari's force-zoom-on-focus for any input under 16px.
const lightInputCls =
  "w-full rounded-xl border border-transparent bg-gray-50 px-3.5 py-2.5 text-base sm:text-sm text-slate-800 outline-none transition focus:bg-white focus:ring-2 focus:ring-blue-500";

/**
 * Multi-clinic support: add a new clinic under the same dentist account, or
 * edit an existing one (name/contact/email/location). `editing` present ->
 * update in place; absent -> insert. Governorate/Wilayat use the same
 * OmanLocationFields as LabSettingsDrawer.
 */
function AddClinicModal({ open, onClose, editing, onSave }) {
  const [name, setName] = useState("");
  const [dentist, setDentist] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [location, setLocation] = useState({ governorate: "", wilayat: "" });

  // Init ONLY on open (not on `editing` directly) — same pattern as
  // LabSettingsDrawer/ProfileSettingsModal: `editing` gets a new identity on
  // every parent re-render, which would wipe unsaved edits mid-typing if it
  // were a dependency here.
  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setDentist(editing?.dentist ?? "");
    setContact(editing?.contact ?? "");
    setEmail(editing?.email ?? "");
    setLocation({ governorate: editing?.governorate ?? "", wilayat: editing?.wilayat ?? "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave(
      {
        name: name.trim(),
        dentist: dentist.trim(),
        contact: contact.trim(),
        email: email.trim(),
        governorate: location.governorate,
        wilayat: location.wilayat,
      },
      editing?.id ?? null
    );
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit Clinic" : "Add Clinic"}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Clinic Name</span>
          <input
            className={`${lightInputCls} py-3.5 text-base font-medium placeholder:font-normal`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Muscat Smile Dental Clinic"
            autoFocus
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Dentist Name</span>
          <input className={lightInputCls} value={dentist} onChange={(e) => setDentist(e.target.value)} placeholder="Dr. A. Chen, BDS" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-500">Phone</span>
          <input className={lightInputCls} value={contact} onChange={(e) => setContact(e.target.value)} placeholder="00968 9000 0000" inputMode="tel" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-500">Email</span>
          <input type="email" className={lightInputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="care@clinic.com" />
        </label>
        <OmanLocationFields value={location} onChange={(patch) => setLocation((l) => ({ ...l, ...patch }))} inputCls={lightInputCls} />

        <div className="flex items-center justify-between pt-2">
          <button type="button" onClick={onClose} className="text-sm font-semibold text-slate-500 hover:text-slate-700">
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/30 transition hover:bg-blue-700"
          >
            {editing ? "Save Changes" : "Add Clinic"}
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
  const [location, setLocation] = useState({ governorate: "", wilayat: "" });
  const [notifyEmail, setNotifyEmail] = useState("");
  const [payReminders, setPayReminders] = useState(true);
  const [roster, setRoster] = useState([]); // for the notification-recipient picker
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
    setLocation({ governorate: lab.governorate ?? "", wilayat: lab.wilayat ?? "" });
    setNotifyEmail(lab.notifyEmail ?? "");
    setPayReminders(lab.paymentRemindersEnabled ?? true);
    setError("");
    fetchLabRoster(lab.id)
      .then((r) => setRoster(r.filter((p) => p.userId && p.email && p.status !== "suspended")))
      .catch(() => setRoster([]));
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
        governorate: location.governorate,
        wilayat: location.wilayat,
        notifyEmail,
        // Only send when actually flipped, so saving other settings still
        // works if the Phase 25 column doesn't exist yet (deploy-order safety).
        ...(payReminders !== (lab.paymentRemindersEnabled ?? true) ? { paymentRemindersEnabled: payReminders } : {}),
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
            <OmanLocationFields value={location} onChange={(patch) => setLocation((l) => ({ ...l, ...patch }))} inputCls={lightInputCls} />
          </div>
        </div>

        <div className="border-t border-slate-100 pt-4">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Case notifications</h4>
          <p className="mb-2.5 text-[11px] text-slate-400">
            Who gets the email when a dentist sends a new case. One recipient — pick yourself or a technician.
          </p>
          <select value={notifyEmail} onChange={(e) => setNotifyEmail(e.target.value)} className={lightInputCls}>
            <option value="">Lab contact email{lab.email ? ` (${lab.email})` : ""}</option>
            {[...new Map(roster.map((p) => [p.email.toLowerCase(), p])).values()]
              .filter((p) => p.email.toLowerCase() !== (lab.email ?? "").toLowerCase())
              .map((p) => (
                <option key={p.email} value={p.email}>
                  {p.name} ({p.email})
                </option>
              ))}
            {notifyEmail && !roster.some((p) => p.email.toLowerCase() === notifyEmail.toLowerCase()) && (
              <option value={notifyEmail}>{notifyEmail} — no longer on the roster</option>
            )}
          </select>
        </div>

        <div className="border-t border-slate-100 pt-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payment reminders</h4>
              <p className="mt-1 text-[11px] text-slate-400">
                On the 25th of each month, clinics with issued unpaid invoices get an automatic email
                reminder from your lab. Turn off to stop these emails.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={payReminders}
              onClick={() => setPayReminders((v) => !v)}
              className={`relative h-6 w-11 shrink-0 rounded-full transition ${payReminders ? "bg-blue-600" : "bg-slate-200"}`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${payReminders ? "left-[22px]" : "left-0.5"}`}
              />
            </button>
          </div>
          <p className={`mt-1.5 text-[11px] font-semibold ${payReminders ? "text-emerald-600" : "text-amber-600"}`}>
            {payReminders ? "Active — monthly reminders are sent" : "Off — clinics will not be reminded"}
          </p>
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
