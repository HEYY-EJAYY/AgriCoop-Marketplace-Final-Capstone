import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "../../shared/const.js";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { APP_ROLES, requireOperationalRole } from "../authz.js";
import type { TrpcContext } from "./context.js";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  if (
    ![
      "auth.me",
      "auth.logout",
      "account.myProfile",
      "account.updateProfile",
    ].includes(opts.path)
  ) {
    requireOperationalRole(ctx.user, APP_ROLES);
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

const requireSupabaseUser = t.middleware(async opts => {
  const { ctx, next } = opts;
  if (!ctx.supabaseUser) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  requireOperationalRole(ctx.supabaseUser, APP_ROLES);
  return next({
    ctx: {
      ...ctx,
      supabaseUser: ctx.supabaseUser,
    },
  });
});

export const supabaseProtectedProcedure = t.procedure.use(requireSupabaseUser);

export const adminProcedure = t.procedure.use(requireUser).use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (
      !ctx.user ||
      (ctx.user.role !== "admin" && ctx.user.role !== "superadmin")
    ) {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  })
);
