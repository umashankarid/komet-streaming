import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // PROJECT RULE 1: 80% coverage is mandatory. Do not lower these.
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
      },
      include: ["src/domain/**/*.ts", "src/api/**/*.ts", "src/persistence/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/index.ts",
        "src/server.ts",
        "src/api/sockets.ts",
        "src/api/app.ts",
      ],
    },
  },
});
