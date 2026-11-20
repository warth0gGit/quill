import { defineConfig } from "vite";

// Tauri expects a fixed port in dev and plain static output for builds.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2022", outDir: "dist", emptyOutDir: true },
});
