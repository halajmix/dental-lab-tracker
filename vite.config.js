import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png", "favicon-64x64.png"],
      manifest: {
        name: "Dr-Crown Dental Lab Station",
        short_name: "Lab Station",
        description:
          "Bench station for dental lab case tracking — prescriptions, production queue, and clinic handover.",
        // No router in this app: "/" IS the dashboard once authenticated.
        // (The spec's "/dashboard" route does not exist here.)
        start_url: "/?utm_source=pwa",
        scope: "/",
        display: "standalone",
        orientation: "any",
        // background_color = splash screen behind the icon (matches the app's
        // slate-100 page bg); theme_color = status/title bar (matches the
        // white sticky header, kept in sync with the meta tag in index.html).
        background_color: "#f1f5f9",
        theme_color: "#ffffff",
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Precache the app shell. jsPDF/html2canvas are lazy chunks that a
        // technician may never load, so they're left out of the precache and
        // fetched on demand instead of bloating first install.
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        globIgnores: ["**/jspdf*", "**/html2canvas*"],
        navigateFallback: "/index.html",
        // 404.html is GitHub Pages' SPA fallback, not a real route.
        navigateFallbackDenylist: [/^\/404\.html$/],
        runtimeCaching: [
          {
            // Case data must never be served stale from cache — always hit
            // the network, but fall back to the last response when the bench
            // drops off the lab network so cached prescriptions stay visible.
            urlPattern: ({ url }) => url.hostname.endsWith(".supabase.co"),
            handler: "NetworkFirst",
            options: {
              cacheName: "supabase-api",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  // Custom domain (dr-crown.com) serves from the root, same as local dev —
  // the /dental-lab-tracker/ sub-path only applied to the old bare
  // halajmix.github.io/dental-lab-tracker/ URL, which now 301-redirects to
  // the custom domain automatically once GitHub Pages picks up the CNAME
  // file (see public/CNAME) — no need to keep two different base paths.
  base: "/",
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
