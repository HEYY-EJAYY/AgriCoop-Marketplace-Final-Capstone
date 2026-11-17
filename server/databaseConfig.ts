export function assertDatabaseEnvironment(environment: Record<string, string | undefined>) {
  if (environment.NODE_ENV !== "test" && !environment.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required to start the AgriCoop server.");
  }
}
