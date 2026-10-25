const REQUIRED_PRODUCTION_ENVIRONMENT = [
  "DATABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

export function assertProductionEnvironment(environment: Record<string, string | undefined>) {
  if (environment.NODE_ENV !== "production") return;

  const missing = REQUIRED_PRODUCTION_ENVIRONMENT.filter(name => !environment[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
  }

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(environment.DATABASE_URL!);
  } catch {
    throw new Error("DATABASE_URL must be a valid MySQL connection URL.");
  }
  if (databaseUrl.protocol !== "mysql:") {
    throw new Error("DATABASE_URL must use the mysql:// protocol.");
  }
}
