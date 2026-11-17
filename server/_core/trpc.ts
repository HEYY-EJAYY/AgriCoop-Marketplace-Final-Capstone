import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { APP_ROLES, requireOperationalRole } from "../authz";
import { withRequestDatabaseScope } from "../db";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;

const requestDatabaseScope = t.middleware(async ({ ctx, next, path }) => {
  if (["auth.me", "auth.status", "auth.logout"].includes(path)) return next();
  return withRequestDatabaseScope(ctx.authUserId, async () => {
    const result = await next();
    if (!result.ok) throw result.error;
    return result;
  });
});

export const publicProcedure = t.procedure.use(requestDatabaseScope);

/** Paths allowed for signed-in users who are not yet approvalStatus=approved (seller onboarding, light profile). */
const PRE_APPROVAL_PATHS = new Set([
  "auth.me",
  "auth.logout",
  "account.myProfile",
  "account.updateProfile",
  "cooperativeAssociations.activeCooperatives",
  "cooperativeAssociations.mine",
  "cooperativeAssociations.request",
  "support.createTicket",
  "support.myTickets",
  "notifications.mine",
  "notifications.markRead",
]);

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  if (!PRE_APPROVAL_PATHS.has(opts.path)) {
    requireOperationalRole(ctx.user, APP_ROLES);
  } else if (ctx.user.approvalStatus === "suspended") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This account is suspended. Contact cooperative support for help.",
    });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser).use(requestDatabaseScope);

export const adminProcedure = t.procedure.use(requireUser).use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
).use(requestDatabaseScope);
