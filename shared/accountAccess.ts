export type AccountAccessRestriction =
  | "pending"
  | "suspended"
  | "cooperative_assignment_required";

type AccountAccessState = {
  role: "buyer" | "seller" | "admin" | "superadmin";
  approvalStatus: "approved" | "pending" | "suspended";
  cooperativeId: number | null;
};

export function getAccountAccessRestriction(
  account: AccountAccessState,
): AccountAccessRestriction | null {
  if (account.role === "superadmin") return null;
  if (account.approvalStatus === "suspended") return "suspended";
  if (account.approvalStatus === "pending") return "pending";
  if (account.role === "admin" && account.cooperativeId === null) {
    return "cooperative_assignment_required";
  }
  return null;
}
