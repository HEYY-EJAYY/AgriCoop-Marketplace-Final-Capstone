const REQUIRED_PRODUCTION_ENVIRONMENT = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

export function assertProductionEnvironment(environment: Record<string, string | undefined>) {
  if (environment.NODE_ENV !== "production") return;

  const missing = REQUIRED_PRODUCTION_ENVIRONMENT.filter(name => !environment[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
  }

  // DATABASE_URL and SUPABASE_SERVICE_ROLE_KEY are intentionally not required
  // for public startup. The active production architecture is Supabase
  // PostgreSQL; public endpoints such as auth.me must start even when a
  // privileged server-only operation is not configured. Those operations must
  // validate their own server-only prerequisites before executing.
}
