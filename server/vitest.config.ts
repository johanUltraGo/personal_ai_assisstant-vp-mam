import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    pool: "forks",
    // All test files share one SQLite dev database, so run them one at a time.
    fileParallelism: false,
    maxWorkers: 1,
    // Load shared modules (Prisma, Express) once instead of per file.
    isolate: false,
  },
});
