import React, { useMemo } from "react";
import { Clock, Timer, Gauge, TrendingUp, CheckCircle2 } from "lucide-react";
import { LAST_STAGE, STAGE_INDEX } from "./LifecycleEngine.jsx";
import { QualityBreakdown } from "./Remake.jsx";

/* ================================================================== */
/*  Pricing + derived-date helpers                                     */
/* ================================================================== */

// Legacy fallback prices, also used to seed a lab's first real price list.
export const BASE_PRICE = {
  "Crown - tooth": 420,
  "Crown - implant": 950,
  "Bridge - tooth (conventional)": 420,
  "Bridge - tooth (Resin Bonded)": 460,
  "Bridge - implant": 950,
  Veneer: 480,
  "Removable denture": 680,
  "Orthodontics splint": 300,
  "Single layer splint - soft": 180,
  "Double layer splint - soft": 240,
  "Double layer splint - outer hard, inner soft": 320,
  "Michigan splint": 350,
  "Others - refer to notes": 300,
};

// Full fee breakdown for a case. Rush no longer carries a surcharge — it
// only shortens turnaround (see PrescriptionForm's effTat) — so fee is base
// minus any remake credit.
// `_labs` kept for signature stability with callers — pricing no longer
// varies per lab since the express surcharge was removed.
export function caseFee(c, _labs = []) {
  // Cases priced by the Phase 17 DB trigger carry authoritative totals —
  // prefer those over the legacy hardcoded estimate.
  if (c.totalPrice != null) {
    const adjSum = (c.adjustments ?? []).reduce((s, a) => s + (Number(a.amount) || 0), 0);
    return {
      base: Number(c.baseFee ?? c.totalPrice),
      credit: Math.max(0, -adjSum),
      total: Number(c.totalPrice),
      priced: true,
    };
  }
  const restorations = c.prescription?.restorations;
  const base = restorations?.length
    ? restorations.reduce((sum, r) => sum + (BASE_PRICE[r.category] ?? 400) * (r.teeth?.length || 1), 0)
    : (BASE_PRICE[c.prescription?.category] ?? 400) * (c.prescription?.teeth?.length || 1);
  const credit = c.remake?.cost ? Number(c.remake.cost) : 0;
  return { base, credit, total: Math.max(0, base - credit), priced: false };
}

export const caseCost = (c, labs) => caseFee(c, labs).total;

// First timestamp a case reached a given stage index.
const reachedDate = (c, stage) => {
  const e = (c.history ?? []).find((h) => h.toStage === stage && (h.action === "advance" || h.action === "created"));
  return e ? new Date(e.at) : null;
};

const DAY = 86_400_000;

// Actual lab turnaround (days): Picked Up by Lab → Work Complete.
function actualTat(c) {
  const pickup = reachedDate(c, STAGE_INDEX.PICKED_UP_BY_LAB);
  const complete = reachedDate(c, STAGE_INDEX.WORK_COMPLETE);
  if (!pickup || !complete) return null;
  return Math.max(0, (complete - pickup) / DAY);
}

// Delivered on time = reached Clinic Received on/before the appointment date.
function onTime(c) {
  const received = reachedDate(c, LAST_STAGE);
  if (!received || !c.appointmentDate || c.appointmentDate === "—") return null;
  const appt = new Date(c.appointmentDate + "T23:59:59");
  if (isNaN(appt.getTime())) return null;
  return received <= appt;
}

const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
const pct = (n) => (n == null ? "—" : `${Math.round(n * 100)}%`);
const days = (n) => (n == null ? "—" : `${n.toFixed(1)}d`);

/* ================================================================== */
/*  Analytics computation                                              */
/* ================================================================== */

export function computeAnalytics(cases, labs) {
  const now = new Date();
  const perLab = labs.map((lab) => {
    const lc = cases.filter((c) => c.labId === lab.id);
    const tats = lc.map(actualTat).filter((n) => n != null);
    const delivered = lc.map(onTime).filter((v) => v != null);
    const onTimeRate = delivered.length ? delivered.filter(Boolean).length / delivered.length : null;
    const remakes = lc.filter((c) => c.remake).length;
    const remakeRate = lc.length ? remakes / lc.length : 0;
    const spend = lc.reduce((s, c) => s + caseCost(c, labs), 0);
    const otScore = onTimeRate == null ? 1 : onTimeRate;
    const qualityScore = Math.round((otScore * 0.6 + (1 - remakeRate) * 0.4) * 100);
    return {
      id: lab.id,
      name: lab.name,
      promisedTat: lab.tat,
      actualTat: avg(tats),
      onTimeRate,
      remakeRate,
      remakes,
      volume: lc.length,
      spend,
      qualityScore,
    };
  });

  const allTats = cases.map(actualTat).filter((n) => n != null);
  const allDelivered = cases.map(onTime).filter((v) => v != null);
  const monthly = cases.filter((c) => {
    if (!c.createdDate) return false;
    const d = new Date(c.createdDate);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const overall = {
    promisedTat: avg(labs.map((l) => l.tat)),
    actualTat: avg(allTats),
    onTimeRate: allDelivered.length ? allDelivered.filter(Boolean).length / allDelivered.length : null,
    remakeRate: cases.length ? cases.filter((c) => c.remake).length / cases.length : 0,
    monthlySpend: monthly.reduce((s, c) => s + caseCost(c, labs), 0),
    monthlyVolume: monthly.length,
  };

  return { overall, perLab };
}

/* ================================================================== */
/*  UI pieces                                                          */
/* ================================================================== */

function MetricCard({ icon: Icon, tone, label, value, sub }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <Icon size={16} className={tone} />
      </div>
      <p className="mt-1 text-2xl font-bold text-slate-800 tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

const scoreColor = (s) => (s >= 85 ? "#22c55e" : s >= 70 ? "#f59e0b" : "#ef4444");

export function AnalyticsDashboard({ cases, labs }) {
  const { overall, perLab } = useMemo(() => computeAnalytics(cases, labs), [cases, labs]);
  const maxTat = Math.max(1, ...perLab.map((l) => Math.max(l.promisedTat, l.actualTat ?? 0)));

  return (
    <div className="space-y-6">
      {/* summary metric cards */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          icon={Timer}
          tone="text-blue-500"
          label="Avg Turnaround"
          value={days(overall.actualTat)}
          sub={`vs ${days(overall.promisedTat)} promised`}
        />
        <MetricCard
          icon={CheckCircle2}
          tone="text-emerald-500"
          label="On-Time Delivery"
          value={pct(overall.onTimeRate)}
          sub="delivered before appointment"
        />
      </div>

      {/* lab comparison */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-4 flex items-center gap-2">
          <Gauge size={16} className="text-slate-400" />
          <h3 className="text-sm font-bold text-slate-800">Lab Partner Performance</h3>
          <span className="ml-auto text-xs text-slate-400">turnaround reliability &amp; quality</span>
        </div>

        <div className="space-y-5">
          {perLab.map((l) => (
            <div key={l.id} className="grid grid-cols-1 gap-3 border-b border-slate-100 pb-4 last:border-0 last:pb-0 sm:grid-cols-[1.4fr_1fr]">
              {/* turnaround: promised vs actual */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-800">{l.name}</span>
                  <span className="text-[11px] text-slate-400">{l.volume} cases · {l.spend.toLocaleString()} OMR</span>
                </div>
                {/* promised bar */}
                <div className="mb-1 flex items-center gap-2">
                  <span className="w-16 shrink-0 text-[10px] font-medium uppercase text-slate-400">Promised</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-slate-300" style={{ width: `${(l.promisedTat / maxTat) * 100}%` }} />
                  </div>
                  <span className="w-10 shrink-0 text-right text-[11px] font-semibold tabular-nums text-slate-500">{l.promisedTat}d</span>
                </div>
                {/* actual bar */}
                <div className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-[10px] font-medium uppercase text-slate-400">Actual</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${((l.actualTat ?? 0) / maxTat) * 100}%`,
                        background: l.actualTat != null && l.actualTat <= l.promisedTat ? "#3b82f6" : "#f59e0b",
                      }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right text-[11px] font-semibold tabular-nums text-slate-700">{days(l.actualTat)}</span>
                </div>
              </div>

              {/* quality metrics */}
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex justify-between text-[11px] text-slate-500">
                    <span>On-time</span>
                    <span className="font-semibold text-slate-700">{pct(l.onTimeRate)}</span>
                  </div>
                  <div className="mt-1 flex justify-between text-[11px] text-slate-500">
                    <span>Remakes</span>
                    <span className="font-semibold text-slate-700">{pct(l.remakeRate)} ({l.remakes})</span>
                  </div>
                </div>
                {/* quality score dial */}
                <div className="flex flex-col items-center">
                  <div
                    className="flex h-14 w-14 items-center justify-center rounded-full text-sm font-black text-white"
                    style={{ background: scoreColor(l.qualityScore) }}
                    title="Quality score (on-time 60% + non-remake 40%)"
                  >
                    {l.qualityScore}
                  </div>
                  <span className="mt-1 flex items-center gap-0.5 text-[10px] font-medium text-slate-400">
                    <TrendingUp size={10} /> score
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* remake root-cause breakdown */}
      <QualityBreakdown cases={cases} />
    </div>
  );
}
