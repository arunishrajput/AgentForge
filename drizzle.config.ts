import { defineConfig } from "drizzle-kit";

// Node 26 reads the file natively; drizzle-kit does not load .env itself.
try {
  process.loadEnvFile(".env");
} catch {
  // Already-populated environments (CI, Cloud Build) have no .env file.
}

/**
 * Migrations use Neon's DIRECT endpoint. PgBouncer's transaction pooling breaks
 * the session-level operations DDL needs — see ARCHITECTURE.md → Database.
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED!,
  },
  strict: true,
  verbose: true,
});
