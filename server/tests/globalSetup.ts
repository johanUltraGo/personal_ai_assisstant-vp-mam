import { execSync } from "child_process";
import { isolatedDatabaseUrl } from "./testDatabaseUrl";

/** Brings the separate test schema (vp_test) up to the current schema before any test runs. */
export default function setup() {
  execSync("npx prisma migrate deploy", {
    stdio: "ignore",
    env: { ...process.env, DATABASE_URL: isolatedDatabaseUrl("vp_test") },
  });
}
