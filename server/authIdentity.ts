import type { User } from "../drizzle/pg-schema";

const canonicalRoles: Record<string, User["role"]> = {
  buyer: "buyer",
  seller: "seller",
  coop_officer: "admin",
  system_admin: "superadmin",
};

/** Operational application role is the source of truth; profiles.role_id must mirror it. */
export function applicationRoleToPublicRoleName(role: User["role"]): keyof typeof canonicalRoles {
  switch (role) {
    case "buyer":
      return "buyer";
    case "seller":
      return "seller";
    case "admin":
      return "coop_officer";
    case "superadmin":
      return "system_admin";
  }
}

export function publicRoleNameToApplicationRole(roleName: string | null | undefined): User["role"] | null {
  if (!roleName) return null;
  return canonicalRoles[roleName] ?? null;
}

export type AuthenticatedApplicationUser = Pick<
  User,
  | "id"
  | "openId"
  | "name"
  | "email"
  | "role"
  | "approvalStatus"
  | "verificationStatus"
  | "cooperativeId"
  | "contactNumber"
  | "birthdate"
  | "phone"
  | "address"
>;

export type PublicRegistrationIdentity = {
  publicRoleName: "buyer" | "seller";
  applicationRole: "buyer" | "seller";
  approvalStatus: "approved" | "pending";
};

export function resolvePublicRegistrationIdentity(
  roleName: string | null | undefined,
): PublicRegistrationIdentity | null {
  if (roleName === "buyer") {
    return { publicRoleName: roleName, applicationRole: "buyer", approvalStatus: "approved" };
  }
  if (roleName === "seller") {
    return { publicRoleName: roleName, applicationRole: "seller", approvalStatus: "pending" };
  }
  return null;
}

export function matchesPublicRegistrationIdentity(
  user: Pick<User, "role">,
  identity: PublicRegistrationIdentity,
): boolean {
  return user.role === identity.applicationRole;
}

type AppIdentityRecord = Pick<User, "openId" | "role">;

export type AuthIdentityResolution<TUser extends AppIdentityRecord = User> =
  | { status: "application_user_resolved"; user: TUser }
  | { status: "application_user_missing"; user: null }
  | { status: "application_user_mapping_unavailable"; user: null }
  | { status: "application_profile_missing"; user: null }
  | { status: "application_role_mapping_unavailable"; user: null }
  | { status: "application_role_mapping_conflict"; user: null }
  | { status: "application_identity_conflict"; user: null };

export function resolveAuthIdentityMapping<TUser extends AppIdentityRecord>(
  authUserId: string,
  applicationUsers: TUser[],
  profileRoles: Array<{ roleName: string | null }>,
): AuthIdentityResolution<TUser> {
  const matchingUsers = applicationUsers.filter(user => user.openId === authUserId);
  if (applicationUsers.length > 1 || profileRoles.length > 1) {
    return { status: "application_identity_conflict", user: null };
  }
  if (matchingUsers.length === 0 && profileRoles.length === 0) {
    return { status: "application_user_missing", user: null };
  }
  if (matchingUsers.length === 0) {
    return { status: "application_user_mapping_unavailable", user: null };
  }
  const [profileRole] = profileRoles;
  if (!profileRole) {
    return { status: "application_profile_missing", user: null };
  }
  if (!profileRole.roleName || !canonicalRoles[profileRole.roleName]) {
    return { status: "application_role_mapping_unavailable", user: null };
  }
  const [user] = matchingUsers;
  if (canonicalRoles[profileRole.roleName] !== user.role) {
    return { status: "application_role_mapping_conflict", user: null };
  }
  return { status: "application_user_resolved", user };
}
