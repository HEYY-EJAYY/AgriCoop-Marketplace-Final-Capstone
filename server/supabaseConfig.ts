export function readSupabaseConfig(environment: Record<string, string | undefined>) {
  if (environment.NODE_ENV === "production") {
    const missing = [
      ["NEXT_PUBLIC_SUPABASE_URL", environment.NEXT_PUBLIC_SUPABASE_URL],
      ["NEXT_PUBLIC_SUPABASE_ANON_KEY", environment.NEXT_PUBLIC_SUPABASE_ANON_KEY],
    ].filter(([, value]) => !value?.trim()).map(([name]) => name);
    if (missing.length > 0) {
      throw new Error(`Missing required Supabase environment variables in production: ${missing.join(", ")}`);
    }
  }

  return {
    url: environment.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321",
    anonKey: environment.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "local-anon-key",
    serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY ?? "",
  };
}

export function assertSupabaseEnvironment(environment: Record<string, string | undefined>) {
  readSupabaseConfig(environment);
}

export function assertSupabaseServerEnvironment(environment: Record<string, string | undefined>) {
  readSupabaseConfig(environment);
  if (environment.NODE_ENV === "production" && !environment.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    throw new Error("Missing required server-only Supabase environment variable: SUPABASE_SERVICE_ROLE_KEY");
  }
}
