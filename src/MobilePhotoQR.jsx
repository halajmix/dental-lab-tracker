import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Smartphone, Loader2, CheckCircle2, AlertTriangle, RefreshCcw } from "lucide-react";
import {
  createMobileUploadSession,
  fetchMobileUploadSession,
  cancelMobileUploadSession,
  subscribeMobileUploadSession,
} from "./lib/data.js";

/* ------------------------------------------------------------------ */
/*  Desktop side of the QR mobile upload: creates a single-use session, */
/*  renders its token as a QR, and waits for the phone. Photos arrive   */
/*  over Realtime (with a slow poll as belt-and-braces) and are handed  */
/*  to the parent form via onPhotos, in the exact entry shape the       */
/*  photo grids already render.                                         */
/* ------------------------------------------------------------------ */

export default function MobilePhotoQR({ open, onClose, onPhotos }) {
  const [session, setSession] = useState(null); // {id, expiresAt}
  const [state, setState] = useState("creating"); // creating | waiting | received | expired | error
  const [count, setCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const canvasRef = useRef(null);
  const deliveredRef = useRef(false);

  // One session per open. Cancel it if the modal closes unused.
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    let unsub = () => {};
    let poll = null;
    let expiry = null;
    let sessionId = null; // effect-local: the cleanup below runs long after
    // this render, so reading `session` state there would see a stale null.
    deliveredRef.current = false;
    setState("creating");
    setCount(0);
    setErrorMsg("");

    const deliver = (row) => {
      if (!alive || deliveredRef.current) return;
      const photos = (row?.uploaded ?? []).filter((p) => p?.url);
      if (row?.status === "used" && photos.length > 0) {
        deliveredRef.current = true;
        setCount(photos.length);
        setState("received");
        onPhotos(photos);
      }
    };

    (async () => {
      try {
        const s = await createMobileUploadSession(cryptoGroupIdFrom(open));
        sessionId = s.id;
        if (!alive) { cancelMobileUploadSession(s.id); return; }
        setSession(s);
        setState("waiting");

        // QR: lazy-load the encoder; the URL is this app's own origin.
        const QRCode = (await import("qrcode")).default;
        const url = `${window.location.origin}/mobile-upload/${s.id}`;
        if (canvasRef.current) {
          await QRCode.toCanvas(canvasRef.current, url, { width: 232, margin: 1 });
        }

        unsub = subscribeMobileUploadSession(s.id, (payload) => deliver(payload.new));
        // Realtime is the fast path; the poll rescues a dropped socket.
        poll = setInterval(async () => {
          try {
            deliver(await fetchMobileUploadSession(s.id));
          } catch {
            /* transient */
          }
        }, 6000);
        expiry = setTimeout(() => {
          if (!deliveredRef.current && alive) setState("expired");
        }, Math.max(5_000, new Date(s.expiresAt).getTime() - Date.now()));
      } catch (err) {
        if (!alive) return;
        setErrorMsg(err?.message || "Couldn't start a mobile session.");
        setState("error");
      }
    })();

    return () => {
      alive = false;
      unsub();
      if (poll) clearInterval(poll);
      if (expiry) clearTimeout(expiry);
      // Burn an unused token the moment the modal closes.
      if (!deliveredRef.current && sessionId) cancelMobileUploadSession(sessionId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 p-4" onClick={onClose}>
      <div className="w-full max-w-xs rounded-2xl bg-white p-5 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
            <Smartphone size={15} className="text-blue-600" /> Photos &amp; files from your phone
          </h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {state === "creating" && (
          <p className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
            <Loader2 size={15} className="animate-spin" /> Preparing a secure code…
          </p>
        )}

        {(state === "waiting" || state === "received") && (
          <>
            <canvas ref={canvasRef} className={`mx-auto rounded-lg ${state === "received" ? "opacity-30" : ""}`} />
            {state === "waiting" ? (
              <>
                <p className="mt-2 text-xs font-semibold text-slate-600">Scan with the phone camera, then take or pick the photos there.</p>
                <p className="mt-1 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
                  <Loader2 size={11} className="animate-spin" /> Waiting for the phone · link works once, for 15 minutes
                </p>
              </>
            ) : (
              <p className="mt-2 flex items-center justify-center gap-1.5 text-sm font-bold text-emerald-600">
                <CheckCircle2 size={16} /> {count} photo{count === 1 ? "" : "s"} received — added to the form
              </p>
            )}
          </>
        )}

        {state === "expired" && (
          <div className="py-8">
            <AlertTriangle size={22} className="mx-auto text-amber-500" />
            <p className="mt-2 text-sm font-semibold text-slate-700">That code expired</p>
            <button type="button" onClick={onClose} className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700">
              Close and reopen for a fresh code
            </button>
          </div>
        )}

        {state === "error" && (
          <div className="py-8">
            <AlertTriangle size={22} className="mx-auto text-rose-500" />
            <p className="mt-2 px-2 text-xs font-semibold text-rose-700">{errorMsg}</p>
            <button type="button" onClick={onClose} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">
              <RefreshCcw size={13} /> Close
            </button>
          </div>
        )}

        {state === "received" && (
          <button type="button" onClick={onClose} className="mt-3 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700">
            Done
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}

// `open` carries the form's photo group id (a string); anything else falls
// back to a fresh group so a stray boolean can't break the session insert.
function cryptoGroupIdFrom(open) {
  return typeof open === "string" && open ? open : crypto.randomUUID();
}
