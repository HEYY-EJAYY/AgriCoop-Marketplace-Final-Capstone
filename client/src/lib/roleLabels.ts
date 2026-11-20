export type AppRole = "buyer" | "seller" | "admin" | "superadmin";

/** Display labels used in the header profile chip and menus. */
export function roleDisplayLabel(role: string | null | undefined): string {
  switch (role) {
    case "buyer":
      return "Buyer";
    case "seller":
      return "Seller";
    case "admin":
      return "OfficerAdmin";
    case "superadmin":
      return "SuperAdmin";
    default:
      return "Member";
  }
}

export function formatUserRoleChip(name: string | null | undefined, role: string | null | undefined): string {
  const displayName = (name ?? "").trim() || "Member";
  return `${displayName} | ${roleDisplayLabel(role)}`;
}
