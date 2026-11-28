import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3000",
    },
  },
  preview: {
    port: 4179,
    proxy: {
      "/api": "http://127.0.0.1:3011",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
