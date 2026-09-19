import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { supabaseAdmin } from "../clients";
import { getUserByOpenId, upsertUser } from "../db";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  const bearer = opts.req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (bearer) {
    const { data } = await supabaseAdmin.auth.getUser(bearer);
    if (data.user) {
      const metadata = data.user.user_metadata ?? {};
      await upsertUser({ openId: data.user.id, email: data.user.email, name: metadata.name ?? data.user.email, loginMethod: "supabase" });
      user = (await getUserByOpenId(data.user.id)) ?? null;
    }
  }
  if (user) return { req: opts.req, res: opts.res, user };

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
