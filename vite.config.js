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
});
