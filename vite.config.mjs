import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "127.0.0.1",
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/client/main.tsx"],
    },
    proxy: {
      "/api": "http://127.0.0.1:4317",
    },
  },
  plugins: [react()],
});
