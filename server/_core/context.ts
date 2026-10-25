import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema.js";
import { supabaseAdmin } from "../clients.js";
import { getUserByOpenId, upsertUser } from "../db.js";
import { getSupabaseAppUser, type SupabaseAppUser } from "../supabaseProfiles.js";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  supabaseUser: SupabaseAppUser | null;
};

export async function createContext(opts: CreateExpressContextOptions): Promise<TrpcContext> {
  let user: User | null = null;
  let supabaseUser: SupabaseAppUser | null = null;
  const bearer = opts.req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (bearer) {
    const { data } = await supabaseAdmin.auth.getUser(bearer);
    if (data.user) {
      const metadata = data.user.user_metadata ?? {};
      try {
        supabaseUser = await getSupabaseAppUser(data.user.id);
      } catch {
        // A profile lookup failure must not fall back to a legacy role or
        // grant access based on incomplete identity data.
        return { req: opts.req, res: opts.res, user: null, supabaseUser: null };
      }
      if (!supabaseUser) {
        // A valid Auth token without an application profile is not an
        // operational account. Do not auto-create a legacy numeric profile.
        return { req: opts.req, res: opts.res, user: null, supabaseUser: null };
      }
      const mappedRole = supabaseUser?.role;
      const mappedApprovalStatus = supabaseUser?.approvalStatus ?? "pending";
      const existing = await getUserByOpenId(data.user.id);
      if (existing) {
        await upsertUser({ openId: data.user.id, email: data.user.email, name: metadata.name ?? data.user.email, loginMethod: "supabase" });
        const refreshed = await getUserByOpenId(data.user.id);
        user = refreshed
          ? mappedRole
            ? { ...refreshed, role: mappedRole, approvalStatus: mappedApprovalStatus }
            : refreshed
          : null;
      } else {
        // Supabase user metadata is untrusted input. New profiles always start
        // as ordinary buyers unless the real profiles -> roles relationship
        // provides a known, server-side role.
        await upsertUser({
          openId: data.user.id,
          email: supabaseUser?.email ?? data.user.email,
          name: supabaseUser?.name ?? metadata.name ?? data.user.email,
          loginMethod: "supabase",
          role: mappedRole ?? "buyer",
          approvalStatus: mappedRole ? mappedApprovalStatus : "approved",
        });
        user = (await getUserByOpenId(data.user.id)) ?? null;
      }
    }
  }
  return { req: opts.req, res: opts.res, user, supabaseUser };
}
