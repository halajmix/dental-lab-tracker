import React from "react";
import { AlertTriangle, RotateCcw, RefreshCw } from "lucide-react";
import { reportError } from "./lib/errorReport.js";

// A deploy replaces the hashed JS chunks; a page (or service worker cache)
// from before the deploy then fails to import modules that no longer exist
// under their old names. Safari words it "Importing a module script failed",
// Chrome "Failed to fetch dynamically imported module". One reload fixes it
// — so do that automatically, once (sessionStorage-guarded against loops;
// main.jsx clears the guard after the app has been healthy for a while).
const STALE_CHUNK_RE =
  /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|ChunkLoadError/i;
export const STALE_CHUNK_RELOAD_KEY = "drcrown.stale-chunk-reload";

/**
 * Catches render errors anywhere below it and shows a friendly fallback
 * instead of a blank white/black screen. Class component because only class
 * components can be error boundaries in React.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, recovering: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("App crashed:", error, info?.componentStack);
    // Render crashes are the highest-signal errors — report includes the
    // component stack so the broken component is identifiable from the
    // digest email alone. (reportError skips stale-chunk errors itself.)
    reportError(error?.message || error, `${error?.stack ?? ""}\n--- component stack ---${info?.componentStack ?? ""}`);

    // Stale-deploy self-heal: reload once instead of showing the crash card.
    let alreadyTried = false;
    try {
      alreadyTried = !!sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY);
    } catch {
      alreadyTried = true; // no sessionStorage -> don't risk a reload loop
    }
    if (STALE_CHUNK_RE.test(String(error?.message || error)) && !alreadyTried) {
      try {
        sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, "1");
      } catch {
        /* ignore */
      }
      this.setState({ recovering: true });
      window.location.reload();
    }
  }

  reload = () => window.location.reload();

  resetData = () => {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("dentatrack"))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    if (this.state.recovering) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-slate-500">
            <RefreshCw size={16} className="animate-spin" /> Updating to the latest version…
          </p>
        </div>
      );
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 text-slate-800">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
            <AlertTriangle size={22} />
          </div>
          <h1 className="text-lg font-bold text-slate-800">Something went wrong</h1>
          <p className="mt-1 text-sm text-slate-500">
            The app hit an unexpected error and stopped rendering. Your saved data is untouched — try
            reloading. If it keeps happening, resetting the local demo data usually clears it.
          </p>

          <pre className="mt-3 max-h-32 overflow-auto rounded-lg bg-slate-900 px-3 py-2 text-[11px] leading-relaxed text-rose-300">
            {String(this.state.error?.message || this.state.error)}
          </pre>

          <div className="mt-4 flex gap-2">
            <button
              onClick={this.reload}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              <RefreshCw size={15} /> Reload
            </button>
            <button
              onClick={this.resetData}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              <RotateCcw size={15} /> Reset data &amp; reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
