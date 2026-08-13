import React, { useEffect, useRef, useState } from "react";
import { Monitor, Check, Pencil, ShieldAlert, ShieldCheck, Trash2, Loader2 } from "lucide-react";
import {
  fetchDeviceSessions,
  renameDeviceSession,
  revokeDeviceSession,
  getDeviceFingerprint,
} from "./lib/deviceSession.js";

const fmt = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

/* ------------------------------------------------------------------ */
/*  Bench session audit — list, label and revoke devices.              */
/*  Scoped by RLS: a user sees their own devices, and an org's members */
/*  see that org's benches.                                            */
/* ------------------------------------------------------------------ */

export default function DeviceManagement() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);
  const thisDevice = getDeviceFingerprint();

  // Set before the Phase 9 migration has been run: the tables simply don't
  // exist yet. That's a provisioning state, not an error the user caused, so
  // it gets a neutral note rather than a red failure banner.
  const [notProvisioned, setNotProvisioned] = useState(false);

  const load = () => {
    setLoading(true);
    fetchDeviceSessions()
      .then((r) => {
        setRows(r);
        setNotProvisioned(false);
      })
      .catch((err) => {
        if (/lab_device_sessions/.test(err.message || "")) setNotProvisioned(true);
        else setError(err.message);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);
  useEffect(() => {
    if (editingId) inputRef.current?.focus();
  }, [editingId]);

  const startEdit = (row) => {
    setEditingId(row.id);
    setDraft(row.sessionName);
  };

  const commitEdit = async (row) => {
    const name = draft.trim();
    setEditingId(null);
    if (!name || name === row.sessionName) return;
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, sessionName: name } : r)));
    try {
      await renameDeviceSession(row.id, name);
    } catch (err) {
      setError(err.message);
      load();
    }
  };

  const revoke = async (row) => {
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    try {
      await revokeDeviceSession(row.id);
    } catch (err) {
      setError(err.message);
      load();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-slate-400">
        <Loader2 size={15} className="animate-spin" /> Loading devices…
      </div>
    );
  }

  if (notProvisioned) {
    return (
      <p className="py-2 text-xs text-slate-400">
        Device auditing isn't enabled yet — run the Phase&nbsp;9 migration and deploy the
        device-session function to start recording benches.
      </p>
    );
  }

  return (
    <div>
      {error && (
        <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      )}

      {rows.length === 0 ? (
        <p className="py-4 text-sm text-slate-400">No active devices recorded yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const isThis = r.fingerprint === thisDevice;
            return (
              <div key={r.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {editingId === r.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          ref={inputRef}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={() => commitEdit(r)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitEdit(r);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          placeholder="e.g. Main Bench iPad"
                          className="w-full rounded-lg border border-blue-300 px-2 py-1 text-sm font-semibold text-slate-800 outline-none ring-2 ring-blue-100"
                        />
                        <button
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => commitEdit(r)}
                          className="rounded-lg p-1 text-emerald-600 hover:bg-emerald-50"
                          title="Save name"
                        >
                          <Check size={15} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEdit(r)}
                        className="group flex items-center gap-1.5 text-left"
                        title="Rename this bench"
                      >
                        <Monitor size={14} className="shrink-0 text-slate-400" />
                        <span className="truncate text-sm font-bold text-slate-800">
                          {r.sessionName}
                        </span>
                        <Pencil
                          size={11}
                          className="shrink-0 text-slate-300 transition group-hover:text-slate-500"
                        />
                      </button>
                    )}

                    <p className="mt-1 truncate text-xs text-slate-500">
                      {r.deviceLabel || "Unknown device"}
                      {r.currentIp ? ` · ${r.currentIp}` : ""}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      Last active {fmt(r.lastActiveAt)}
                      {isThis && <span className="ml-1 font-semibold text-blue-600">· this device</span>}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {r.status === "CHALLENGE_REQUIRED" ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200"
                        title="Signed in from an unrecognised network — awaiting emailed code"
                      >
                        <ShieldAlert size={11} /> Verify
                      </span>
                    ) : r.isTrusted ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                        <ShieldCheck size={11} /> Trusted
                      </span>
                    ) : null}

                    <button
                      onClick={() => revoke(r)}
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                      title="Revoke this device"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-3 text-[11px] text-slate-400">
        Revoking signs that bench out on its next check-in. This device is{" "}
        <span className="font-mono">{thisDevice.slice(0, 8)}…</span>
      </p>
    </div>
  );
}
