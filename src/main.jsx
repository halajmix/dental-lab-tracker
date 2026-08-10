import React from "react";
import ReactDOM from "react-dom/client";
import DentalLabTracker from "./DentalLabTracker.jsx";
import AdminDashboard from "./AdminDashboard.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import { AuthGate } from "./Auth.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthGate>
        {(auth) => (auth.profile.role === "admin" ? <AdminDashboard auth={auth} /> : <DentalLabTracker auth={auth} />)}
      </AuthGate>
    </ErrorBoundary>
  </React.StrictMode>
);
