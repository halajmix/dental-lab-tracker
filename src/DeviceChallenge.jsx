import React, { useState } from "react";
import { ShieldAlert, Loader2, LogOut } from "lucide-react";
import { verifyDeviceOtp } from "./lib/deviceSession.js";

/* ------------------------------------------------------------------ */
/*  Step-up challenge shown when a bench signs in from an unrecognised */
/*  network. Gates the whole app: while this is up the technician      */
/*  cannot reach patient PII or attachments at all.                    */
/*                                                                     */
/*  NOTE ON ENFORCEMENT: this is an app-layer gate. Row-level          */
/*  enforcement would need the device session id inside the JWT (a     */
/*  Supabase custom access token hook) so RLS could see it — a deeper  */
/*  change than this module. A determined attacker with a valid token  */
/*  could still query the API directly; the challenge raises the bar   */
/*  and creates the audit trail, it is not a substitute for RLS.       */
/* ------------------------------------------------------------------ */

export default function DeviceChallenge({ sessionId, location, emailed, onVerified, onSignOut }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setError("");
    try {
      await verifyDeviceOtp(sessionId, code);
      onVerified();
    } catch (err) {
      setError(err.message);
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-200">
            <ShieldAlert size={20} />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-800">Verify this device</h2>
            <p className="text-xs text-slate-500">
              Signed in from an unrecognised network
              {location && location !== "Unknown location" ? ` (${location})` : ""}.
            </p>
          </div>
        </div>

        <p className="mb-4 text-sm text-slate-600">
          {emailed
            ? "We emailed a 6-digit code to the account owner. Enter it to approve this bench."
            : "A verification code was generated but could not be emailed — ask an administrator to check the station-session function's email configuration."}
        </p>

        <form onSubmit={submit}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            aria-label="6-digit verification code"
            className="w-full rounded-xl border border-transparent bg-gray-50 px-4 py-3 text-center font-mono text-2xl font-black tracking-[0.4em] text-slate-800 outline-none transition focus:bg-white focus:ring-2 focus:ring-blue-500"
          />

          {error && <p className="mt-2 text-sm font-medium text-rose-600">{error}</p>}

          <button
            type="submit"
            disabled={code.length !== 6 || busy}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/30 transition hover:bg-blue-700 disabled:opacity-50"
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            {busy ? "Verifying…" : "Approve this device"}
          </button>
        </form>

        <button
          onClick={onSignOut}
          className="mt-3 flex w-full items-center justify-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-rose-600"
        >
          <LogOut size={13} /> Sign out instead
        </button>
      </div>
    </div>
  );
}
