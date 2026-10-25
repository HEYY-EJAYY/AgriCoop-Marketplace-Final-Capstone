import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema.js";
import { supabaseAdmin } from "../clients.js";
import { getUserByOpenId, upsertUser } from "../db.js";

export type TrpcContext = { req: CreateExpressContextOptions["req"]; res: CreateExpressContextOptions["res"]; user: User | null };

export async function createContext(opts: CreateExpressContextOptions): Promise<TrpcContext> {
  let user: User | null = null;
  const bearer = opts.req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (bearer) {
    const { data, error } = await supabaseAdmin.auth.getUser(bearer);
    if (error || !data.user) {
      console.warn("[auth.context] Supabase Auth token verification failed.");
      return { req: opts.req, res: opts.res, user };
    }
    if (data.user) {
      const existing = await getUserByOpenId(data.user.id);
      if (existing) {
        const metadata = data.user.user_metadata ?? {};
        await upsertUser({
          openId: data.user.id,
          email: data.user.email,
          name: metadata.name ?? existing.name ?? data.user.email,
          loginMethod: "supabase",
        });
        user = (await getUserByOpenId(data.user.id)) ?? existing;
      } else {
        console.warn("[auth.context] No marketplace profile matches the authenticated user.");
      }
    }
  }
  return { req: opts.req, res: opts.res, user };
}
