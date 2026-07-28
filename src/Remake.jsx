import React, { useEffect, useState } from "react";
import { X, RefreshCcw, Stethoscope, FlaskConical, AlertTriangle, PieChart } from "lucide-react";

/* ================================================================== */
/*  Remake root-cause taxonomy                                         */
/* ================================================================== */

export const REMAKE_REASONS = {
  clinical: {
    label: "Clinical Error",
    icon: Stethoscope,
    color: "#f97316", // orange
    reasons: [
      "Margin distortion / Unclear prep",
      "Insufficient occlusal clearance",
      "Impression drag",
      "Incorrect shade selection",
    ],
  },
  laboratory: {
    label: "Laboratory Error",
    icon: FlaskConical,
    color: "#6366f1", // indigo
    reasons: [
      "Open margin on die",
      "Tight/Loose proximal contacts",
      "Shade mismatch",
      "Framework fitting error",
      "Porcelain fracture",
    ],
  },
};

// Aggregate remake causes across the case set.
export function remakeStats(cases) {
  const withRemake = cases.filter((c) => c.remake);
  const byClass = { clinical: 0, laboratory: 0 };
  const byReason = {};
  withRemake.forEach((c) => {
    const { classification, reason } = c.remake;
    byClass[classification] = (byClass[classification] ?? 0) + 1;
    const key = `${classification}::${reason}`;
    byReason[key] = (byReason[key] ?? 0) + 1;
  });
  const reasons = Object.entries(byReason)
    .map(([key, count]) => {
      const [classification, reason] = key.split("::");
      return { classification, reason, count };
    })
    .sort((a, b) => b.count - a.count);
  return { total: withRemake.length, byClass, reasons };
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

/* ================================================================== */
/*  Log Remake modal                                                   */
/* ================================================================== */

export function RemakeModal({ open, caseObj, onClose, onSave }) {
  const [classification, setClassification] = useState("laboratory");
  const [reason, setReason] = useState(REMAKE_REASONS.laboratory.reasons[0]);
  const [cost, setCost] = useState("");
  const [replacementDate, setReplacementDate] = useState("");

  useEffect(() => {
    if (open && caseObj) {
      const existing = caseObj.remake;
      setClassification(existing?.classification ?? "laboratory");
      setReason(existing?.reason ?? REMAKE_REASONS[existing?.classification ?? "laboratory"].reasons[0]);
      setCost(existing?.cost ?? "");
      setReplacementDate(existing?.replacementDate ?? "");
    }
  }, [open, caseObj]);

  if (!open || !caseObj) return null;

  const pickClassification = (c) => {
    setClassification(c);
    setReason(REMAKE_REASONS[c].reasons[0]);
  };

  const submit = (e) => {
    e.preventDefault();
    onSave({
      classification,
      reason,
      cost: cost === "" ? null : Number(cost),
      replacementDate: replacementDate || null,
      loggedAt: new Date().toISOString(),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <RefreshCcw size={18} className="text-rose-600" />
            <div>
              <h3 className="text-base font-bold text-slate-800">Log Remake</h3>
              <p className="text-[11px] text-slate-500">{caseObj.id} · {caseObj.patientName}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4 px-6 py-5">
          {/* classification */}
          <div>
            <span className="mb-1.5 block text-xs font-medium text-slate-600">Primary Classification</span>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(REMAKE_REASONS).map(([key, cfg]) => {
                const active = classification === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => pickClassification(key)}
                    className={`flex items-center gap-2 rounded-lg border p-3 text-left transition ${
                      active ? "border-slate-800 bg-slate-50 ring-2 ring-slate-200" : "border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <cfg.icon size={16} style={{ color: cfg.color }} />
                    <span className="text-sm font-semibold text-slate-800">{cfg.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* reason */}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Categorized Reason</span>
            <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
              {REMAKE_REASONS[classification].reasons.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Remake Cost / Credit ($)</span>
              <input type="number" min={0} className={inputCls} value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Replacement Appt. Date</span>
              <input type="date" className={inputCls} value={replacementDate} onChange={(e) => setReplacementDate(e.target.value)} />
            </label>
          </div>

          <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            Logging a remake flags this case in the quality analytics and adjusts the lab's remake rate.
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
            <button type="submit" className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700">
              {caseObj.remake ? "Update Remake" : "Log Remake"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Quality breakdown visualizer                                       */
/* ================================================================== */

export function QualityBreakdown({ cases }) {
  const stats = remakeStats(cases);
  const maxReason = Math.max(1, ...stats.reasons.map((r) => r.count));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-center gap-2">
        <PieChart size={16} className="text-slate-400" />
        <h3 className="text-sm font-bold text-slate-800">Remake Root-Cause Breakdown</h3>
        <span className="ml-auto text-xs font-medium text-slate-500">{stats.total} total remake{stats.total !== 1 ? "s" : ""}</span>
      </div>

      {stats.total === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">No remakes logged yet.</p>
      ) : (
        <>
          {/* clinical vs laboratory split */}
          <div className="mb-5">
            <div className="mb-1 flex justify-between text-xs font-medium text-slate-500">
              <span>Clinical vs Laboratory</span>
            </div>
            <div className="flex h-6 overflow-hidden rounded-lg">
              {["clinical", "laboratory"].map((k) => {
                const v = stats.byClass[k] ?? 0;
                const pct = (v / stats.total) * 100;
                if (v === 0) return null;
                return (
                  <div
                    key={k}
                    className="flex items-center justify-center text-[11px] font-semibold text-white"
                    style={{ width: `${pct}%`, background: REMAKE_REASONS[k].color }}
                    title={`${REMAKE_REASONS[k].label}: ${v}`}
                  >
                    {pct >= 12 ? `${Math.round(pct)}%` : ""}
                  </div>
                );
              })}
            </div>
            <div className="mt-1.5 flex gap-4 text-[11px]">
              {Object.entries(REMAKE_REASONS).map(([k, cfg]) => (
                <span key={k} className="flex items-center gap-1 text-slate-600">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: cfg.color }} />
                  {cfg.label} ({stats.byClass[k] ?? 0})
                </span>
              ))}
            </div>
          </div>

          {/* per-reason bars */}
          <div className="space-y-2">
            {stats.reasons.map((r) => (
              <div key={`${r.classification}-${r.reason}`}>
                <div className="mb-0.5 flex justify-between text-[11px]">
                  <span className="text-slate-600">{r.reason}</span>
                  <span className="font-semibold text-slate-700">{r.count}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(r.count / maxReason) * 100}%`, background: REMAKE_REASONS[r.classification].color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
