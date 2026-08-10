import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Served from https://<user>.github.io/dental-lab-tracker/ in production,
  // from the root during local dev.
  base: process.env.NODE_ENV === "production" ? "/dental-lab-tracker/" : "/",
  server: {
    port: Number(process.env.PORT) || 5173,
    open: false,
  },
  build: {
    // The main chunk sits ~528kB minified / ~144kB gzipped — that gzipped
    // figure is what actually crosses the wire, and it's a reasonable size
    // for an SPA bundling React + a realtime Supabase client + the full UI.
    // jsPDF/html2canvas (the two genuinely heavy deps, ~590kB combined) are
    // already dynamic-imported on first Print/Share use (see PrintRx.jsx),
    // and the admin-only dashboard is now lazy-loaded too (see main.jsx) —
    // both already excluded from this number. Raised from Vite's default
    // 500kB so the build stops warning about a number that's already
    // reasonable; revisit if the main chunk grows meaningfully from here.
    chunkSizeWarningLimit: 600,
  },
});
