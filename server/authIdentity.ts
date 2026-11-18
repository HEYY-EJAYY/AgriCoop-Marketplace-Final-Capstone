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
  | "requestedRole"
  | "approvalStatus"
  | "verificationStatus"
  | "cooperativeId"
  | "contactNumber"
  | "birthdate"
  | "phone"
  | "address"
  | "profileImageUrl"
>;

export type RegistrationIntent = "buyer" | "seller" | "cooperative_admin";

export type ResolvedRegistrationIntent = {
  applicationRole: User["role"];
  approvalStatus: User["approvalStatus"];
  requestedRole?: User["role"];
  /** Canonical public.roles.role_name used for profiles.role_id — never admin at signup. */
  publicRoleNameForProfile: "buyer" | "seller";
};

export function resolveRegistrationIntent(intent: RegistrationIntent): ResolvedRegistrationIntent {
  switch (intent) {
    case "buyer":
      return {
        applicationRole: "buyer",
        approvalStatus: "approved",
        publicRoleNameForProfile: "buyer",
      };
    case "seller":
      return {
        applicationRole: "seller",
        approvalStatus: "pending",
        publicRoleNameForProfile: "seller",
      };
    case "cooperative_admin":
      return {
        applicationRole: "buyer",
        approvalStatus: "approved",
        requestedRole: "admin",
        publicRoleNameForProfile: "buyer",
      };
  }
}

export type PublicRegistrationIdentity = {
  /** Canonical public.roles.role_name used for profiles.role_id */
  publicRoleName: "buyer" | "seller";
  applicationRole: "buyer" | "seller";
  approvalStatus: "approved" | "pending";
  /** UI registration choice; coop_admin never grants Admin until SuperAdmin approval. */
  registrationChoice: "buyer" | "seller" | "coop_admin";
};

export function resolvePublicRegistrationIdentity(
  roleName: string | null | undefined,
): PublicRegistrationIdentity | null {
  if (roleName === "buyer") {
    return {
      publicRoleName: "buyer",
      applicationRole: "buyer",
      approvalStatus: "approved",
      registrationChoice: "buyer",
    };
  }
  if (roleName === "seller") {
    return {
      publicRoleName: "seller",
      applicationRole: "seller",
      approvalStatus: "pending",
      registrationChoice: "seller",
    };
  }
  // Cooperative Admin signup: create Buyer access only; Officer Admin applied separately.
  if (roleName === "coop_admin") {
    return {
      publicRoleName: "buyer",
      applicationRole: "buyer",
      approvalStatus: "approved",
      registrationChoice: "coop_admin",
    };
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
