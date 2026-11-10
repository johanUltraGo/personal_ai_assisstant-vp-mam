import os from "os";
import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Tests wipe every table, so they get their own database and folders and
    // never touch the live prisma/dev.db (dotenv does not override these).
    env: {
      DATABASE_URL: "file:./test.db",
      ATTACHMENT_STORAGE_PATH: path.join(os.tmpdir(), "vp-test-uploads"),
      BACKUP_DIR: path.join(os.tmpdir(), "vp-test-backups"),
    },
    globalSetup: ["tests/globalSetup.ts"],
    setupFiles: ["tests/setup.ts"],
    pool: "forks",
    // All test files share the one test database, so run them one at a time.
    fileParallelism: false,
    maxWorkers: 1,
    // Load shared modules (Prisma, Express) once instead of per file.
    isolate: false,
  },
});
