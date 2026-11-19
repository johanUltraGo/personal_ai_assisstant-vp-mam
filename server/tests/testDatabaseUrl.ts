import path from "path";
import { config } from "dotenv";

/**
 * Tests and evals wipe every table, so they never use her data: they run in a
 * separate Postgres schema of the same Supabase database (vp_test / vp_eval),
 * or in TEST_DATABASE_URL when that is set.
 */
export function isolatedDatabaseUrl(schema: "vp_test" | "vp_eval"): string {
  const env = config({ path: path.join(__dirname, "..", ".env"), processEnv: {} }).parsed ?? {};
  const explicit = schema === "vp_test" ? process.env.TEST_DATABASE_URL || env.TEST_DATABASE_URL : undefined;
  if (explicit) return explicit;
  const base = process.env.DATABASE_URL_LIVE || env.DATABASE_URL || "";
  if (!/^postgres(ql)?:\/\//.test(base)) {
    throw new Error("Set DATABASE_URL in server/.env to the Supabase Session pooler connection string before running tests.");
  }
  const url = new URL(base);
  url.searchParams.set("schema", schema);
  return url.toString();
}

export function schemaOf(databaseUrl: string): string {
  return new URL(databaseUrl).searchParams.get("schema") ?? "public";
}
