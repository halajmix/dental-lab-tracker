import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import DentalLabTracker from "./DentalLabTracker.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import PWAInstallBanner from "./PWAInstallBanner.jsx";
import ConnectionStatus from "./ConnectionStatus.jsx";
import { AuthGate } from "./Auth.jsx";
import "./index.css";

// Role-gated and rarely used — keep it out of the initial bundle everyone
// else (dentist/lab logins) pays for.
const AdminDashboard = lazy(() => import("./AdminDashboard.jsx"));

function PageLoader() {
  return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-400">Loading…</div>;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      {/* Outside the AuthGate on purpose: connection state and the install
          invite are both relevant on the login screen too, and neither
          should be torn down by an auth state change. */}
      <ConnectionStatus />
      <PWAInstallBanner />
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
    </ErrorBoundary>
  </React.StrictMode>
);
