import React, { useEffect, useState } from "react";
import { CloudOff, RefreshCcw, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { subscribe, pendingCount, failedCount, retryFailed, discardFailed } from "./lib/outbox.js";

// A trust indicator for the offline write queue: how many changes are waiting
// to reach the server, whether we're syncing, and any that failed. Without it,
// a technician can't tell a queued-and-safe change from a lost one.
export default function SyncStatus({ onRetry, syncing }) {
  const [counts, setCounts] = useState({ pending: 0, failed: 0 });
  const [online, setOnline] = useState(() => navigator.onLine !== false);

  useEffect(() => {
    const unsub = subscribe(() => setCounts({ pending: pendingCount(), failed: failedCount() }));
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      unsub();
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const waiting = counts.pending; // pending (not-failed) ops
  if (waiting === 0 && counts.failed === 0) return null;

  return (
    <div className="mb-3 space-y-2">
      {waiting > 0 && (
        <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${online ? "border-blue-200 bg-blue-50 text-blue-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
          {online ? (
            syncing ? <Loader2 size={15} className="shrink-0 animate-spin" /> : <RefreshCcw size={15} className="shrink-0" />
          ) : (
            <CloudOff size={15} className="shrink-0" />
          )}
          <span className="min-w-0">
            <b>{waiting}</b> change{waiting === 1 ? "" : "s"}{" "}
            {online ? "syncing…" : "saved on this device — will sync when you're back online"}
          </span>
          {online && !syncing && onRetry && (
            <button onClick={onRetry} className="ml-auto shrink-0 rounded-lg bg-white/70 px-2 py-1 text-xs font-semibold hover:bg-white">
              Sync now
            </button>
          )}
        </div>
      )}
      {counts.failed > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <AlertTriangle size={15} className="shrink-0" />
          <span className="min-w-0">
            <b>{counts.failed}</b> change{counts.failed === 1 ? "" : "s"} couldn't be saved (the server rejected {counts.failed === 1 ? "it" : "them"}).
          </span>
          <span className="ml-auto flex shrink-0 gap-1.5">
            <button
              onClick={() => { retryFailed(); onRetry?.(); }}
              className="rounded-lg bg-white px-2 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100"
            >
              Retry
            </button>
            <button
              onClick={discardFailed}
              className="rounded-lg px-2 py-1 text-xs font-semibold text-rose-500 hover:bg-rose-100"
            >
              Dismiss
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
