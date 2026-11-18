import { and, eq, isNull, sql } from "drizzle-orm";
import { cooperatives } from "../drizzle/pg-schema";
import {
  normalizeCooperativeAddress,
  normalizeCooperativeLocation,
  normalizeCooperativeName,
} from "./cooperativeNames";

export type CooperativeMatch = {
  id: number;
  name: string;
  normalizedName: string;
  address: string;
  location: string;
  normalizedLocation: string;
};

export type ResolveUserCooperativeInput = {
  cooperativeId?: number | null;
  newCooperativeName?: string | null;
  newCooperativeLocation?: string | null;
  newCooperativeAddress?: string | null;
  confirmSimilarNormalizedName?: string | null;
  /** Rate-limit / audit identity (email or openId). */
  rateLimitEmail: string;
  consumeRateLimit: () => void;
};

export type ResolveUserCooperativeResult =
  | { kind: "existing"; cooperativeId: number }
  | { kind: "created"; cooperativeId: number }
  | { kind: "exact_duplicate"; match: CooperativeMatch; message: string }
  | { kind: "similar_matches"; matches: CooperativeMatch[]; message: string }
  | { kind: "needs_confirmation"; suggestion: CooperativeMatch };

type DbLike = {
  select: (...args: any[]) => any;
  execute: (query: any) => Promise<any>;
};

function mapRow(row: {
  id: number;
  name: string;
  normalizedName: string;
  address?: string | null;
  location: string;
  normalizedLocation?: string | null;
}): CooperativeMatch {
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalizedName,
    address: row.address ?? "",
    location: row.location,
    normalizedLocation: row.normalizedLocation ?? "",
  };
}

function isSimilarName(a: string, b: string) {
  return a.includes(b) || b.includes(a) || levenshtein(a, b) <= 2;
}

/** Preview duplicate / similar names without inserting (safe before Auth createUser). */
export async function previewUserCooperativeSelection(
  db: DbLike,
  input: Pick<
    ResolveUserCooperativeInput,
    | "cooperativeId"
    | "newCooperativeName"
    | "newCooperativeLocation"
    | "newCooperativeAddress"
    | "confirmSimilarNormalizedName"
  >,
): Promise<
  | ResolveUserCooperativeResult
  | { kind: "ok_to_create"; normalizedName: string; normalizedLocation: string; address: string }
> {
  if (input.cooperativeId) {
    const [row] = await db
      .select({
        id: cooperatives.id,
        status: cooperatives.status,
        deletedAt: cooperatives.deletedAt,
      })
      .from(cooperatives)
      .where(eq(cooperatives.id, input.cooperativeId))
      .limit(1);
    if (!row || row.status !== "active" || row.deletedAt) {
      throw new Error("Select an active cooperative, or add a new one.");
    }
    return { kind: "existing", cooperativeId: row.id };
  }

  const rawName = (input.newCooperativeName ?? "").trim();
  if (!rawName) {
    throw new Error("Select a cooperative or enter a new cooperative name.");
  }
  const normalized = normalizeCooperativeName(rawName);
  const rawLocation = (input.newCooperativeLocation ?? "").trim();
  const rawAddress = (input.newCooperativeAddress ?? "").trim();
  if (!rawLocation) throw new Error("Enter a location (municipality/city and province).");
  if (!rawAddress) throw new Error("Enter a street or barangay address.");
  const location = normalizeCooperativeLocation(rawLocation);
  const address = normalizeCooperativeAddress(rawAddress);

  const activeRows = await db
    .select({
      id: cooperatives.id,
      name: cooperatives.name,
      normalizedName: cooperatives.normalizedName,
      address: cooperatives.address,
      location: cooperatives.location,
      normalizedLocation: cooperatives.normalizedLocation,
    })
    .from(cooperatives)
    .where(and(eq(cooperatives.status, "active"), isNull(cooperatives.deletedAt)))
    .limit(200);

  const exact = (activeRows as CooperativeMatch[]).find(
    row =>
      row.normalizedName === normalized.normalizedName
      && (row.normalizedLocation || normalizeCooperativeLocation(row.location).normalizedLocation)
        === location.normalizedLocation,
  );

  if (exact) {
    return {
      kind: "exact_duplicate",
      match: mapRow(exact),
      message: "This cooperative already exists.",
    };
  }

  const similar = (activeRows as CooperativeMatch[]).filter(row => {
    if (row.normalizedName === normalized.normalizedName) return true;
    return isSimilarName(row.normalizedName, normalized.normalizedName);
  });

  if (similar.length) {
    const confirmedNew = input.confirmSimilarNormalizedName === normalized.normalizedName;
    const confirmedExisting = similar.find(
      row => input.confirmSimilarNormalizedName === row.normalizedName,
    );
    if (confirmedExisting) {
      return { kind: "existing", cooperativeId: confirmedExisting.id };
    }
    if (!confirmedNew) {
      return {
        kind: "similar_matches",
        matches: similar.map(mapRow),
        message: "A similar cooperative already exists. Is this the coop?",
      };
    }
  }

  return {
    kind: "ok_to_create",
    normalizedName: normalized.normalizedName,
    normalizedLocation: location.normalizedLocation,
    address,
  };
}

/**
 * Resolve cooperative for registration / admin create-account.
 * New coops are created via SECURITY DEFINER (no direct authenticated INSERT).
 */
export async function resolveUserCooperativeSelection(
  db: DbLike,
  input: ResolveUserCooperativeInput,
): Promise<ResolveUserCooperativeResult | { kind: "ok_to_create"; normalizedName: string }> {
  const preview = await previewUserCooperativeSelection(db, input);
  if (
    preview.kind === "needs_confirmation"
    || preview.kind === "existing"
    || preview.kind === "exact_duplicate"
    || preview.kind === "similar_matches"
  ) {
    return preview;
  }

  const rawName = (input.newCooperativeName ?? "").trim();
  const rawLocation = (input.newCooperativeLocation ?? "").trim();
  const rawAddress = (input.newCooperativeAddress ?? "").trim();
  if (!rawLocation) throw new Error("Enter a location (municipality/city and province).");
  if (!rawAddress) throw new Error("Enter a street or barangay address.");
  const normalized = normalizeCooperativeName(rawName);
  const location = normalizeCooperativeLocation(rawLocation);
  const address = normalizeCooperativeAddress(rawAddress);
  input.consumeRateLimit();
  try {
    const created = await db.execute(sql`
      select agricoop_app.create_user_cooperative(
        ${normalized.displayName},
        ${normalized.normalizedName},
        ${location.displayLocation},
        ${null},
        ${address},
        ${location.normalizedLocation}
      ) as id
    `);
    const cooperativeId = Number(created?.[0]?.id ?? created?.rows?.[0]?.id);
    if (!Number.isFinite(cooperativeId) || cooperativeId <= 0) {
      throw new Error("Could not create the cooperative.");
    }
    return { kind: "created", cooperativeId };
  } catch (error) {
    const code = String((error as { code?: string })?.code ?? "");
    const message = String((error as Error)?.message ?? error);
    if (code === "23505" || /unique|duplicate/i.test(message)) {
      const [match] = await db
        .select({
          id: cooperatives.id,
          name: cooperatives.name,
          normalizedName: cooperatives.normalizedName,
          address: cooperatives.address,
          location: cooperatives.location,
          normalizedLocation: cooperatives.normalizedLocation,
        })
        .from(cooperatives)
        .where(and(
          eq(cooperatives.normalizedName, normalized.normalizedName),
          eq(cooperatives.normalizedLocation, location.normalizedLocation),
          isNull(cooperatives.deletedAt),
        ))
        .limit(1);
      if (match) {
        return {
          kind: "exact_duplicate",
          match: mapRow(match),
          message: "This cooperative already exists.",
        };
      }
    }
    throw error;
  }
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

export { isSimilarName };
