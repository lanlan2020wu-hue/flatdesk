// Applies pending migrations from ./drizzle before a production build, so a
// newly connected database gets its tables on the next deploy. Skips quietly
// when there is no DATABASE_URL (the marketing site still builds) and on
// preview builds, so an unmerged branch never changes the live database.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const url = process.env.DATABASE_URL;
const env = process.env.VERCEL_ENV;
if (!url) {
  console.log("migrate: DATABASE_URL not set, skipping");
} else if (env && env !== "production") {
  console.log(`migrate: ${env} build, skipping`);
} else {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.end();
  console.log("migrate: database is up to date");
}
