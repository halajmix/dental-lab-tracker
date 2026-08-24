import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import DentalLabTracker from "./DentalLabTracker.jsx";
import ErrorBoundary, { STALE_CHUNK_RELOAD_KEY } from "./ErrorBoundary.jsx";
import PWAInstallBanner from "./PWAInstallBanner.jsx";
import ConnectionStatus from "./ConnectionStatus.jsx";
import ImpersonationBanner from "./ImpersonationBanner.jsx";
import { AuthGate } from "./Auth.jsx";
import { installGlobalErrorReporting } from "./lib/errorReport.js";
import "./index.css";

// Uncaught errors and unhandled rejections anywhere in the app get logged
// to the client_errors table; an hourly job emails the admin a digest.
installGlobalErrorReporting();

// Browser page translation (Google Translate & friends) rewrites text nodes
// underneath React; React's next commit then throws removeChild/insertBefore
// "not a child of this node" and white-screens the app — caught live via the
// error digest (both messages, 2026-08-20). The standard facebook/react#11538
// hardening: degrade gracefully instead of crashing.
if (typeof Node !== "undefined" && Node.prototype) {
  const origRemoveChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function (child, ...rest) {
    if (child && child.parentNode !== this) {
      console.warn("removeChild skipped: node was reparented (browser translation?)");
      return child;
    }
    return origRemoveChild.call(this, child, ...rest);
  };
  const origInsertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function (newNode, referenceNode, ...rest) {
    if (referenceNode && referenceNode.parentNode !== this) {
      console.warn("insertBefore fallback: reference was reparented (browser translation?)");
      return this.appendChild(newNode);
    }
    return origInsertBefore.call(this, newNode, referenceNode, ...rest);
  };
}

// Role-gated and rarely used — keep it out of the initial bundle everyone
// else (dentist/lab logins) pays for. The .catch mirrors ErrorBoundary's
// stale-deploy self-heal: if this chunk's old hashed name is gone after a
// deploy, one reload fetches the fresh index.html that points at the new
// one (guarded so a genuinely broken deploy can't reload-loop).
const AdminDashboard = lazy(() =>
  import("./AdminDashboard.jsx").catch((err) => {
    let alreadyTried = false;
    try {
      alreadyTried = !!sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY);
    } catch {
      alreadyTried = true;
    }
    if (!alreadyTried) {
      try {
        sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, "1");
      } catch {
        /* ignore */
      }
      window.location.reload();
      return new Promise(() => {}); // page is reloading; never resolve
    }
    throw err;
  })
);

// After the app has been healthy for a while, re-arm the one-shot reload
// guard so the NEXT deploy can also self-heal.
setTimeout(() => {
  try {
    sessionStorage.removeItem(STALE_CHUNK_RELOAD_KEY);
  } catch {
    /* ignore */
  }
}, 15000);

// Nudge the service worker to check for a new deploy whenever the app comes
// back to the foreground. iOS installed PWAs poll for SW updates very
// lazily on their own, which has repeatedly left devices running builds
// several deploys old (including crashing ones already fixed in production).
// registerType is "autoUpdate", so once the check downloads a new worker it
// activates immediately and the next open/reload gets fresh code — no
// forced mid-session reload, so unsaved form state is never interrupted.
if ("serviceWorker" in navigator) {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      navigator.serviceWorker
        .getRegistration()
        .then((r) => r?.update())
        .catch(() => {});
    }
  });
}

function PageLoader() {
  return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-400">Loading…</div>;
}

// Site-wide credit line — rendered outside the AuthGate so it shows on the
// login screen and inside every role's dashboard alike.
function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-400">
      Developed and powered by{" "}
      <a
        href="https://paradiseharbours.com"
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-blue-600 hover:underline"
      >
        paradiseharbours.com
      </a>
      , a purely Omani Company.
      <span className="mx-1.5">·</span>
      <a href="/privacy.html" className="text-slate-400 underline hover:text-slate-600">Privacy</a>
      <span className="mx-1.5">·</span>
      <a href="/terms.html" className="text-slate-400 underline hover:text-slate-600">Terms</a>
    </footer>
  );
}

// /mobile-upload/<token> — the page a phone lands on after scanning the Rx
// form's QR (Phase 51). Deliberately OUTSIDE the AuthGate: the single-use
// session token is the credential, and the page can only add photos via the
// token-gated Edge Function, never read anything. Lazy so dentists and labs
// never pay for its chunk. GitHub Pages serves index.html for this path via
// the 404.html SPA fallback; the service worker via navigateFallback.
const mobileUploadToken = window.location.pathname.match(/^\/mobile-upload\/([0-9a-f][0-9a-f-]{20,40})$/i)?.[1];
const MobileUpload = mobileUploadToken ? lazy(() => import("./MobileUpload.jsx")) : null;

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      {/* Outside the AuthGate on purpose: connection state and the install
          invite are both relevant on the login screen too, and neither
          should be torn down by an auth state change. */}
      {MobileUpload ? (
        <Suspense fallback={<PageLoader />}>
          <MobileUpload token={mobileUploadToken} />
        </Suspense>
      ) : (
        <>
          <ConnectionStatus />
          <PWAInstallBanner />
          <ImpersonationBanner />
          <AuthGate>
            {(auth) =>
              auth.profile.role === "admin" ? (
                <Suspense fallback={<PageLoader />}>
                  <AdminDashboard auth={auth} />
                </Suspense>
              ) : (
                <DentalLabTracker auth={auth} />
              )
            }
          </AuthGate>
          <SiteFooter />
        </>
      )}
    </ErrorBoundary>
  </React.StrictMode>
);
