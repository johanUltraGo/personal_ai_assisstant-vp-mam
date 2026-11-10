import { execSync } from "child_process";

/** Brings the separate test database up to the current schema before any test runs. */
export default function setup() {
  execSync("npx prisma migrate deploy", {
    stdio: "ignore",
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
  });
}
