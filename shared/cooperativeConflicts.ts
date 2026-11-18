export type CooperativeConflictMatch = {
  id: number;
  name: string;
  normalizedName: string;
  address: string;
  location: string;
};

const EXACT_PREFIX = "This cooperative already exists.|AGRI_COOP_EXACT|";
const SIMILAR_PREFIX = "A similar cooperative already exists.|AGRI_COOP_SIMILAR|";

export function formatExactDuplicateConflict(match: CooperativeConflictMatch) {
  return `${EXACT_PREFIX}${JSON.stringify(match)}`;
}

export function formatSimilarMatchesConflict(matches: CooperativeConflictMatch[]) {
  return `${SIMILAR_PREFIX}${JSON.stringify(matches)}`;
}

export function parseCooperativeConflictMessage(message: string):
  | { kind: "exact"; match: CooperativeConflictMatch }
  | { kind: "similar"; matches: CooperativeConflictMatch[] }
  | null {
  if (message.startsWith(EXACT_PREFIX)) {
    try {
      const match = JSON.parse(message.slice(EXACT_PREFIX.length)) as CooperativeConflictMatch;
      if (match?.id && match?.name) return { kind: "exact", match };
    } catch {
      return null;
    }
  }
  if (message.startsWith(SIMILAR_PREFIX)) {
    try {
      const matches = JSON.parse(message.slice(SIMILAR_PREFIX.length)) as CooperativeConflictMatch[];
      if (Array.isArray(matches) && matches.length) return { kind: "similar", matches };
    } catch {
      return null;
    }
  }
  // Legacy Did you mean "Name"?
  const legacy = /Did you mean "([^"]+)"/i.exec(message);
  if (legacy?.[1]) {
    return {
      kind: "similar",
      matches: [{
        id: 0,
        name: legacy[1],
        normalizedName: legacy[1].toLowerCase().replace(/[^a-z0-9]+/gi, ""),
        address: "",
        location: "",
      }],
    };
  }
  return null;
}
