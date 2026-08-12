import React, { useEffect, useState } from "react";
import { WifiOff, RefreshCw } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Non-blocking connection indicator for bench use.                   */
/*                                                                     */
/*  A dropped lab network must never look like a broken app or lose    */
/*  the technician's place — the UI stays fully usable on cached data  */
/*  and this just reports state. On reconnect, Supabase's realtime     */
/*  channel resubscribes on its own; we surface a brief confirmation   */
/*  so the bench knows live sync is back rather than guessing.         */
/* ------------------------------------------------------------------ */

export default function ConnectionStatus() {
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const [justReconnected, setJustReconnected] = useState(false);

  useEffect(() => {
    let t;
    const goOnline = () => {
      setOnline(true);
      setJustReconnected(true);
      t = setTimeout(() => setJustReconnected(false), 3000);
    };
    const goOffline = () => {
      setOnline(false);
      setJustReconnected(false);
    };

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      clearTimeout(t);
    };
  }, []);

  if (online && !justReconnected) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 z-40 flex justify-center px-3">
      <div
        className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold shadow-lg ring-1 ring-inset ${
          online
            ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
            : "bg-amber-50 text-amber-800 ring-amber-200"
        }`}
        role="status"
        aria-live="polite"
      >
        {online ? (
          <>
            <RefreshCw size={13} /> Back online — syncing
          </>
        ) : (
          <>
            <WifiOff size={13} /> Reconnecting to Lab Network…
            <span className="font-normal text-amber-700/80">showing saved cases</span>
          </>
        )}
      </div>
    </div>
  );
}
