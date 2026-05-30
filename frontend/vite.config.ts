import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The backend runs on :8000. We proxy /api -> backend so the frontend has no
// hard-coded origin and there are no CORS surprises in dev.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_TARGET || "http://localhost:8000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
