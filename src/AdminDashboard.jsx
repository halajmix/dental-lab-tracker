import React, { useState, useEffect, useMemo } from "react";
import {
  ShieldCheck,
  Building2,
  FlaskConical,
  ClipboardList,
  TrendingUp,
  RefreshCcw,
  LogOut,
  Loader2,
  Trash2,
  Eye,
  Users,
  Mail,
  AlertTriangle,
  X,
} from "lucide-react";
import { fetchAllClinics, fetchLabs, fetchCases, adminListUsers, adminDeleteAccount, adminDeleteOrg, adminDeleteCase } from "./lib/data.js";
import { startImpersonation } from "./lib/impersonate.js";
import { STAGES } from "./LifecycleEngine.jsx";
import { AnalyticsDashboard } from "./Analytics.jsx";

/* ------------------------------------------------------------------ */
/*  Super Admin — platform-wide stats PLUS an ops console: delete test  */
/*  cases/accounts and "View as" support access. Mutating actions here  */
/*  go through the admin-actions Edge Function (service role), which    */
/*  independently re-checks role='admin' server-side — this file is not */
/*  the security boundary, just the UI for it.                          */
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

const fmtDate = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
};

/** Small confirm-before-destructive-action dialog — this console has no
 * undo, so every delete routes through here rather than firing on click. */
function ConfirmDialog({ target, busy, onCancel, onConfirm }) {
  if (!target) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center gap-2 text-rose-600">
          <AlertTriangle size={20} />
          <h3 className="text-base font-bold text-slate-800">Delete permanently?</h3>
        </div>
        <p className="mb-5 text-sm text-slate-600">{target.message}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} disabled={busy} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminDashboard({ auth }) {
  const { profile, signOut } = auth;

  const [clinics, setClinics] = useState([]);
  const [labs, setLabs] = useState([]);
  const [cases, setCases] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");

  const [confirmTarget, setConfirmTarget] = useState(null); // { message, run: () => Promise }
  const [busy, setBusy] = useState(false);
  const [viewAsBusyId, setViewAsBusyId] = useState(null);

  const load = () => {
    setLoading(true);
    Promise.all([fetchAllClinics(), fetchLabs(), fetchCases(), adminListUsers()])
      .then(([c, l, cs, u]) => {
        setClinics(c);
        setLabs(l);
        setCases(cs);
        setUsers(u);
        setError("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
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

  const clinicById = useMemo(() => Object.fromEntries(clinics.map((c) => [c.id, c])), [clinics]);
  const labById = useMemo(() => Object.fromEntries(labs.map((l) => [l.id, l])), [labs]);

  // Auth users with no org at all — the exact "junk unconfirmed signup"
  // noise that used to need manual SQL to clean up.
  const orgOwnerIds = useMemo(() => new Set([...clinics.map((c) => c.ownerId), ...labs.map((l) => l.ownerId)].filter(Boolean)), [clinics, labs]);
  const orphanUsers = useMemo(() => users.filter((u) => !orgOwnerIds.has(u.id)), [users, orgOwnerIds]);

  const runAction = async (fn) => {
    setBusy(true);
    setActionError("");
    try {
      await fn();
      setConfirmTarget(null);
      load();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const askDeleteCase = (c) =>
    setConfirmTarget({
      message: `Delete case ${c.id} (${c.patientName})? This removes it permanently for both the clinic and the lab.`,
      run: () => adminDeleteCase(c.id),
    });

  const askDeleteOrg = (kind, org) =>
    setConfirmTarget({
      message: org.ownerId
        ? `Delete "${org.name}" and its owner's login entirely? This removes the ${kind}, all its ${kind === "clinic" ? "cases, and" : ""} the account — they'd need to sign up fresh.`
        : `Delete unclaimed ${kind} "${org.name}"? No login is attached to it.`,
      run: () => (org.ownerId ? adminDeleteAccount(org.ownerId) : adminDeleteOrg(kind, org.id)),
    });

  const askDeleteUser = (u) =>
    setConfirmTarget({
      message: `Delete the login "${u.email}"? It has no clinic or lab attached — this just removes the account so that email can sign up fresh.`,
      run: () => adminDeleteAccount(u.id),
    });

  const viewAs = async (userId) => {
    setViewAsBusyId(userId);
    setActionError("");
    try {
      await startImpersonation(userId);
    } catch (err) {
      setActionError(err.message);
      setViewAsBusyId(null);
    }
  };

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
              <p className="text-[11px] leading-tight text-slate-400">Platform-wide · ops console</p>
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

        {actionError && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
            <span>{actionError}</span>
            <button onClick={() => setActionError("")} className="shrink-0 text-rose-400 hover:text-rose-600">
              <X size={16} />
            </button>
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

            {/* ---------------------- Clinics ops table ---------------------- */}
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
                <Building2 size={15} className="text-blue-500" />
                <h3 className="text-sm font-bold text-slate-800">Clinics ({clinics.length})</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-5 py-2">Name</th>
                      <th className="px-5 py-2">Dentist</th>
                      <th className="px-5 py-2">Email</th>
                      <th className="px-5 py-2">Cases</th>
                      <th className="px-5 py-2">Login</th>
                      <th className="px-5 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {clinics.length === 0 && (
                      <tr><td colSpan={6} className="px-5 py-6 text-center text-slate-400">No clinics yet.</td></tr>
                    )}
                    {clinics.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50/60">
                        <td className="px-5 py-2.5 font-semibold text-slate-800">{c.name}</td>
                        <td className="px-5 py-2.5 text-slate-600">{c.dentist || "—"}</td>
                        <td className="px-5 py-2.5 text-slate-500">{c.email || "—"}</td>
                        <td className="px-5 py-2.5 tabular-nums text-slate-600">{cases.filter((x) => x.clinicId === c.id).length}</td>
                        <td className="px-5 py-2.5">
                          {c.ownerId ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Claimed</span>
                          ) : (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">Unclaimed</span>
                          )}
                        </td>
                        <td className="px-5 py-2.5">
                          <div className="flex justify-end gap-1.5">
                            {c.ownerId && (
                              <button
                                onClick={() => viewAs(c.ownerId)}
                                disabled={viewAsBusyId === c.ownerId}
                                className="flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-60"
                                title="View as this clinic"
                              >
                                {viewAsBusyId === c.ownerId ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />} View as
                              </button>
                            )}
                            <button
                              onClick={() => askDeleteOrg("clinic", c)}
                              className="flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                              title="Delete clinic"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ---------------------- Labs ops table ---------------------- */}
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
                <FlaskConical size={15} className="text-violet-500" />
                <h3 className="text-sm font-bold text-slate-800">Labs ({labs.length})</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-5 py-2">Name</th>
                      <th className="px-5 py-2">Email</th>
                      <th className="px-5 py-2">Cases assigned</th>
                      <th className="px-5 py-2">Login</th>
                      <th className="px-5 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {labs.length === 0 && (
                      <tr><td colSpan={5} className="px-5 py-6 text-center text-slate-400">No labs yet.</td></tr>
                    )}
                    {labs.map((l) => (
                      <tr key={l.id} className="hover:bg-slate-50/60">
                        <td className="px-5 py-2.5 font-semibold text-slate-800">{l.name}</td>
                        <td className="px-5 py-2.5 text-slate-500">{l.email || "—"}</td>
                        <td className="px-5 py-2.5 tabular-nums text-slate-600">{cases.filter((x) => x.labId === l.id).length}</td>
                        <td className="px-5 py-2.5">
                          {l.ownerId ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Claimed</span>
                          ) : (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">Unclaimed</span>
                          )}
                        </td>
                        <td className="px-5 py-2.5">
                          <div className="flex justify-end gap-1.5">
                            {l.ownerId && (
                              <button
                                onClick={() => viewAs(l.ownerId)}
                                disabled={viewAsBusyId === l.ownerId}
                                className="flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-60"
                                title="View as this lab"
                              >
                                {viewAsBusyId === l.ownerId ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />} View as
                              </button>
                            )}
                            <button
                              onClick={() => askDeleteOrg("lab", l)}
                              className="flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                              title="Delete lab"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ---------------------- Cases ops table ---------------------- */}
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
                <ClipboardList size={15} className="text-slate-500" />
                <h3 className="text-sm font-bold text-slate-800">Cases ({cases.length})</h3>
              </div>
              <div className="max-h-96 overflow-y-auto overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-5 py-2">Case</th>
                      <th className="px-5 py-2">Patient</th>
                      <th className="px-5 py-2">Clinic</th>
                      <th className="px-5 py-2">Lab</th>
                      <th className="px-5 py-2">Stage</th>
                      <th className="px-5 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {cases.length === 0 && (
                      <tr><td colSpan={6} className="px-5 py-6 text-center text-slate-400">No cases yet.</td></tr>
                    )}
                    {cases.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50/60">
                        <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{c.id}</td>
                        <td className="px-5 py-2.5 font-semibold text-slate-800">{c.patientName}</td>
                        <td className="px-5 py-2.5 text-slate-600">{clinicById[c.clinicId]?.name ?? "—"}</td>
                        <td className="px-5 py-2.5 text-slate-600">{labById[c.labId]?.name ?? "—"}</td>
                        <td className="px-5 py-2.5 text-slate-600">{STAGES[c.stageIndex]?.label ?? "—"}</td>
                        <td className="px-5 py-2.5">
                          <div className="flex justify-end">
                            <button
                              onClick={() => askDeleteCase(c)}
                              className="flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                              title="Delete case"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ---------------------- Orphan logins (junk signups) ---------------------- */}
            {orphanUsers.length > 0 && (
              <div className="overflow-hidden rounded-xl border border-amber-200 bg-white shadow-sm">
                <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50 px-5 py-3">
                  <Users size={15} className="text-amber-600" />
                  <h3 className="text-sm font-bold text-slate-800">Logins with no clinic or lab ({orphanUsers.length})</h3>
                  <span className="ml-auto text-[11px] font-medium text-amber-600">Usually junk/incomplete signups</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      <tr>
                        <th className="px-5 py-2">Email</th>
                        <th className="px-5 py-2">Signed up</th>
                        <th className="px-5 py-2">Confirmed</th>
                        <th className="px-5 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {orphanUsers.map((u) => (
                        <tr key={u.id} className="hover:bg-slate-50/60">
                          <td className="px-5 py-2.5 flex items-center gap-1.5 font-medium text-slate-700"><Mail size={12} className="text-slate-300" /> {u.email}</td>
                          <td className="px-5 py-2.5 text-slate-500">{fmtDate(u.createdAt)}</td>
                          <td className="px-5 py-2.5">
                            {u.emailConfirmedAt ? (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Confirmed</span>
                            ) : (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">Unconfirmed</span>
                            )}
                          </td>
                          <td className="px-5 py-2.5">
                            <div className="flex justify-end">
                              <button
                                onClick={() => askDeleteUser(u)}
                                className="flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                                title="Delete login"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Reuse the existing SLA analytics wholesale, fed platform-wide data
                instead of one lab's/clinic's — gives lab performance comparison +
                remake root-cause breakdown across every lab for free. */}
            <AnalyticsDashboard cases={cases} labs={labs} />
          </>
        )}
      </main>

      <ConfirmDialog
        target={confirmTarget}
        busy={busy}
        onCancel={() => setConfirmTarget(null)}
        onConfirm={() => confirmTarget && runAction(confirmTarget.run)}
      />
    </div>
  );
}
