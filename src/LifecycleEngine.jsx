import React, { useEffect, useRef, useState } from "react";
import {
  Ban,
  ClipboardList,
  Truck,
  PackageCheck,
  Hammer,
  CheckCircle2,
  Home,
  ChevronRight,
  RotateCcw,
  AlertTriangle,
  X,
  History as HistoryIcon,
  FilePlus2,
  UserCheck,
  Undo2,
  Clock,
  Printer,
  RefreshCcw,
  Check,
  Wrench,
  Send,
  MessageSquare,
} from "lucide-react";
import { fetchCaseNotes, insertCaseNote, ROUND_KIND_LABELS } from "./lib/data.js";
import { SHADE_BY_LAB } from "./PrescriptionForm.jsx";
import { SignedImage } from "./lib/storageUrl.jsx";

/* ================================================================== */
/*  Follow-up rounds panel — shown in the case drawer to both parties.  */
/*  A round is a next stage, or a returned-work remake/adjustment/refit. */
/*  The lab-internal cost + fault live in the Remakes tab, never here.   */
/* ================================================================== */

const ROUND_KIND_STYLE = {
  stage: "bg-sky-100 text-sky-700",
  remake: "bg-rose-100 text-rose-700",
  adjustment: "bg-amber-100 text-amber-700",
  refit: "bg-violet-100 text-violet-700",
};

export function CaseRoundsPanel({ rounds = [], role, onResolve }) {
  if (!rounds.length) return null;
  const ordered = [...rounds].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return (
    <section>
      <h4 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
        <RotateCcw size={13} /> Follow-ups &amp; returns ({rounds.length})
      </h4>
      <div className="space-y-3">
        {ordered.map((r) => (
          <div key={r.id} className={`rounded-xl border p-3 ${r.status === "open" ? "border-amber-200 bg-amber-50/50" : "border-slate-200 bg-slate-50"}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${ROUND_KIND_STYLE[r.kind] ?? "bg-slate-100 text-slate-600"}`}>
                  {ROUND_KIND_LABELS[r.kind] ?? r.kind}
                </span>
                {r.status === "resolved" ? (
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600"><CheckCircle2 size={12} /> Resolved</span>
                ) : (
                  <span className="text-[11px] font-semibold text-amber-700">Open</span>
                )}
                {r.pickupRequested && (
                  <span className="flex items-center gap-1 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700"><Truck size={11} /> Pick-up</span>
                )}
              </div>
              <span className="text-[10px] text-slate-400">{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : ""}</span>
            </div>
            {r.instructions && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{r.instructions}</p>}
            {Array.isArray(r.attachments) && r.attachments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {r.attachments.map((a, i) =>
                  a.kind === "photo" && a.url ? (
                    <SignedImage key={i} url={a.url} alt={a.name || "photo"} className="h-16 w-16 rounded-lg border border-slate-200 object-cover" />
                  ) : (
                    <span key={i} className="flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">
                      <FilePlus2 size={12} /> {a.name || "file"}
                    </span>
                  )
                )}
              </div>
            )}
            <p className="mt-2 text-[10px] text-slate-400">
              By {r.createdByName || (r.createdByRole === "lab" ? "the lab" : "the clinic")}
            </p>
            {role === "lab" && r.status === "open" && onResolve && (
              <button
                type="button"
                onClick={() => onResolve(r.id)}
                className="mt-2 flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                <Check size={13} /> Mark resolved
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ================================================================== */
/*  Lifecycle model — THE single source of truth for case progress    */
/* ================================================================== */

// 6-stage pipeline, 16% → 100%. `actor` = the role that moves a case
// INTO this stage (and therefore the only role allowed to revert out of it).
export const STAGES = [
  { key: "STILL_AT_CLINIC", label: "Still at Clinic", pct: 20, actor: "dentist", icon: ClipboardList, color: "#38bdf8" },
  { key: "PICKED_UP_BY_LAB", label: "Picked Up by Lab", pct: 40, actor: "lab", icon: Truck, color: "#3b82f6" },
  { key: "WORK_IN_PROGRESS", label: "Work in Progress", pct: 60, actor: "lab", icon: Hammer, color: "#8b5cf6" },
  { key: "WORK_COMPLETE", label: "Work Complete", pct: 80, actor: "lab", icon: CheckCircle2, color: "#10b981" },
  { key: "CLINIC_RECEIVED", label: "Clinic Received", pct: 100, actor: "dentist", icon: Home, color: "#22c55e" },
];

export const STAGE_INDEX = STAGES.reduce((a, s, i) => ({ ...a, [s.key]: i }), {});
export const LAST_STAGE = STAGES.length - 1; // CLINIC_RECEIVED / 100%
export const stagePct = (idx) => STAGES[Math.max(0, Math.min(LAST_STAGE, idx))].pct;

export const HANDOVER_OPTIONS = [
  { key: "Delivered to Clinic", sub: "Chairside fitting by dentist", icon: Home },
  { key: "Patient Picked Up", sub: "Front desk reception collection", icon: UserCheck },
];

/* ---------------- appointment-warning logic ---------------- */

export function apptHoursAway(c) {
  if (!c?.appointmentDate || c.appointmentDate === "—") return null;
  const appt = new Date(c.appointmentDate + "T00:00:00");
  if (isNaN(appt.getTime())) return null;
  return (appt.getTime() - Date.now()) / 3_600_000;
}

// Red-alert when the appointment is ≤48h away (or past) and the case has
// NOT reached Clinic Received.
export function isUrgent(c) {
  if (c.stageIndex >= LAST_STAGE) return false;
  const h = apptHoursAway(c);
  return h !== null && h <= 48;
}

/* ---------------- history helpers ---------------- */

export function buildHistory(toIdx, labName, endTime = Date.now()) {
  const step = 9 * 3_600_000; // ~9h between logged steps
  const by = (actor) => (actor === "lab" ? `${labName} Tech` : "Dr. Chen (Clinic)");
  const entries = [];
  let t = endTime - (toIdx + 1) * step;
  entries.push({ at: new Date(t).toISOString(), action: "created", toStage: 0, label: STAGES[0].label, by: by("dentist"), role: "dentist" });
  for (let i = 1; i <= toIdx; i++) {
    t += step;
    entries.push({ at: new Date(t).toISOString(), action: "advance", toStage: i, label: STAGES[i].label, by: by(STAGES[i].actor), role: STAGES[i].actor });
  }
  return entries;
}

export const fmtDateTime = (iso) => {
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

const todayISO = () => new Date().toISOString().slice(0, 10);

/* ================================================================== */
/*  Status pill                                                        */
/* ================================================================== */

export function StatusPill({ caseObj }) {
  // Approved cancellations override the lifecycle stage everywhere the
  // pill appears — the case is terminal regardless of where it stopped.
  if (caseObj.cancelStatus === "cancelled") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-200">
        <Ban size={12} className="shrink-0" /> Cancelled
      </span>
    );
  }
  const idx = caseObj.stageIndex;
  const s = STAGES[idx];
  // Work Complete and Clinic Received both read as "done" milestones —
  // green, with a tick so completion is visible at a glance even where
  // colour alone wouldn't carry it.
  const done = idx >= STAGE_INDEX.WORK_COMPLETE;
  const palette = done
    ? "bg-emerald-100 text-emerald-700 ring-emerald-200"
    : idx === 0
    ? "bg-sky-100 text-sky-700 ring-sky-200"
    : "bg-blue-100 text-blue-700 ring-blue-200";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${palette}`}>
      {done && <CheckCircle2 size={12} className="shrink-0" />}
      {s.label}
    </span>
  );
}

/* ================================================================== */
/*  Compact progress bar (display-only, for dense table rows)          */
/* ================================================================== */

export function ProgressBar({ caseObj }) {
  const idx = caseObj.stageIndex;
  const pct = stagePct(idx);
  return (
    <div className="w-full min-w-[150px]">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-medium text-slate-500">{STAGES[idx].label}</span>
        <span className="text-[11px] font-semibold tabular-nums text-slate-700">{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${STAGES[0].color}, ${STAGES[idx].color})` }}
        />
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Appointment warning badge                                          */
/* ================================================================== */

export function AppointmentBadge({ caseObj, className = "" }) {
  if (caseObj.stageIndex >= LAST_STAGE) return null;
  const h = apptHoursAway(caseObj);
  if (h === null || h > 48) return null;
  const overdue = h < 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset ${
        overdue ? "bg-rose-600 text-white ring-rose-700" : "bg-rose-100 text-rose-700 ring-rose-300"
      } ${className}`}
      title={overdue ? "Appointment is in the past and case is not Clinic Received" : "Appointment within 48 hours"}
    >
      <AlertTriangle size={11} className={overdue ? "" : "animate-pulse"} />
      {overdue ? "Overdue" : `Appt in ${Math.max(0, Math.ceil(h))}h`}
    </span>
  );
}

/* ================================================================== */
/*  Interactive 6-stage progress tracker                               */
/* ================================================================== */

export function ProgressTracker({ caseObj, role, onAdvance, onRevert }) {
  const idx = caseObj.stageIndex;
  const cur = STAGES[idx];
  const next = STAGES[idx + 1];
  const canAdvance = !!next && role === next.actor;
  const canRevert = idx > 0 && role === cur.actor;
  const waitingOn = next && !canAdvance ? (next.actor === "lab" ? "Lab" : "Clinic") : null;

  return (
    <div>
      {/* percentage header */}
      <div className="mb-4 flex items-end justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Stage {idx + 1} of {STAGES.length}</p>
          <p className="text-sm font-bold text-slate-800">{cur.label}</p>
        </div>
        <div className="text-right leading-none">
          <span className="text-2xl font-black tabular-nums" style={{ color: cur.color }}>{cur.pct}%</span>
        </div>
      </div>

      {/* stepper */}
      <div className="flex">
        {STAGES.map((s, i) => {
          const done = i < idx;
          const current = i === idx;
          const Icon = s.icon;
          const leftFilled = i <= idx;
          const rightFilled = i < idx;
          return (
            <div key={s.key} className="relative flex flex-1 flex-col items-center">
              {i > 0 && (
                <div className="absolute left-0 right-1/2 top-4 h-0.5" style={{ background: leftFilled ? STAGES[i - 1].color : "#e2e8f0" }} />
              )}
              {i < STAGES.length - 1 && (
                <div className="absolute left-1/2 right-0 top-4 h-0.5" style={{ background: rightFilled ? s.color : "#e2e8f0" }} />
              )}
              <div
                className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full transition-all"
                style={
                  done || current
                    ? { background: s.color, color: "#fff", boxShadow: current ? `0 0 0 4px ${s.color}33` : "none" }
                    : { background: "#fff", color: "#94a3b8", border: "1px solid #cbd5e1" }
                }
                title={`${s.label} · ${s.pct}%`}
              >
                <Icon size={15} />
              </div>
              <span className={`mt-1.5 text-center text-[9px] leading-tight ${current ? "font-bold text-slate-800" : done ? "text-slate-600" : "text-slate-400"}`}>
                {s.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* action row */}
      <div className="mt-5 flex items-center gap-2">
        {canRevert && (
          <button
            onClick={onRevert}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            title={`Revert to ${STAGES[idx - 1].label}`}
          >
            <Undo2 size={15} /> Revert
          </button>
        )}
        {next ? (
          canAdvance ? (
            <button
              onClick={onAdvance}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white transition active:scale-[0.99]"
              style={{ background: next.color }}
            >
              {React.createElement(next.icon, { size: 15 })}
              Advance to {next.label}
              <ChevronRight size={15} />
            </button>
          ) : (
            <div className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-400">
              <Clock size={13} /> Waiting on {waitingOn}
            </div>
          )
        ) : (
          <div className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-600">
            <CheckCircle2 size={15} /> Clinic Received — 100%
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Post-intake handover terminal                                      */
/* ================================================================== */

export function HandoverTerminal({ caseObj, role, onSave }) {
  const existing = caseObj.handover || null;
  const readOnly = role !== "dentist";

  const [type, setType] = useState(existing?.type ?? null);
  const [pickupDate, setPickupDate] = useState(existing?.pickupDate ?? todayISO());
  const [staffNotes, setStaffNotes] = useState(existing?.staffNotes ?? "");

  // Re-sync when switching between cases.
  useEffect(() => {
    setType(existing?.type ?? null);
    setPickupDate(existing?.pickupDate ?? todayISO());
    setStaffNotes(existing?.staffNotes ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseObj.id]);

  const confirmed = existing?.confirmed;

  if (readOnly) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Handover</p>
        {existing?.confirmed ? (
          <p className="text-sm font-medium text-emerald-700">
            {existing.type} · {existing.pickupDate}
          </p>
        ) : (
          <p className="text-sm text-slate-500">Awaiting clinic handover.</p>
        )}
      </div>
    );
  }

  return (
    <div className={`rounded-xl border p-4 ${confirmed ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200 bg-white"}`}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-bold text-slate-800">Handover Terminal</p>
        {confirmed && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
            <CheckCircle2 size={11} /> Confirmed
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {HANDOVER_OPTIONS.map((opt) => {
          const active = type === opt.key;
          return (
            <button
              key={opt.key}
              onClick={() => setType(opt.key)}
              className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition ${
                active ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-100" : "border-slate-300 bg-white hover:bg-slate-50"
              }`}
            >
              <opt.icon size={16} className={active ? "text-emerald-600" : "text-slate-400"} />
              <span className="text-sm font-semibold text-slate-800">{opt.key}</span>
              <span className="text-[11px] text-slate-500">{opt.sub}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Pickup / Delivery Date</span>
          <input type="date" value={pickupDate} onChange={(e) => setPickupDate(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Staff Notes</span>
          <input value={staffNotes} onChange={(e) => setStaffNotes(e.target.value)} placeholder="Received by, condition…" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
        </label>
      </div>

      <button
        disabled={!type}
        onClick={() => onSave({ type, pickupDate, staffNotes, confirmed: true })}
        className={`mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white transition ${
          type ? "bg-emerald-600 hover:bg-emerald-700" : "cursor-not-allowed bg-slate-300"
        }`}
      >
        <CheckCircle2 size={15} /> {confirmed ? "Update Handover" : "Confirm Handover"}
      </button>
    </div>
  );
}

/* ================================================================== */
/*  Case notes — a small shared thread between the clinic and lab on   */
/*  this one case, separate from the lifecycle audit history below.    */
/* ================================================================== */

function CaseNotes({ caseId, role, authorName }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const otherSide = role === "dentist" ? "lab" : "clinic";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCaseNotes(caseId)
      .then((n) => !cancelled && setNotes(n))
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  const send = async () => {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError("");
    try {
      const note = await insertCaseNote(caseId, role, authorName, trimmed);
      setNotes((prev) => [...prev, note]);
      setBody("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="max-h-52 space-y-2 overflow-y-auto p-3">
        {loading && <p className="text-xs text-slate-400">Loading notes…</p>}
        {!loading && notes.length === 0 && (
          <p className="text-xs text-slate-400">No notes yet — leave one for the {otherSide} below.</p>
        )}
        {notes.map((n) => (
          <div key={n.id} className={`rounded-lg px-3 py-2 text-sm ${n.authorRole === role ? "ml-6 bg-blue-50" : "mr-6 bg-slate-50"}`}>
            <p className="text-slate-700">{n.body}</p>
            <p className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-400">
              <span className={`rounded px-1 font-medium ${n.authorRole === "lab" ? "bg-blue-100 text-blue-600" : "bg-violet-100 text-violet-600"}`}>
                {n.authorRole}
              </span>
              {n.authorName} · {fmtDateTime(n.createdAt)}
            </p>
          </div>
        ))}
      </div>
      {error && <p className="border-t border-rose-100 bg-rose-50 px-3 py-1.5 text-[11px] text-rose-600">{error}</p>}
      <div className="flex items-center gap-2 border-t border-slate-100 p-2.5">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={`Note for the ${otherSide}…`}
          className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm outline-none transition focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
        />
        <button
          onClick={send}
          disabled={sending || !body.trim()}
          className="flex shrink-0 items-center justify-center rounded-lg bg-blue-600 p-2 text-white transition hover:bg-blue-700 disabled:opacity-40"
          title="Send note"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}

/* Phase 32 — the lab's final case price, always hand-editable until the
   case lands on a statement (issued/paid cases are frozen server-side).
   A manual price shows a "manual" chip and survives repricing until the
   reset arrow puts the case back on automatic pricing. */
export function CasePriceField({ c, onSave, onReset }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const locked = c.invoiceStatus !== "draft" || !!c.statementId;
  const fmt = (n) => `${Number(n).toLocaleString(undefined, { maximumFractionDigits: 3 })} OMR`;

  const commit = () => {
    setEditing(false);
    const n = Number(draft);
    if (!Number.isFinite(n) || n < 0) return;
    if (n !== (c.totalPrice ?? null)) onSave(n);
  };

  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium text-slate-400">Price</span>
      {editing ? (
        <span className="flex items-center gap-1">
          <input
            ref={inputRef}
            type="number"
            min="0"
            step="0.001"
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
            className="w-24 rounded-lg border border-blue-300 px-2 py-1 text-sm font-bold text-slate-800 outline-none ring-2 ring-blue-100"
          />
          <span className="text-xs font-semibold text-slate-400">OMR</span>
          <button onMouseDown={(e) => e.preventDefault()} onClick={commit} className="rounded-lg p-1 text-emerald-600 hover:bg-emerald-50" title="Save price">
            <Check size={15} />
          </button>
        </span>
      ) : locked ? (
        <span className="font-bold text-slate-700" title="This case is already on a statement — its price is locked">
          {c.totalPrice != null ? fmt(c.totalPrice) : "—"} 🔒
        </span>
      ) : (
        <button
          onClick={() => {
            setDraft(c.totalPrice != null ? String(c.totalPrice) : "");
            setEditing(true);
          }}
          className="group flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 font-bold text-slate-800 hover:bg-blue-50"
          title="Tap to set the final price for this case"
        >
          {c.totalPrice != null ? fmt(c.totalPrice) : <span className="font-semibold text-blue-600">Set price</span>}
          <Wrench size={12} className="text-slate-300 group-hover:text-blue-500" />
        </button>
      )}
      {c.priceOverridden && !editing && (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
          manual
          {!locked && (
            <button
              onClick={onReset}
              className="rounded-full p-0.5 hover:bg-amber-200"
              title="Reset to automatic pricing from the price list"
            >
              <RefreshCcw size={10} />
            </button>
          )}
        </span>
      )}
    </div>
  );
}

/* Phase 36 — the lab-determined shade for "Shade by Lab" cases. The
   technician records the real shade before the work goes back; the
   clinic sees it read-only. Same click-to-edit pattern as the invoice
   number and price fields. */
export function needsLabShade(c) {
  const p = c?.prescription;
  if (!p) return false;
  const byLab = (r) => r?.shadeGuide === SHADE_BY_LAB || r?.vitaShade === SHADE_BY_LAB;
  return p.restorations?.length ? p.restorations.some(byLab) : byLab(p);
}

export function LabShadeField({ c, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const v = draft.trim();
    if (v !== (c.labShade || "")) onSave(v);
  };

  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium text-slate-400">Shade</span>
      {editing ? (
        <span className="flex items-center gap-1">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
            placeholder="e.g. A3, A2 incisal / A3 body"
            className="w-48 rounded-lg border border-blue-300 px-2 py-1 text-sm font-bold text-slate-800 outline-none ring-2 ring-blue-100"
          />
          <button onMouseDown={(e) => e.preventDefault()} onClick={commit} className="rounded-lg p-1 text-emerald-600 hover:bg-emerald-50" title="Save shade">
            <Check size={15} />
          </button>
        </span>
      ) : (
        <button
          onClick={() => {
            setDraft(c.labShade || "");
            setEditing(true);
          }}
          className="group flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 font-bold hover:bg-blue-50"
          title="The dentist chose 'Shade by Lab' — record the shade you determined"
        >
          {c.labShade ? (
            <span className="text-slate-800">{c.labShade}</span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
              Shade needed — tap to set
            </span>
          )}
          <Wrench size={12} className="text-slate-300 group-hover:text-blue-500" />
        </button>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Case lifecycle drawer (progress + handover + audit history)        */
/* ================================================================== */

const ACTION_META = {
  created: { icon: FilePlus2, tint: "text-sky-600 bg-sky-100" },
  advance: { icon: ChevronRight, tint: "text-blue-600 bg-blue-100" },
  revert: { icon: RotateCcw, tint: "text-amber-600 bg-amber-100" },
  handover: { icon: UserCheck, tint: "text-emerald-600 bg-emerald-100" },
  remake: { icon: RefreshCcw, tint: "text-rose-600 bg-rose-100" },
};

export function CaseDrawer({ open, caseObj, role, authorName, rxDetails, onClose, onAdvance, onRevert, onSaveHandover, onLogRemake, onPrint, onSetCasePrice, onResetCasePrice, onSetLabShade, rounds = [], onResolveRound }) {
  return (
    <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      <div className={`absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0"}`} onClick={onClose} />
      <div className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-white shadow-2xl transition-transform duration-300 ${open ? "translate-x-0" : "translate-x-full"}`}>
        {caseObj && (
          <>
            {/* header */}
            <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-slate-800">{caseObj.id}</span>
                  <StatusPill caseObj={caseObj} />
                  <AppointmentBadge caseObj={caseObj} />
                </div>
                <p className="mt-0.5 text-sm text-slate-600">
                  {caseObj.patientName} <span className="text-slate-400">· {caseObj.patientId}</span>
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-400">
                  <Clock size={11} /> Appointment: {caseObj.appointmentDate}
                </p>
              </div>
              <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            {/* body */}
            <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
              {/* the dentist's full work order — the lab's primary reference */}
              {rxDetails && (
                <section>
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Prescription</h4>
                  {rxDetails}
                </section>
              )}

              {/* follow-up rounds / returned-work remakes on this case */}
              <CaseRoundsPanel rounds={rounds} role={role} onResolve={onResolveRound} />

              {/* lab-determined shade for "Shade by Lab" prescriptions */}
              {(needsLabShade(caseObj) || caseObj.labShade) && (
                <section>
                  <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Shade — set by lab</h4>
                  {role === "lab" && onSetLabShade ? (
                    <LabShadeField c={caseObj} onSave={(v) => onSetLabShade(caseObj.id, v)} />
                  ) : (
                    <p className="text-sm font-bold text-slate-800">
                      {caseObj.labShade || <span className="font-medium text-slate-400">Not recorded yet</span>}
                    </p>
                  )}
                </section>
              )}

              {/* the lab's final price — editable by the lab until invoiced;
                  the clinic sees it read-only once it exists */}
              {((role === "lab" && onSetCasePrice) ||
                (role !== "lab" && caseObj.totalPrice != null && caseObj.cancelStatus !== "cancelled")) && (
                <section>
                  <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Price</h4>
                  {role === "lab" && onSetCasePrice ? (
                    <CasePriceField
                      c={caseObj}
                      onSave={(n) => onSetCasePrice(caseObj.id, n)}
                      onReset={() => onResetCasePrice(caseObj)}
                    />
                  ) : (
                    <p className="text-sm font-bold text-slate-800">
                      {Number(caseObj.totalPrice).toLocaleString(undefined, { maximumFractionDigits: 3 })} OMR
                      <span className="ml-2 text-xs font-medium text-slate-400">
                        {caseObj.priceOverridden ? "set by the lab" : "estimated from the lab's price list"}
                      </span>
                    </p>
                  )}
                </section>
              )}

              {/* progress */}
              <section>
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Lifecycle Progress</h4>
                <ProgressTracker caseObj={caseObj} role={role} onAdvance={onAdvance} onRevert={onRevert} />
              </section>

              {/* handover terminal — only once Clinic Received */}
              {caseObj.stageIndex === LAST_STAGE && (
                <section>
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Post-Intake Handover</h4>
                  <HandoverTerminal caseObj={caseObj} role={role} onSave={onSaveHandover} />
                </section>
              )}

              {/* shared notes between clinic and lab */}
              <section>
                <h4 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <MessageSquare size={13} /> Notes
                </h4>
                <CaseNotes caseId={caseObj.id} role={role} authorName={authorName} />
              </section>

              {/* audit history */}
              <section>
                <h4 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <HistoryIcon size={13} /> Timestamp History
                </h4>
                <ol className="relative space-y-3 border-l border-slate-200 pl-5">
                  {(caseObj.history ?? []).slice().reverse().map((e, i) => {
                    const meta = ACTION_META[e.action] ?? ACTION_META.advance;
                    const Icon = meta.icon;
                    return (
                      <li key={i} className="relative">
                        <span className={`absolute -left-[27px] flex h-5 w-5 items-center justify-center rounded-full ring-4 ring-white ${meta.tint}`}>
                          <Icon size={11} />
                        </span>
                        <div className="rounded-lg bg-slate-50 px-3 py-2">
                          <p className="text-sm font-medium text-slate-800">
                            {e.action === "created" && "Case created · "}
                            {e.action === "advance" && "Advanced → "}
                            {e.action === "revert" && "Reverted → "}
                            {e.action === "handover" && "Handover · "}
                            <span className="font-semibold">{e.label}</span>
                          </p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                            <span className="font-medium text-slate-600">{e.by}</span>
                            <span className={`rounded px-1 ${e.role === "lab" ? "bg-blue-100 text-blue-600" : "bg-violet-100 text-violet-600"}`}>{e.role}</span>
                            <span>·</span>
                            <span>{fmtDateTime(e.at)}</span>
                          </p>
                        </div>
                      </li>
                    );
                  })}
                  {(!caseObj.history || caseObj.history.length === 0) && (
                    <li className="text-sm text-slate-400">No history recorded.</li>
                  )}
                </ol>
              </section>
            </div>

            {/* footer: print + remake actions */}
            <div className="border-t border-slate-100 bg-slate-50 px-5 py-3">
              {caseObj.remake && (
                <div className="mb-2 flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-[11px] text-rose-700 ring-1 ring-inset ring-rose-200">
                  <RefreshCcw size={12} className="mt-0.5 shrink-0" />
                  <span>
                    <span className="font-semibold">Remake logged:</span>{" "}
                    {caseObj.remake.classification === "clinical" ? "Clinical" : "Laboratory"} · {caseObj.remake.reason}
                    {caseObj.remake.cost ? ` · $${caseObj.remake.cost}` : ""}
                  </span>
                </div>
              )}
              <div className="flex gap-2">
                {onPrint && (
                  <button onClick={onPrint} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">
                    <Printer size={15} /> Print Rx
                  </button>
                )}
                {onLogRemake && (
                  <button
                    onClick={onLogRemake}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold ${
                      caseObj.remake ? "bg-rose-100 text-rose-700 hover:bg-rose-200" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    <RefreshCcw size={15} /> {caseObj.remake ? "Update Remake" : "Log Remake"}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
