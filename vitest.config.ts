import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["tests/live-ollama.test.ts"],
    coverage: {
      reporter: ["text", "html"],
      include: ["src/server/**/*.ts", "src/shared/**/*.ts"],
      exclude: ["src/server/index.ts"],
      thresholds: {
        statements: 72,
        branches: 69,
        functions: 84,
        lines: 72,
      },
    },
  },
});
