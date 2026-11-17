type AssociationRequestActor = {
  role: string;
  approvalStatus: string;
  cooperativeId: number | null;
};

export function canRequestCooperativeAssociation(actor: AssociationRequestActor) {
  return actor.role === "seller"
    && actor.approvalStatus !== "suspended"
    && actor.cooperativeId === null;
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
