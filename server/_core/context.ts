import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { AuthenticatedApplicationUser, AuthIdentityResolution } from "../authIdentity";
import { supabaseAdmin } from "../clients";
import { getUserByVerifiedAuthId, withRequestDatabaseScope } from "../db";
import { isVerifiedSupabaseEmail } from "../registration";

export type AuthResolution =
  | "no_bearer_token"
  | "bearer_rejected"
  | "auth_validation_failed"
  | "application_database_unavailable"
  | "application_database_access_denied"
  | "application_database_schema_unavailable"
  | AuthIdentityResolution["status"]
  | "email_not_verified";
export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: AuthenticatedApplicationUser | null;
  authUserId: string | null;
  authResolution: AuthResolution;
};

function logAuthDiagnostic(event: AuthResolution, details: Record<string, boolean | string> = {}) {
  if (process.env.NODE_ENV === "development" || process.env.AGRICOOP_AUTH_DIAGNOSTICS === "true") {
    console.info("[AuthDiagnostic]", { component: "server.createContext", event, ...details });
  }
}

function getDatabaseErrorCode(error: unknown): string | undefined {
  const visited = new Set<object>();
  let current = error;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null && !visited.has(current); depth += 1) {
    visited.add(current);
    if ("code" in current && typeof current.code === "string") return current.code;
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}

function getDatabaseErrorPhase(error: unknown): string | undefined {
  const visited = new Set<object>();
  let current = error;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null && !visited.has(current); depth += 1) {
    visited.add(current);
    if ("databasePhase" in current && typeof current.databasePhase === "string") return current.databasePhase;
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}

function getDatabaseFailureResolution(error: unknown): AuthResolution {
  const errorCode = getDatabaseErrorCode(error);
  if (errorCode === "42501") return "application_database_access_denied";
  if (["3F000", "42P01", "42703", "42704"].includes(errorCode ?? "")) {
    return "application_database_schema_unavailable";
  }
  return "application_database_unavailable";
}

export async function createContext(opts: CreateExpressContextOptions): Promise<TrpcContext> {
  let user: AuthenticatedApplicationUser | null = null;
  let authUserId: string | null = null;
  let authResolution: AuthResolution = "no_bearer_token";
  const bearer = opts.req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (bearer) {
    let result: Awaited<ReturnType<typeof supabaseAdmin.auth.getUser>>;
    try {
      result = await supabaseAdmin.auth.getUser(bearer);
    } catch {
      authResolution = "auth_validation_failed";
      logAuthDiagnostic(authResolution);
      throw new Error("Supabase Auth token validation failed.");
    }
    const { data, error } = result;
    if (error || !data.user) {
      const errorStatus = typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
      const rejected = !error || errorStatus === 401 || errorStatus === 403;
      authResolution = rejected ? "bearer_rejected" : "auth_validation_failed";
      logAuthDiagnostic(authResolution, { supabaseErrorPresent: Boolean(error), authUserPresent: Boolean(data.user) });
    } else if (!isVerifiedSupabaseEmail(data.user)) {
      authResolution = "email_not_verified";
      logAuthDiagnostic(authResolution);
    } else {
      const verifiedAuthUserId = data.user.id;
      authUserId = verifiedAuthUserId;
      try {
        const mapping = await withRequestDatabaseScope(verifiedAuthUserId, () => getUserByVerifiedAuthId(verifiedAuthUserId, {
          email: data.user.email,
          name: typeof data.user.user_metadata?.name === "string" ? data.user.user_metadata.name : null,
          userMetadata: data.user.user_metadata ?? null,
        }));
        authResolution = mapping.status;
        if (mapping.status === "application_user_resolved") user = mapping.user;
        logAuthDiagnostic(authResolution, user ? { role: user.role } : {});
      } catch (error) {
        authResolution = getDatabaseFailureResolution(error);
        logAuthDiagnostic(authResolution, {
          databasePhase: getDatabaseErrorPhase(error) ?? "unknown",
          postgresErrorCode: getDatabaseErrorCode(error) ?? "unknown",
        });
      }
    }
  } else {
    logAuthDiagnostic(authResolution);
  }
  return { req: opts.req, res: opts.res, user, authUserId, authResolution };
}
