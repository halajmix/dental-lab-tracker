// Client-side crash reporting: fire-and-forget inserts into the
// client_errors table (schema Phase 24). An hourly pg_cron job emails the
// admin a digest of anything new, so crashes surface without a user having
// to complain. Reporting itself must NEVER be able to break or slow the
// app — everything is wrapped, deduped and capped.
import { supabase } from "./supabaseClient.js";

// Stale-chunk errors self-heal with a reload (see ErrorBoundary) and would
// otherwise spam a report after every deploy.
const IGNORE_RE =
  /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|ChunkLoadError/i;

const seen = new Set();

export function reportError(message, stack) {
  try {
    // Dev servers report into the same production table (same Supabase
    // project) — local editing noise then lands in the admin's hourly
    // digest email. Only the real site reports. (Happened 2026-08-24:
    // mid-edit HMR states from a localhost harness got digested.)
    if (/^(localhost|127\.0\.0\.1|\[?::1]?)$/.test(window.location.hostname)) return;
    const msg = String(message ?? "Unknown error");
    if (IGNORE_RE.test(msg)) return;
    // Service-worker registration rejections (in-app browsers, private
    // mode, extensions wrapping the API) — the app runs fine without a SW,
    // just with no offline shell; nothing to act on. Wrappers vary (seen:
    // ServiceWorkerContainer.<anonymous>, wrsParams.serviceWorkers...), so
    // also match the one constant: our own registerSW.js in the stack.
    if (/ServiceWorkerContainer|serviceWorker\.register|registerSW\.js/.test(String(stack ?? ""))) return;
    const key = msg.slice(0, 200);
    if (seen.has(key) || seen.size >= 20) return; // per-session dedupe + cap
    seen.add(key);
    supabase
      .from("client_errors")
      .insert({
        message: msg.slice(0, 500),
        stack: String(stack ?? "").slice(0, 4000),
        url: String(window.location.href).slice(0, 300),
        ua: String(navigator.userAgent).slice(0, 300),
      })
      .then(
        () => {},
        () => {} // table missing / offline / RLS — reporting is best-effort
      );
  } catch {
    /* never throw from the reporter */
  }
}

export function installGlobalErrorReporting() {
  window.addEventListener("error", (e) => reportError(e.message, e.error?.stack));
  window.addEventListener("unhandledrejection", (e) =>
    reportError(e.reason?.message ?? String(e.reason), e.reason?.stack)
  );
}
