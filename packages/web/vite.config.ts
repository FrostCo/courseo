import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // In dev the API runs separately (pnpm dev starts both); in production
    // the server serves this build itself, so no proxy exists.
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
