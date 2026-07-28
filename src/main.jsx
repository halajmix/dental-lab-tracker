import React from "react";
import ReactDOM from "react-dom/client";
import DentalLabTracker from "./DentalLabTracker.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <DentalLabTracker />
    </ErrorBoundary>
  </React.StrictMode>
);
