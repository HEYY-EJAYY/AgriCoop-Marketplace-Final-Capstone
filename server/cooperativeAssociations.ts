type AssociationRequestActor = {
  role: string;
  approvalStatus: string;
  cooperativeId: number | null;
};

export function canRequestCooperativeAssociation(actor: AssociationRequestActor) {
  return actor.role === "seller"
    && actor.approvalStatus !== "suspended";
}

export function cooperativeAssociationRequestBlock(
  actor: AssociationRequestActor,
  targetCooperativeId?: number,
  hasPendingRequest = false,
) {
  if (actor.role !== "seller") {
    return {
      code: "FORBIDDEN" as const,
      message: "Only Sellers can request a cooperative association.",
    };
  }
  if (actor.approvalStatus === "suspended") {
    return {
      code: "FORBIDDEN" as const,
      message: "Suspended Sellers cannot request a cooperative change. Contact an Admin for help.",
    };
  }
  if (targetCooperativeId != null && targetCooperativeId === actor.cooperativeId) {
    return {
      code: "BAD_REQUEST" as const,
      message: "You are already assigned to this cooperative. Choose a different active cooperative.",
    };
  }
  if (hasPendingRequest) {
    return {
      code: "CONFLICT" as const,
      message: "You already have a pending cooperative request. Wait for a decision before submitting another.",
    };
  }
  return null;
}

export function canReviewCooperativeAssociation(
  actor: Pick<AssociationRequestActor, "role" | "cooperativeId">,
  requestCooperativeId: number,
) {
  return actor.role === "superadmin"
    || (actor.role === "admin"
      && actor.cooperativeId !== null
      && actor.cooperativeId === requestCooperativeId);
}
