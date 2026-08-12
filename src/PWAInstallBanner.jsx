import React, { useEffect, useState } from "react";
import { X, Share, SquarePlus, Download } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  PWA install prompt — two very different platform paths:            */
/*                                                                     */
/*  - Chromium (Android/desktop) fires `beforeinstallprompt`, which we  */
/*    defer and replay from our own button, so the invite matches the   */
/*    app's styling instead of the browser's mini-infobar.              */
/*  - iOS Safari has NO install API at all. The only route is the       */
/*    Share sheet, so there we show instructions rather than a button   */
/*    that cannot work.                                                 */
/* ------------------------------------------------------------------ */

const DISMISS_KEY = "pwa_prompt_dismissed_until";
const DISMISS_DAYS = 14;

const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches ||
  // iOS Safari's own non-standard flag — the media query above is unreliable there.
  window.navigator.standalone === true;

const isIos = () =>
  /iphone|ipad|ipod/i.test(window.navigator.userAgent) ||
  // iPadOS 13+ reports as desktop Mac; touch points disambiguate it.
  (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);

const isDismissed = () => {
  try {
    const until = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return Date.now() < until;
  } catch {
    return false; // private mode / storage blocked — just show it
  }
};

const remember = () => {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 864e5));
  } catch {
    /* non-fatal */
  }
};

export default function PWAInstallBanner() {
  // "hidden" | "prompt" (Chromium) | "ios" (manual instructions)
  const [mode, setMode] = useState("hidden");
  const [deferred, setDeferred] = useState(null);

  useEffect(() => {
    if (isStandalone() || isDismissed()) return;

    const onBeforeInstall = (e) => {
      // Suppress Chromium's own mini-infobar; we drive the invite ourselves.
      e.preventDefault();
      // Re-check at fire time, not just at mount: Chromium can re-fire this
      // later in the same page life, which would otherwise resurrect a banner
      // the technician already dismissed.
      if (isDismissed()) return;
      setDeferred(e);
      setMode("prompt");
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // Once installed, never nag again — even in the browser tab.
    const onInstalled = () => {
      remember();
      setMode("hidden");
    };
    window.addEventListener("appinstalled", onInstalled);

    // iOS never fires beforeinstallprompt, so offer the manual path.
    // Delayed so it doesn't collide with first paint / login.
    let t;
    if (isIos()) t = setTimeout(() => setMode("ios"), 2500);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      clearTimeout(t);
    };
  }, []);

  const dismiss = () => {
    remember();
    setMode("hidden");
  };

  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    // A dismissed native prompt can't be re-shown with the same event.
    if (outcome === "dismissed") remember();
    setDeferred(null);
    setMode("hidden");
  };

  if (mode === "hidden") return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center p-3 sm:p-4">
      <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-blue-700 text-white">
            <Download size={18} />
          </div>

          <div className="min-w-0 flex-1">
            {mode === "prompt" ? (
              <>
                <p className="text-sm font-bold text-slate-800">Install Lab Station</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  1-tap bench access, full screen, works through network drops.
                </p>
                <button
                  onClick={install}
                  className="mt-3 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/30 transition hover:bg-blue-700"
                >
                  Install app
                </button>
              </>
            ) : (
              <>
                <p className="text-sm font-bold text-slate-800">Add to Home Screen</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Put Lab Station on this iPad for 1-tap bench access.
                </p>
                <ol className="mt-2.5 space-y-1.5 text-xs text-slate-600">
                  <li className="flex items-center gap-1.5">
                    <span className="font-semibold text-slate-400">1.</span>
                    Tap <Share size={13} className="inline shrink-0 text-blue-600" />
                    <span className="font-semibold">Share</span> in the toolbar
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="font-semibold text-slate-400">2.</span>
                    Choose <SquarePlus size={13} className="inline shrink-0 text-blue-600" />
                    <span className="font-semibold">Add to Home Screen</span>
                  </li>
                </ol>
              </>
            )}
          </div>

          <button
            onClick={dismiss}
            className="-mr-1 -mt-1 shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            title="Not now"
            aria-label="Dismiss install prompt"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
