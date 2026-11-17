import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

const connectionString = process.env.MIGRATION_DATABASE_URL;
if (!connectionString) {
  throw new Error("MIGRATION_DATABASE_URL is required to run Drizzle migration commands");
}

export default defineConfig({
  schema: "./drizzle/pg-schema.ts",
  out: "./drizzle/postgres-migrations",
  dialect: "postgresql",
  schemaFilter: ["agricoop_app"],
  dbCredentials: {
    url: connectionString,
  },
});
