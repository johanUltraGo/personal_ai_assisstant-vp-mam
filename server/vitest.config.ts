import os from "os";
import path from "path";
import { defineConfig } from "vitest/config";
import { isolatedDatabaseUrl } from "./tests/testDatabaseUrl";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Tests wipe every table, so they get their own schema (vp_test) and
    // folders and never touch her live data (dotenv does not override these).
    env: {
      DATABASE_URL: isolatedDatabaseUrl("vp_test"),
      // Attachments in tests go to a temp folder, never to Supabase Storage.
      SUPABASE_URL: "",
      SUPABASE_SECRET_KEY: "",
      ATTACHMENT_STORAGE_PATH: path.join(os.tmpdir(), "vp-test-uploads"),
      BACKUP_DIR: path.join(os.tmpdir(), "vp-test-backups"),
      // The live access settings in .env (her PIN, secure cookies for the
      // https tunnel) must not leak into tests; auth tests set their own.
      APP_ACCESS_PIN: "",
      COOKIE_SECURE: "",
      HOST: "",
    },
    globalSetup: ["tests/globalSetup.ts"],
    setupFiles: ["tests/setup.ts"],
    pool: "forks",
    // All test files share the one test database, so run them one at a time.
    fileParallelism: false,
    maxWorkers: 1,
    // Load shared modules (Prisma, Express) once instead of per file.
    isolate: false,
    // Generous limit: file and database tests can be slow on a busy machine.
    testTimeout: 20_000,
  },
});
