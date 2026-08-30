import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/main.ts", "src/mcp.ts", "src/mcp-server.ts"],
      thresholds: {
        statements: 70,
        branches: 60,
        functions: 45,
        lines: 70,
      },
    },
  },
});
