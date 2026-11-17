const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function assertLocalSeedTarget(environment: {
  NODE_ENV?: string;
  AGRICOOP_SEED_TARGET?: string;
  SEED_DATABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
}, options: { requireLocalSupabase?: boolean } = {}) {
  if (environment.NODE_ENV === "production") {
    throw new Error("Seed scripts are disabled in production.");
  }
  if (environment.AGRICOOP_SEED_TARGET !== "local") {
    throw new Error('Set AGRICOOP_SEED_TARGET=local to explicitly authorize a local seed run.');
  }
  const databaseUrl = parseUrl(environment.SEED_DATABASE_URL, "SEED_DATABASE_URL");
  if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol) || !LOCAL_HOSTS.has(databaseUrl.hostname.toLowerCase())) {
    throw new Error("SEED_DATABASE_URL must target a PostgreSQL server on localhost, 127.0.0.1, or ::1.");
  }
  if (options.requireLocalSupabase) {
    const supabaseUrl = parseUrl(environment.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
    if (!["http:", "https:"].includes(supabaseUrl.protocol) || !LOCAL_HOSTS.has(supabaseUrl.hostname.toLowerCase())) {
      throw new Error("Auth seed scripts require NEXT_PUBLIC_SUPABASE_URL to target localhost, 127.0.0.1, or ::1.");
    }
  }
}

function parseUrl(value: string | undefined, variableName: string): URL {
  if (!value) {
    throw new Error(`${variableName} is required for local seed safety checks.`);
  }
  try {
    return new URL(value);
  } catch {
    throw new Error(`${variableName} must be a valid URL for local seed safety checks.`);
  }
}
