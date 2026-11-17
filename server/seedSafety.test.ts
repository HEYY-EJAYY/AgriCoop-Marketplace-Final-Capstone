import { describe, expect, it } from "vitest";
import { assertLocalSeedTarget } from "./seedSafety";

describe("seed target safety", () => {
  const localDatabase = "postgresql://localhost:5432/agricoop_test";

  it("requires an explicit local target", () => {
    expect(() => assertLocalSeedTarget({ NODE_ENV: "development", SEED_DATABASE_URL: localDatabase }))
      .toThrow("AGRICOOP_SEED_TARGET=local");
    expect(() => assertLocalSeedTarget({
      NODE_ENV: "development",
      AGRICOOP_SEED_TARGET: "staging",
      SEED_DATABASE_URL: localDatabase,
    }))
      .toThrow("AGRICOOP_SEED_TARGET=local");
    expect(() => assertLocalSeedTarget({
      NODE_ENV: "development",
      AGRICOOP_SEED_TARGET: "local",
      SEED_DATABASE_URL: localDatabase,
    }))
      .not.toThrow();
  });

  it("always rejects production regardless of the opt-in flag", () => {
    expect(() => assertLocalSeedTarget({
      NODE_ENV: "production",
      AGRICOOP_SEED_TARGET: "local",
      SEED_DATABASE_URL: localDatabase,
    }))
      .toThrow("disabled in production");
  });

  it("rejects a non-loopback database target", () => {
    expect(() => assertLocalSeedTarget({
      NODE_ENV: "development",
      AGRICOOP_SEED_TARGET: "local",
      SEED_DATABASE_URL: "postgresql://database.example.invalid:5432/agricoop",
    })).toThrow("must target a PostgreSQL server on localhost");
  });

  it("requires Auth seed scripts to use a loopback Supabase URL", () => {
    const environment = {
      NODE_ENV: "development",
      AGRICOOP_SEED_TARGET: "local",
      SEED_DATABASE_URL: localDatabase,
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    };

    expect(() => assertLocalSeedTarget(environment, { requireLocalSupabase: true }))
      .toThrow("Auth seed scripts require");
    expect(() => assertLocalSeedTarget({
      ...environment,
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    }, { requireLocalSupabase: true })).not.toThrow();
  });

  it("requires a database URL before authorizing any seed", () => {
    expect(() => assertLocalSeedTarget({
      NODE_ENV: "development",
      AGRICOOP_SEED_TARGET: "local",
    })).toThrow("SEED_DATABASE_URL is required");
  });
});
