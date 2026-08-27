import React, { useEffect, useMemo, useState } from "react";
import { Building2, Loader2, Lock, Globe, ShieldCheck } from "lucide-react";
import {
  fetchClinicLabAccess,
  grantClinicLabAccess,
  revokeClinicLabAccess,
  setClinicExclusive,
  setLabPublic,
} from "./lib/data.js";

/**
 * Super-admin clinic↔lab visibility matrix (Phase 58).
 *
 * Two dials, enforced by RLS:
 *  - per clinic: "Exclusive" — the clinic sees ONLY labs ticked below.
 *  - per lab: "Public" — untick and the lab is visible only to clinics
 *    it is explicitly mapped to.
 * Defaults (all public, none exclusive) reproduce the open directory.
 */
export default function ClinicLabMatrix({ clinics, labs, onFlagsChanged }) {
  const activeClinics = useMemo(() => clinics.filter((c) => c.status !== "suspended"), [clinics]);
  const claimedLabs = useMemo(() => labs.filter((l) => l.ownerId), [labs]);

  const [selectedClinicId, setSelectedClinicId] = useState("");
  const [access, setAccess] = useState(null); // [{clinicId, labId}] | null loading
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState(""); // which toggle is in flight
  // Local flag copies so toggles feel instant without a full admin reload.
  const [exclusiveById, setExclusiveById] = useState({});
  const [publicById, setPublicById] = useState({});

  useEffect(() => {
    setExclusiveById(Object.fromEntries(clinics.map((c) => [c.id, !!c.isExclusive])));
  }, [clinics]);
  useEffect(() => {
    setPublicById(Object.fromEntries(labs.map((l) => [l.id, l.isPublic !== false])));
  }, [labs]);

  const load = () => {
    fetchClinicLabAccess()
      .then(setAccess)
      .catch((err) => {
        setAccess([]);
        setError("Couldn't load the access map — has the Phase 58 SQL been run? (" + err.message + ")");
      });
  };
  useEffect(load, []);

  useEffect(() => {
    if (!selectedClinicId && activeClinics.length) setSelectedClinicId(activeClinics[0].id);
  }, [activeClinics, selectedClinicId]);

  const clinic = activeClinics.find((c) => c.id === selectedClinicId) ?? null;
  const mapped = (labId) => access?.some((a) => a.clinicId === selectedClinicId && a.labId === labId) ?? false;

  const run = async (key, fn) => {
    if (busyKey) return;
    setBusyKey(key);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyKey("");
    }
  };

  const toggleMapping = (labId) =>
    run(`map-${labId}`, async () => {
      if (mapped(labId)) {
        await revokeClinicLabAccess(selectedClinicId, labId);
        setAccess((prev) => prev.filter((a) => !(a.clinicId === selectedClinicId && a.labId === labId)));
      } else {
        await grantClinicLabAccess(selectedClinicId, labId);
        setAccess((prev) => [...(prev ?? []), { clinicId: selectedClinicId, labId }]);
      }
    });

  const toggleExclusive = () =>
    run("exclusive", async () => {
      const next = !exclusiveById[selectedClinicId];
      await setClinicExclusive(selectedClinicId, next);
      setExclusiveById((p) => ({ ...p, [selectedClinicId]: next }));
      onFlagsChanged?.();
    });

  const togglePublic = (labId) =>
    run(`pub-${labId}`, async () => {
      const next = !publicById[labId];
      await setLabPublic(labId, next);
      setPublicById((p) => ({ ...p, [labId]: next }));
      onFlagsChanged?.();
    });

  const Toggle = ({ on, busy, onClick, labelOn, labelOff }) => (
    <button
      onClick={onClick}
      disabled={busy}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${on ? "bg-blue-600" : "bg-slate-300"} ${busy ? "opacity-50" : ""}`}
      title={on ? labelOn : labelOff}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
  );

  const exclusive = !!exclusiveById[selectedClinicId];

  return (
    <div className="space-y-5">
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</p>}

      {/* ---------------- per-clinic access ---------------- */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-slate-800">
          <ShieldCheck size={15} className="text-blue-600" /> Clinic lab access
        </h3>
        <p className="mb-3 text-xs text-slate-500">
          Exclusive clinics see <b>only</b> the labs ticked for them. Standard clinics see every public lab
          plus any extra labs ticked here.
        </p>
        <select
          value={selectedClinicId}
          onChange={(e) => setSelectedClinicId(e.target.value)}
          className="mb-3 w-full max-w-sm rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700"
        >
          {activeClinics.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        {clinic && (
          <>
            <div className="mb-3 flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5">
              <div>
                <p className="text-sm font-semibold text-slate-800">Exclusive mode</p>
                <p className="text-[11px] text-slate-500">
                  {exclusive
                    ? "Contracted labs only — public labs are hidden from this clinic."
                    : "Standard — all public labs plus any ticked below."}
                </p>
              </div>
              <Toggle on={exclusive} busy={busyKey === "exclusive"} onClick={toggleExclusive} labelOn="Exclusive" labelOff="Standard" />
            </div>

            {access === null ? (
              <div className="flex justify-center py-6 text-slate-400"><Loader2 size={16} className="animate-spin" /></div>
            ) : (
              <div className="space-y-1.5">
                {claimedLabs.map((l) => {
                  const on = mapped(l.id);
                  const effective = on || (!exclusive && publicById[l.id]);
                  return (
                    <div key={l.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-700">{l.name}</p>
                        <p className="text-[10px] text-slate-400">
                          {on ? "Contracted (always visible)" : effective ? "Visible via public directory" : "Hidden from this clinic"}
                        </p>
                      </div>
                      <Toggle on={on} busy={busyKey === `map-${l.id}`} onClick={() => toggleMapping(l.id)} labelOn="Contracted" labelOff="Not contracted" />
                    </div>
                  );
                })}
                {claimedLabs.length === 0 && <p className="text-sm text-slate-400">No claimed labs yet.</p>}
              </div>
            )}
          </>
        )}
      </div>

      {/* ---------------- global lab visibility ---------------- */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-slate-800">
          <Building2 size={15} className="text-blue-600" /> Lab directory visibility
        </h3>
        <p className="mb-3 text-xs text-slate-500">
          Private labs disappear from the open directory — only clinics contracted to them (above) can see
          and send to them.
        </p>
        <div className="space-y-1.5">
          {claimedLabs.map((l) => {
            const pub = !!publicById[l.id];
            return (
              <div key={l.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                <p className="flex min-w-0 items-center gap-1.5 truncate text-sm font-medium text-slate-700">
                  {pub ? <Globe size={13} className="shrink-0 text-emerald-500" /> : <Lock size={13} className="shrink-0 text-amber-500" />}
                  {l.name}
                  <span className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${pub ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                    {pub ? "Public" : "Private"}
                  </span>
                </p>
                <Toggle on={pub} busy={busyKey === `pub-${l.id}`} onClick={() => togglePublic(l.id)} labelOn="Public" labelOff="Private" />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
