import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react-swc"
import { defineConfig } from "vite"

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    // Media URLs are relative, just as in the backend-served production SPA.
    proxy: {
      ...(process.env.VITE_AGENT_GATEWAY_URL
        ? {
            "/api/v1/agent": {
              target: process.env.VITE_AGENT_GATEWAY_URL,
              changeOrigin: true,
            },
          }
        : {}),
      ...(process.env.VITE_INFERENCE_GATEWAY_URL
        ? {
            "/api/v1/inference": {
              target: process.env.VITE_INFERENCE_GATEWAY_URL,
              changeOrigin: true,
            },
          }
        : {}),
      "/api": {
        target: process.env.VITE_API_URL || "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "../backend/app/frontend",
    emptyOutDir: true,
    // Local HealthAD previews are served from public/ only by the dev server.
    // Never copy private sample video, labels, or tracks into the backend bundle.
    copyPublicDir: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
})
