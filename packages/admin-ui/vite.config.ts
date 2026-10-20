import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // The console is served from /admin/console/ by the Fastify server, so
  // every asset URL is rooted there. Deep links keep working because the
  // server falls back to index.html for unknown /admin/console/* paths.
  base: "/admin/console/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    // Default lands next to the compiled server output (bantam/dist/admin-ui)
    // so the runtime can serve it from a single artifact tree. The Docker
    // build overrides this to keep the stage self-contained.
    outDir: process.env["BANTAM_ADMIN_UI_OUT_DIR"] ?? "../../dist/admin-ui",
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/admin": {
        target: "http://127.0.0.1:3000",
        changeOrigin: false,
      },
    },
  },
});
