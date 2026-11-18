import { createHash } from "node:crypto";
import { supabaseAdmin } from "./clients";

export class RegistrationProvisioningError extends Error {
  constructor() {
    super("Registration profile provisioning failed.");
    this.name = "RegistrationProvisioningError";
  }
}

export class RegistrationCleanupError extends RegistrationProvisioningError {
  constructor() {
    super();
    this.name = "RegistrationCleanupError";
  }
}

export class RegistrationRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Too many registration requests. Please try again later.");
    this.name = "RegistrationRateLimitError";
  }
}

type RegistrationAction = "register" | "resend" | "create_cooperative" | "coop_propose" | "self_heal";
type RegistrationRateLimit = {
  count: number;
  resetAt: number;
};

const rateLimits: Record<RegistrationAction, {
  ipLimit: number;
  ipWindowMs: number;
  emailLimit: number;
  emailWindowMs: number;
}> = {
  register: {
    ipLimit: 5,
    ipWindowMs: 15 * 60 * 1000,
    emailLimit: 3,
    emailWindowMs: 60 * 60 * 1000,
  },
  resend: {
    ipLimit: 10,
    ipWindowMs: 60 * 60 * 1000,
    emailLimit: 3,
    emailWindowMs: 60 * 60 * 1000,
  },
  create_cooperative: {
    ipLimit: 8,
    ipWindowMs: 60 * 60 * 1000,
    emailLimit: 5,
    emailWindowMs: 60 * 60 * 1000,
  },
  coop_propose: {
    ipLimit: 10,
    ipWindowMs: 60 * 60 * 1000,
    emailLimit: 0,
    emailWindowMs: 60 * 60 * 1000,
  },
  self_heal: {
    ipLimit: 8,
    ipWindowMs: 60 * 60 * 1000,
    emailLimit: 3,
    emailWindowMs: 60 * 60 * 1000,
  },
};

function hashRateLimitIdentifier(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export class RegistrationRateLimiter {
  private readonly attempts = new Map<string, RegistrationRateLimit>();

  constructor(private readonly now: () => number = Date.now) {}

  consume(
    action: RegistrationAction,
    ipAddress: string | undefined,
    subject: string | { userId: number },
  ) {
    const now = this.now();
    this.attempts.forEach((attempt, key) => {
      if (attempt.resetAt <= now) this.attempts.delete(key);
    });

    const limits = rateLimits[action];
    const identifiers: Array<{ key: string; limit: number; windowMs: number }> = [
      {
        key: `${action}:ip:${hashRateLimitIdentifier(ipAddress?.trim() || "unknown")}`,
        limit: limits.ipLimit,
        windowMs: limits.ipWindowMs,
      },
    ];
    if (typeof subject === "string" && limits.emailLimit > 0) {
      identifiers.push({
        key: `${action}:email:${hashRateLimitIdentifier(subject.trim().toLowerCase())}`,
        limit: limits.emailLimit,
        windowMs: limits.emailWindowMs,
      });
    }
    if (typeof subject === "object" && Number.isInteger(subject.userId)) {
      identifiers.push({
        key: `${action}:user:${hashRateLimitIdentifier(String(subject.userId))}`,
        limit: limits.ipLimit,
        windowMs: limits.ipWindowMs,
      });
    }
    const blocked = identifiers.flatMap(identifier => {
      const attempt = this.attempts.get(identifier.key);
      return attempt && attempt.count >= identifier.limit ? [attempt] : [];
    });
    if (blocked.length) {
      const retryAfterSeconds = Math.max(1, Math.ceil((Math.max(...blocked.map(attempt => attempt.resetAt)) - now) / 1000));
      throw new RegistrationRateLimitError(retryAfterSeconds);
    }

    for (const identifier of identifiers) {
      const existing = this.attempts.get(identifier.key);
      this.attempts.set(identifier.key, existing
        ? { ...existing, count: existing.count + 1 }
        : { count: 1, resetAt: now + identifier.windowMs });
    }
  }
}

export const registrationRateLimiter = new RegistrationRateLimiter();

export function getEmailVerificationRedirectUrl(appUrl: string | undefined) {
  if (!appUrl?.trim()) throw new Error("APP_URL is required for email verification.");
  const parsed = new URL(appUrl);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if ((parsed.protocol !== "https:" && !loopback) || parsed.username || parsed.password) {
    throw new Error("APP_URL must be an HTTPS application origin.");
  }
  return new URL("/auth?verification=success", parsed.origin).toString();
}

export function isVerifiedSupabaseEmail(user: { email_confirmed_at?: string | null } | null | undefined) {
  return Boolean(user?.email_confirmed_at);
}

export function isDuplicateSignupError(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return ["email_exists", "user_already_exists"].includes(String(error.code));
}

export async function findAuthUserByEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  for (let page = 1; page <= 25; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find(user => user.email?.trim().toLowerCase() === normalized);
    if (match) return match;
    if (data.users.length < 200) break;
  }
  return null;
}

/** Cooperative Admin intent from metadata only — never elevates application role. */
export function requestedRoleFromAuthMetadata(
  metadata: Record<string, unknown> | null | undefined,
): "admin" | null {
  if (!metadata) return null;
  const raw = metadata.requestedRole ?? metadata.requested_role;
  return raw === "admin" ? "admin" : null;
}

export async function provisionAuthAccount<T>(
  authUserId: string,
  provision: () => Promise<T>,
  removeAuthUser: (authUserId: string) => Promise<void>,
): Promise<T> {
  try {
    return await provision();
  } catch (cause) {
    try {
      await removeAuthUser(authUserId);
    } catch {
      throw new RegistrationCleanupError();
    }
    const error = new RegistrationProvisioningError();
    Object.assign(error, {
      cause,
      postgresErrorCode: typeof cause === "object" && cause && "code" in cause ? String((cause as { code: unknown }).code) : undefined,
      causeMessage: cause instanceof Error ? cause.message : String(cause),
    });
    throw error;
  }
}
