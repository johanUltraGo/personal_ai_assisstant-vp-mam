/**
 * Puts a daily backup back into the database, replacing what is there now.
 *   npm run restore -- backups/vp-2026-11-18.json
 * Stop the server first (npm run service:stop), restore, then start it again.
 */
import path from "path";

async function main() {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
  const file = process.argv[2];
  if (!file) {
    console.log("Which backup? Example: npm run restore -- backups/vp-2026-11-18.json");
    process.exit(2);
  }
  const { restoreBackup } = await import("../src/services/backupService");
  const { prisma } = await import("../src/db");
  console.log(`Replacing all data with ${file} ...`);
  const counts = await restoreBackup(path.resolve(file));
  for (const [table, n] of Object.entries(counts)) if (n) console.log(`  ${table}: ${n}`);
  console.log("Restored.");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
