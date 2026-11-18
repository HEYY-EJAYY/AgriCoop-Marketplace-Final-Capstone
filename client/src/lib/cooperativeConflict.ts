import type { CooperativeSelectValue } from "@/components/CooperativeSelect";
import type { CooperativeDuplicateMatch } from "@/components/CooperativeDuplicateNotice";
import { parseCooperativeConflictMessage } from "@shared/cooperativeConflicts";
import { normalizeCooperativeName } from "@shared/cooperativeNames";

export type CooperativeConflictUi =
  | { mode: "exact"; match: CooperativeDuplicateMatch }
  | { mode: "similar"; matches: CooperativeDuplicateMatch[] };

export function cooperativeConflictFromError(error: unknown): CooperativeConflictUi | null {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!message) return null;
  const parsed = parseCooperativeConflictMessage(message);
  if (!parsed) return null;
  if (parsed.kind === "exact") return { mode: "exact", match: parsed.match };
  return { mode: "similar", matches: parsed.matches };
}

export function confirmNormalizedNameForNewCoop(coop: CooperativeSelectValue) {
  return normalizeCooperativeName(coop.newCooperativeName.trim()).normalizedName;
}

export function appendNewCooperativeFields(
  payload: Record<string, unknown>,
  coop: CooperativeSelectValue,
) {
  if (coop.addNew && coop.newCooperativeName.trim()) {
    payload.newCooperativeName = coop.newCooperativeName.trim();
    payload.newCooperativeLocation = coop.newCooperativeLocation.trim();
    payload.newCooperativeAddress = coop.newCooperativeAddress.trim();
  } else if (coop.cooperativeId) {
    payload.cooperativeId = coop.cooperativeId;
  }
}