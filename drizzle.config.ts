import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run drizzle commands");
}
if (new URL(connectionString).port !== "6543") {
  throw new Error("DATABASE_URL must use the Supabase transaction pooler on port 6543");
}

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle-postgres",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
