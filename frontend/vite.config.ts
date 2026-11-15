// Vite: the dev server and build tool for the page you see in the browser.
//
// While building: run the backend with AICITY_DEV=1, then `npm run dev` here.
// The page is served at http://127.0.0.1:5173 and any /api request is passed
// through to the backend at http://127.0.0.1:8765.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1", // this Mac only, never the network
    port: 5173,
    strictPort: true, // fail rather than quietly pick another port
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8765",
        // Keep the dev address on each request. The backend's front-door lock
        // only admits that address when AICITY_DEV=1 is set.
        changeOrigin: false,
      },
    },
  },
  preview: {
    host: "127.0.0.1",
  },
});
