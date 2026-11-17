export type StorageProxyActor = {
  id: number;
  openId: string;
  role: "buyer" | "seller" | "admin" | "superadmin";
  approvalStatus: "approved" | "pending" | "suspended";
  cooperativeId: number | null;
};

export type LegacyProductImage = {
  sellerId: number;
  cooperativeId: number | null;
  status: string;
  verificationStatus: string;
  visibility: string;
  sellerApprovalStatus: string;
  imagePaths: readonly string[];
};

export function normalizeLegacyProductImagePath(key: string | undefined) {
  if (!key || key.length > 1000 || key.includes("\\") || key.includes("%") || key.includes("\0")) return null;
  const segments = key.split("/");
  if (segments.some(segment => !segment || segment === "." || segment === ".." || segment.toLowerCase() === "payment-proofs")) {
    return null;
  }
  return `/manus-storage/${segments.join("/")}`;
}

export function canAccessLegacyProductImage(
  authenticatedUserId: string | undefined,
  actor: StorageProxyActor | undefined,
  product: LegacyProductImage,
  imagePath: string,
) {
  if (!authenticatedUserId || !actor || authenticatedUserId !== actor.openId) return false;
  if (actor.role !== "superadmin" && actor.approvalStatus !== "approved") return false;
  if (!product.imagePaths.includes(imagePath)) return false;

  if (actor.role === "superadmin") return true;
  if (actor.role === "admin") {
    return actor.cooperativeId !== null && actor.cooperativeId === product.cooperativeId;
  }
  if (actor.role === "seller" && actor.id === product.sellerId) return true;

  return (actor.role === "buyer" || actor.role === "seller")
    && product.status === "published"
    && product.verificationStatus === "approved"
    && product.visibility === "visible"
    && product.sellerApprovalStatus === "approved";
}
