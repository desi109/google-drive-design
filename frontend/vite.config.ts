import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === "pages" ? "/google-drive-design/" : "/",
  build: { outDir: mode === "pages" ? "dist-pages" : "dist" },
  server: { proxy: { "/api": { target: "http://127.0.0.1:8080" } } },
}));
