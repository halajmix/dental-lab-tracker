import React, { useState, useEffect } from "react";
import { ShieldCheck, Building2, FlaskConical, ClipboardList, TrendingUp, RefreshCcw, LogOut, Loader2 } from "lucide-react";
import { fetchAllClinics, fetchLabs, fetchCases } from "./lib/data.js";
import { STAGES } from "./LifecycleEngine.jsx";
import { AnalyticsDashboard } from "./Analytics.jsx";

/* ------------------------------------------------------------------ */
/*  Super Admin — read-only, platform-wide view. No mutation actions   */
/*  live here on purpose (see supabase/schema.sql: admin RLS policies  */
/*  only grant SELECT) — this is an overview, not an ops console.      */
/* ------------------------------------------------------------------ */

function StatCard({ icon: Icon, label, value, tone, sub }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <Icon size={16} className={tone} />
      </div>
      <p className="mt-1 text-2xl font-bold text-slate-800 tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

export default function AdminDashboard({ auth }) {
  const { profile, signOut } = auth;

  const [clinics, setClinics] = useState([]);
  const [labs, setLabs] = useState([]);
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    Promise.all([fetchAllClinics(), fetchLabs(), fetchCases()])
      .then(([c, l, cs]) => {
        setClinics(c);
        setLabs(l);
        setCases(cs);
        setError("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const now = new Date();
  const casesThisMonth = cases.filter((c) => {
    if (!c.createdDate) return false;
    const d = new Date(c.createdDate);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  const stageCounts = STAGES.map((_, i) => cases.filter((c) => c.stageIndex === i).length);
  const maxStageCount = Math.max(1, ...stageCounts);
  const firstLoad = loading && clinics.length === 0 && labs.length === 0 && cases.length === 0;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      {/* ------------------------- Header ------------------------- */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-700 text-white">
              <FlaskConical size={18} />
            </div>
            <div>
              <h1 className="text-sm font-bold leading-tight text-slate-800">Dr-Crown</h1>
              <p className="flex items-center gap-1 text-[11px] leading-tight text-violet-600">
                <ShieldCheck size={11} /> Super Admin
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={load}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              title="Refresh"
            >
              <RefreshCcw size={16} className={loading ? "animate-spin" : ""} />
            </button>
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold leading-tight text-slate-800">{profile.name || "Admin"}</p>
              <p className="text-[11px] leading-tight text-slate-400">Platform-wide · read-only</p>
            </div>
            <button
              onClick={signOut}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 hover:text-rose-600"
              title="Sign out"
            >
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
            Couldn't load platform data: {error}
          </div>
        )}

        {firstLoad ? (
          <div className="flex items-center justify-center py-24 text-sm text-slate-400">
            <Loader2 size={20} className="mr-2 animate-spin" /> Loading platform data…
          </div>
        ) : (
          <>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Platform Overview</h2>
              <p className="text-sm text-slate-500">Every clinic and lab on Dr-Crown, at a glance.</p>
            </div>

            {/* Top-level totals */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard icon={Building2} tone="text-blue-500" label="Clinics" value={clinics.length} />
              <StatCard icon={FlaskConical} tone="text-violet-500" label="Labs" value={labs.length} />
              <StatCard icon={ClipboardList} tone="text-slate-400" label="Total Cases" value={cases.length} />
              <StatCard icon={TrendingUp} tone="text-emerald-500" label="Cases This Month" value={casesThisMonth} />
            </div>

            {/* Pipeline distribution — where every case on the platform currently sits */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-4 text-sm font-bold text-slate-800">Cases by Stage</h3>
              {cases.length === 0 ? (
                <p className="text-sm text-slate-400">No cases on the platform yet.</p>
              ) : (
                <div className="space-y-2.5">
                  {STAGES.map((s, i) => (
                    <div key={s.key} className="flex items-center gap-3">
                      <span className="w-32 shrink-0 text-xs font-medium text-slate-500">{s.label}</span>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${(stageCounts[i] / maxStageCount) * 100}%`, background: s.color }}
                        />
                      </div>
                      <span className="w-8 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-700">{stageCounts[i]}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Reuse the existing SLA analytics wholesale, fed platform-wide data
                instead of one lab's/clinic's — gives lab performance comparison +
                remake root-cause breakdown across every lab for free. */}
            <AnalyticsDashboard cases={cases} labs={labs} />
          </>
        )}
      </main>
    </div>
  );
}
