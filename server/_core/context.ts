import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { supabase } from "../clients.js";
import {
  getSupabaseAppUser,
  type SupabaseAppUser,
} from "../supabaseProfiles.js";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: SupabaseAppUser | null;
  supabaseUser: SupabaseAppUser | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  const bearer = opts.req.headers.authorization
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  if (!bearer)
    return { req: opts.req, res: opts.res, user: null, supabaseUser: null };

  try {
    const { data, error } = await supabase.auth.getUser(bearer);
    if (error || !data.user) {
      return { req: opts.req, res: opts.res, user: null, supabaseUser: null };
    }

    const appUser = await getSupabaseAppUser(
      data.user.id,
      bearer,
      data.user.email ?? undefined
    );
    if (!appUser) {
      // A valid Auth token without an application profile is authenticated by
      // Supabase but has no AgriCoop account. Never auto-create or infer one.
      return { req: opts.req, res: opts.res, user: null, supabaseUser: null };
    }

    return {
      req: opts.req,
      res: opts.res,
      user: appUser,
      supabaseUser: appUser,
    };
  } catch {
    // Authentication and profile failures are treated as an anonymous request
    // so auth.me remains a deliberate null response instead of an unexplained
    // HTTP 500. Protected procedures still reject the request.
    return { req: opts.req, res: opts.res, user: null, supabaseUser: null };
  }
}
