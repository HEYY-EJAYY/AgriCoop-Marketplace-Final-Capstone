import { and, eq, ne, sql } from "drizzle-orm";
import { cooperatives } from "../drizzle/pg-schema";
import { normalizeCooperativeName } from "./cooperativeNames";

export type CooperativeSuggestion = {
  id: number;
  name: string;
  normalizedName: string;
  location: string;
};

export type ResolveUserCooperativeInput = {
  cooperativeId?: number | null;
  newCooperativeName?: string | null;
  newCooperativeLocation?: string | null;
  confirmSimilarNormalizedName?: string | null;
  /** Rate-limit / audit identity (email or openId). */
  rateLimitEmail: string;
  consumeRateLimit: () => void;
};

export type ResolveUserCooperativeResult =
  | { kind: "existing"; cooperativeId: number }
  | { kind: "created"; cooperativeId: number }
  | { kind: "needs_confirmation"; suggestion: CooperativeSuggestion };

type DbLike = {
  select: (...args: any[]) => any;
  execute: (query: any) => Promise<any>;
};

/** Preview duplicate / similar names without inserting (safe before Auth createUser). */
export async function previewUserCooperativeSelection(
  db: DbLike,
  input: Pick<
    ResolveUserCooperativeInput,
    "cooperativeId" | "newCooperativeName" | "confirmSimilarNormalizedName"
  >,
): Promise<ResolveUserCooperativeResult | { kind: "ok_to_create"; normalizedName: string }> {
  if (input.cooperativeId) {
    const [row] = await db
      .select({ id: cooperatives.id, status: cooperatives.status })
      .from(cooperatives)
      .where(eq(cooperatives.id, input.cooperativeId))
      .limit(1);
    if (!row || row.status !== "active") {
      throw new Error("Select an active cooperative, or add a new one.");
    }
    return { kind: "existing", cooperativeId: row.id };
  }

  const rawName = (input.newCooperativeName ?? "").trim();
  if (!rawName) {
    throw new Error("Select a cooperative or enter a new cooperative name.");
  }
  const normalized = normalizeCooperativeName(rawName);

  const [exact] = await db
    .select({
      id: cooperatives.id,
      name: cooperatives.name,
      normalizedName: cooperatives.normalizedName,
      location: cooperatives.location,
    })
    .from(cooperatives)
    .where(eq(cooperatives.normalizedName, normalized.normalizedName))
    .limit(1);

  if (exact) {
    if (input.confirmSimilarNormalizedName === exact.normalizedName) {
      return { kind: "existing", cooperativeId: exact.id };
    }
    return {
      kind: "needs_confirmation",
      suggestion: {
        id: exact.id,
        name: exact.name,
        normalizedName: exact.normalizedName,
        location: exact.location,
      },
    };
  }

  const candidates = await db
    .select({
      id: cooperatives.id,
      name: cooperatives.name,
      normalizedName: cooperatives.normalizedName,
      location: cooperatives.location,
    })
    .from(cooperatives)
    .where(and(eq(cooperatives.status, "active"), ne(cooperatives.normalizedName, normalized.normalizedName)))
    .limit(40);

  const suggestion = candidates.find((row: CooperativeSuggestion) => {
    const a = row.normalizedName;
    const b = normalized.normalizedName;
    return a.includes(b) || b.includes(a) || levenshtein(a, b) <= 2;
  });

  if (
    suggestion
    && input.confirmSimilarNormalizedName !== suggestion.normalizedName
    && input.confirmSimilarNormalizedName !== normalized.normalizedName
  ) {
    return {
      kind: "needs_confirmation",
      suggestion: {
        id: suggestion.id,
        name: suggestion.name,
        normalizedName: suggestion.normalizedName,
        location: suggestion.location,
      },
    };
  }

  if (suggestion && input.confirmSimilarNormalizedName === suggestion.normalizedName) {
    return { kind: "existing", cooperativeId: suggestion.id };
  }

  return { kind: "ok_to_create", normalizedName: normalized.normalizedName };
}

/**
 * Resolve cooperative for registration / admin create-account.
 * New coops are created via SECURITY DEFINER (no direct authenticated INSERT).
 */
export async function resolveUserCooperativeSelection(
  db: DbLike,
  input: ResolveUserCooperativeInput,
): Promise<Exclude<ResolveUserCooperativeResult, { kind: "needs_confirmation" }> | ResolveUserCooperativeResult> {
  const preview = await previewUserCooperativeSelection(db, input);
  if (preview.kind === "needs_confirmation" || preview.kind === "existing") {
    return preview;
  }

  const rawName = (input.newCooperativeName ?? "").trim();
  const rawLocation = (input.newCooperativeLocation ?? "").trim() || "Philippines";
  const normalized = normalizeCooperativeName(rawName);
  input.consumeRateLimit();
  const created = await db.execute(sql`
    select agricoop_app.create_user_cooperative(
      ${normalized.displayName},
      ${normalized.normalizedName},
      ${rawLocation},
      ${null}
    ) as id
  `);
  const cooperativeId = Number(created?.[0]?.id ?? created?.rows?.[0]?.id);
  if (!Number.isFinite(cooperativeId) || cooperativeId <= 0) {
    throw new Error("Could not create the cooperative.");
  }
  return { kind: "created", cooperativeId };
}

function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cur = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = cur;
    }
  }
  return row[b.length]!;
}
