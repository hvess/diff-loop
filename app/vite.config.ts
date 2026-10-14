import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// The port is fixed: tauri.conf.json's devUrl points here.
export default defineConfig({
  // The React Compiler memoizes components and hooks (ADR 0011 §2).
  plugins: [react({ babel: { plugins: ["babel-plugin-react-compiler"] } }), tailwindcss()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
  // highlight.worker.ts imports Shiki's language chunks on demand.
  worker: { format: "es" },
});
