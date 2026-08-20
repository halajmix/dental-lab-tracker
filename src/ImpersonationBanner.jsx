import React, { useEffect, useState } from "react";
import { Eye, LogOut } from "lucide-react";
import { isImpersonating, stopImpersonation, onImpersonationChange } from "./lib/impersonate.js";

/**
 * Persistent "you are viewing as someone else" banner — rendered outside
 * AuthGate (like ConnectionStatus/PWAInstallBanner in main.jsx) so it
 * survives the auth-state change that impersonation itself triggers, and
 * stays visible no matter which dashboard (dentist/lab) is underneath.
 */
export default function ImpersonationBanner() {
  const [active, setActive] = useState(isImpersonating());
  const [leaving, setLeaving] = useState(false);

  useEffect(() => onImpersonationChange(() => setActive(isImpersonating())), []);

  if (!active) return null;

  const returnToAdmin = async () => {
    setLeaving(true);
    try {
      await stopImpersonation();
    } finally {
      setLeaving(false);
    }
  };

  return (
    // z-40: above the app header (z-30) but BELOW every overlay — modals,
    // drawers, and the Print/Share Rx preview live at z-50/z-[70], and at
    // z-[100] this banner used to sit on top of their close buttons,
    // trapping the admin inside full-screen views.
    <div className="sticky top-0 z-40 flex items-center justify-center gap-3 bg-violet-700 px-4 py-2 text-sm font-semibold text-white shadow-md">
      <Eye size={15} />
      <span>Viewing as a user — Super Admin support mode</span>
      <button
        onClick={returnToAdmin}
        disabled={leaving}
        className="flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1 text-xs font-bold hover:bg-white/25 disabled:opacity-60"
      >
        <LogOut size={13} /> {leaving ? "Returning…" : "Return to Admin"}
      </button>
    </div>
  );
}
