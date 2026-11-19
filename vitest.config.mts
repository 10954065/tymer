import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/support/empty-module.ts"),
    },
  },
  test: {
    environment: "node",
    globalSetup: ["./tests/support/global-setup.ts"],
    setupFiles: ["./tests/support/setup-env.ts"],
    include: ["tests/**/*.test.ts"],
    // Integration tests share one Postgres test database, so files run one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/lib/**", "src/server/**"],
      exclude: ["src/server/db/schema/**", "src/**/*.d.ts", "src/lib/utils.ts"],
      reporter: ["text-summary", "text"],
    },
  },
});
