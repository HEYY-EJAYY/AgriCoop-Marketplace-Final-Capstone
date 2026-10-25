import { supabaseAdmin } from "./clients.js";

export const SUPABASE_ROLE_TO_APP_ROLE = {
  buyer: "buyer",
  seller: "seller",
  coop_officer: "admin",
  system_admin: "superadmin",
} as const;

export type SupabaseRoleName = keyof typeof SUPABASE_ROLE_TO_APP_ROLE;
export type AppRole = (typeof SUPABASE_ROLE_TO_APP_ROLE)[SupabaseRoleName];

export type SupabaseAppUser = {
  id: string;
  name: string | null;
  email: string | null;
  role: AppRole;
  approvalStatus: "approved" | "pending" | "suspended";
  verificationStatus: "unverified";
  cooperativeId: string | null;
  cooperativeName: string | null;
  contactNumber: string | null;
  address: string | null;
};

export type SupabaseProfile = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role_id: number | null;
  cooperative_id: string | null;
  account_status: string | null;
  role: { role_name: string } | null;
};

export function mapSupabaseRole(roleName: string | null | undefined): AppRole | null {
  if (!roleName) return null;
  return SUPABASE_ROLE_TO_APP_ROLE[roleName as SupabaseRoleName] ?? null;
}

export function mapSupabaseAccountStatus(status: string | null | undefined): "approved" | "pending" | "suspended" {
  switch (status?.trim().toLowerCase()) {
    case "approved":
    case "active":
      return "approved";
    case "suspended":
    case "disabled":
      return "suspended";
    default:
      return "pending";
  }
}

export async function getSupabaseProfile(authUserId: string): Promise<SupabaseProfile | null> {
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("user_id,full_name,email,role_id,cooperative_id,account_status")
    .eq("user_id", authUserId)
    .maybeSingle();

  if (profileError) {
    throw new Error("Unable to resolve the authenticated Supabase profile.");
  }
  if (!profile) return null;

  let role: SupabaseProfile["role"] = null;
  if (profile.role_id !== null) {
    const { data: roleRow, error: roleError } = await supabaseAdmin
      .from("roles")
      .select("role_name")
      .eq("role_id", profile.role_id)
      .maybeSingle();
    if (roleError) throw new Error("Unable to resolve the authenticated Supabase role.");
    role = roleRow ? { role_name: roleRow.role_name } : null;
  }

  return { ...(profile as Omit<SupabaseProfile, "role">), role };
}

export async function getSupabaseAppUser(authUserId: string): Promise<SupabaseAppUser | null> {
  const profile = await getSupabaseProfile(authUserId);
  if (!profile) return null;

  const mappedRole = mapSupabaseRole(profile.role?.role_name);
  const approvalStatus = mapSupabaseAccountStatus(profile.account_status);
  let cooperativeName: string | null = null;
  if (profile.cooperative_id) {
    const { data, error } = await supabaseAdmin
      .from("cooperatives")
      .select("name")
      .eq("cooperative_id", profile.cooperative_id)
      .maybeSingle();
    if (error) throw new Error("Unable to resolve the authenticated cooperative.");
    cooperativeName = data?.name ?? null;
  }

  return {
    id: profile.user_id,
    name: profile.full_name,
    email: profile.email,
    // An unknown database role never receives an operational privilege.
    role: mappedRole ?? "buyer",
    approvalStatus: mappedRole ? approvalStatus : "pending",
    verificationStatus: "unverified",
    cooperativeId: profile.cooperative_id,
    cooperativeName,
    contactNumber: null,
    address: null,
  };
}
