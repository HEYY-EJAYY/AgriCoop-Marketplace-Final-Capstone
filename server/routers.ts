import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies.js";
import {
  publicProcedure,
  protectedProcedure,
  router,
  supabaseProtectedProcedure,
} from "./_core/trpc.js";
import { APP_ROLES, requireOperationalRole, type AppRole } from "./authz.js";
import { supabaseAdmin } from "./clients.js";
import {
  createSupabaseProfile,
  findOrCreateSupabaseCooperative,
  findSupabaseCooperative,
  getSupabaseMarketplaceProduct,
  getSupabaseRoleId,
  listSupabaseCooperatives,
  listSupabaseMarketplace,
  listSupabaseMarketplaceCategories,
} from "./supabaseData.js";
import {
  archiveSupabaseProduct,
  createSupabaseOrder,
  createSupabaseProduct,
  createSupabaseQuotation,
  decideSupabaseQuotation,
  listSupabaseBuyerOrders,
  listSupabaseBuyerQuotations,
  listSupabaseSellerProducts,
  SUPABASE_PRODUCT_ACTIVE_STATUS,
  SUPABASE_PRODUCT_ARCHIVED_STATUS,
  updateSupabaseProduct,
} from "./supabaseCommerce.js";
import {
  getSupabaseAdminOverview,
  getSupabaseOfficerOverview,
  reviewSupabaseProduct,
  reviewSupabaseQuotation,
  updateSupabaseMemberStatus,
  updateSupabaseOfficerOrder,
  updateSupabaseProfileAsAdmin,
} from "./supabaseOperations.js";
import { normalizeCooperativeName } from "./cooperativeNames.js";
import { systemRouter } from "./_core/systemRouter.js";

const registrationRoleSchema = z.enum(["buyer", "seller", "admin"]);
const accountStatusSchema = z.enum(["approved", "pending", "suspended"]);

export const accountProfileInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function requireRole(
  ctx: { user: Parameters<typeof requireOperationalRole>[0] },
  allowed: readonly AppRole[]
) {
  return requireOperationalRole(ctx.user, allowed);
}

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query(({ ctx }) => ctx.user),

    register: publicProcedure
      .input(
        z.object({
          email: z.string().email(),
          password: z.string().min(6).max(128),
          name: z.string().trim().min(2).max(120),
          role: registrationRoleSchema,
          sellerType: z.enum(["individual", "cooperative"]).optional(),
          cooperativeId: z.string().uuid().optional(),
          cooperativeName: z.string().max(180).optional(),
        })
      )
      .mutation(async ({ input }) => {
        try {
          // Account creation intentionally requires the server-only key. The
          // browser must never receive permission to create Auth users.
          const { serviceRoleKey } = (
            await import("./supabaseConfig.js")
          ).readSupabaseConfig(process.env);
          if (!serviceRoleKey)
            throw new Error(
              "SUPABASE_SERVICE_ROLE_KEY is required for registration."
            );
        } catch (error) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: errorMessage(
              error,
              "Supabase server configuration is incomplete."
            ),
          });
        }

        let cooperativeId: string | null = null;
        let cooperativeName: string | null = null;
        if (input.role === "seller") {
          if (!input.sellerType) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Choose whether you are an individual seller or a cooperative member.",
            });
          }
          if (input.sellerType === "cooperative") {
            if (input.cooperativeId) {
              const existing = await findSupabaseCooperative(
                input.cooperativeId
              );
              if (!existing)
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: "Choose an active cooperative from the list.",
                });
              cooperativeId = existing.cooperative_id;
              cooperativeName = existing.name;
            } else if (input.cooperativeName) {
              let normalized: ReturnType<typeof normalizeCooperativeName>;
              try {
                normalized = normalizeCooperativeName(input.cooperativeName);
              } catch (error) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: errorMessage(
                    error,
                    "Enter a valid cooperative name."
                  ),
                });
              }
              const created = await findOrCreateSupabaseCooperative(
                normalized.displayName
              );
              cooperativeId = created.cooperative_id;
              cooperativeName = created.name;
            } else {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message:
                  "Choose an existing cooperative or enter a new cooperative name.",
              });
            }
          }
        }

        const roleName = input.role === "admin" ? "coop_officer" : input.role;
        const roleId = await getSupabaseRoleId(roleName);
        const { data, error } = await supabaseAdmin.auth.admin.createUser({
          email: input.email,
          password: input.password,
          email_confirm: true,
          user_metadata: { name: input.name },
        });
        if (error || !data.user)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error?.message ?? "Unable to create the account.",
          });

        // Buyers and individual sellers can operate immediately. Cooperative
        // sellers and cooperative officers remain pending until the existing
        // approval workflow assigns/approves them.
        const accountStatus =
          input.role === "buyer" ||
          (input.role === "seller" && input.sellerType === "individual")
            ? "approved"
            : "pending";
        try {
          await createSupabaseProfile({
            userId: data.user.id,
            fullName: input.name,
            email: input.email,
            roleId,
            cooperativeId,
            accountStatus,
          });
        } catch {
          await supabaseAdmin.auth.admin.deleteUser(data.user.id);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "The account could not be initialized safely.",
          });
        }
        return {
          success: true,
          cooperativeName,
          joinedExistingCooperative: null,
        };
      }),

    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      ctx.res.setHeader("Cache-Control", "no-store");
      return { success: true } as const;
    }),
  }),

  account: router({
    myProfile: protectedProcedure.query(({ ctx }) => ctx.user),
    updateProfile: protectedProcedure
      .input(accountProfileInputSchema)
      .mutation(async ({ ctx, input }) => {
        const user = requireOperationalRole(ctx.user, APP_ROLES);
        if (!input.name) return { success: true } as const;
        const updated = await supabaseAdmin
          .from("profiles")
          .update({ full_name: input.name })
          .eq("user_id", user.id)
          .select("user_id")
          .maybeSingle();
        if (updated.error)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Your profile could not be updated.",
          });
        if (!updated.data)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Your AgriCoop profile was not found.",
          });
        return { success: true } as const;
      }),
  }),

  cooperatives: router({
    list: publicProcedure.query(async () => {
      const rows = await listSupabaseCooperatives();
      return rows.map(row => ({
        id: row.cooperative_id,
        name: row.name,
        location: row.location,
        status: "active" as const,
      }));
    }),
    create: protectedProcedure
      .input(
        z.object({
          name: z.string().trim().min(3).max(180),
          location: z.string().trim().min(3).max(180),
        })
      )
      .mutation(async ({ ctx, input }) => {
        requireRole(ctx, ["admin", "superadmin"]);
        const normalized = normalizeCooperativeName(input.name);
        const created = await supabaseAdmin
          .from("cooperatives")
          .insert({ name: normalized.displayName, location: input.location })
          .select("cooperative_id,name,location,created_at")
          .single();
        if (created.error || !created.data)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The cooperative could not be created.",
          });
        return { success: true, cooperative: created.data } as const;
      }),
  }),

  marketplace: router({
    byId: publicProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ input }) => {
        const listing = await getSupabaseMarketplaceProduct(input.id);
        if (!listing)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "This product is not currently available.",
          });
        return listing;
      }),
    list: publicProcedure
      .input(
        z
          .object({
            category: z.string().optional(),
            sort: z.enum(["asc", "desc"]).default("asc"),
          })
          .optional()
      )
      .query(({ input }) =>
        listSupabaseMarketplace(input?.category, input?.sort ?? "asc")
      ),
    categories: publicProcedure.query(() =>
      listSupabaseMarketplaceCategories()
    ),
  }),

  supabaseProducts: router({
    mine: supabaseProtectedProcedure.query(async ({ ctx }) => {
      const seller = requireOperationalRole(ctx.supabaseUser, ["seller"]);
      return listSupabaseSellerProducts(seller.id);
    }),
    create: supabaseProtectedProcedure
      .input(
        z.object({
          name: z.string().trim().min(2).max(160),
          category: z.string().trim().min(2).max(80),
          description: z.string().trim().min(1).max(1200),
          unit: z.string().trim().min(1).max(40),
          priceCents: z.number().int().positive(),
          stockQty: z.number().int().min(0),
          status: z
            .enum([
              SUPABASE_PRODUCT_ACTIVE_STATUS,
              SUPABASE_PRODUCT_ARCHIVED_STATUS,
            ])
            .default(SUPABASE_PRODUCT_ACTIVE_STATUS),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const seller = requireOperationalRole(ctx.supabaseUser, ["seller"]);
        try {
          return await createSupabaseProduct({ ...input, sellerId: seller.id });
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: errorMessage(error, "Unable to create this product."),
          });
        }
      }),
    update: supabaseProtectedProcedure
      .input(
        z.object({
          productId: z.string().uuid(),
          name: z.string().trim().min(2).max(160),
          category: z.string().trim().min(2).max(80),
          description: z.string().trim().min(1).max(1200),
          unit: z.string().trim().min(1).max(40),
          priceCents: z.number().int().positive(),
          stockQty: z.number().int().min(0),
          status: z.enum([
            SUPABASE_PRODUCT_ACTIVE_STATUS,
            SUPABASE_PRODUCT_ARCHIVED_STATUS,
          ]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const seller = requireOperationalRole(ctx.supabaseUser, ["seller"]);
        try {
          return await updateSupabaseProduct({ ...input, sellerId: seller.id });
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: errorMessage(error, "Unable to update this product."),
          });
        }
      }),
    archive: supabaseProtectedProcedure
      .input(z.object({ productId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const seller = requireOperationalRole(ctx.supabaseUser, ["seller"]);
        try {
          return await archiveSupabaseProduct(seller.id, input.productId);
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: errorMessage(error, "Unable to archive this product."),
          });
        }
      }),
  }),

  supabaseQuotations: router({
    buyerMine: supabaseProtectedProcedure.query(({ ctx }) => {
      const buyer = requireOperationalRole(ctx.supabaseUser, [
        "buyer",
        "seller",
      ]);
      return listSupabaseBuyerQuotations(buyer.id);
    }),
    request: supabaseProtectedProcedure
      .input(
        z.object({
          productId: z.string().uuid(),
          requestedQty: z.number().int().positive(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const buyer = requireOperationalRole(ctx.supabaseUser, [
          "buyer",
          "seller",
        ]);
        try {
          return await createSupabaseQuotation({
            buyerId: buyer.id,
            productId: input.productId,
            requestedQty: input.requestedQty,
          });
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: errorMessage(error, "Unable to request this quotation."),
          });
        }
      }),
    decide: supabaseProtectedProcedure
      .input(
        z.object({
          quotationId: z.string().uuid(),
          status: z.enum(["accepted", "declined"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const buyer = requireOperationalRole(ctx.supabaseUser, [
          "buyer",
          "seller",
        ]);
        try {
          return await decideSupabaseQuotation({
            buyerId: buyer.id,
            quotationId: input.quotationId,
            status: input.status,
          });
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: errorMessage(
              error,
              "Unable to save this quotation decision."
            ),
          });
        }
      }),
  }),

  supabaseOrders: router({
    buyerMine: supabaseProtectedProcedure.query(({ ctx }) => {
      const buyer = requireOperationalRole(ctx.supabaseUser, [
        "buyer",
        "seller",
      ]);
      return listSupabaseBuyerOrders(buyer.id);
    }),
    create: supabaseProtectedProcedure
      .input(
        z.object({
          items: z
            .array(
              z.object({
                productId: z.string().uuid(),
                quantity: z.number().int().positive(),
              })
            )
            .min(1),
          buyerNote: z.string().max(600).optional(),
          quotationId: z.string().uuid().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const buyer = requireOperationalRole(ctx.supabaseUser, [
          "buyer",
          "seller",
        ]);
        try {
          return await createSupabaseOrder({
            buyerId: buyer.id,
            items: input.items,
            quotationId: input.quotationId,
          });
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: errorMessage(error, "Unable to create this order."),
          });
        }
      }),
  }),

  supabaseOfficer: router({
    overview: supabaseProtectedProcedure.query(async ({ ctx }) => {
      const officer = requireOperationalRole(ctx.supabaseUser, ["admin"]);
      if (!officer.cooperativeId)
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Assign this officer to a cooperative before viewing cooperative records.",
        });
      try {
        return await getSupabaseOfficerOverview(officer.cooperativeId);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: errorMessage(error, "Unable to load cooperative records."),
        });
      }
    }),
    updateMemberStatus: supabaseProtectedProcedure
      .input(
        z.object({
          userId: z.string().uuid(),
          accountStatus: z.enum(["approved", "suspended"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const officer = requireOperationalRole(ctx.supabaseUser, ["admin"]);
        if (!officer.cooperativeId)
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Assign this officer to a cooperative before managing members.",
          });
        try {
          return await updateSupabaseMemberStatus(
            officer.id,
            input.userId,
            input.accountStatus
          );
        } catch (error) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: errorMessage(error, "Unable to update member status."),
          });
        }
      }),
    reviewProduct: supabaseProtectedProcedure
      .input(
        z.object({
          productId: z.string().uuid(),
          decision: z.enum([
            SUPABASE_PRODUCT_ACTIVE_STATUS,
            SUPABASE_PRODUCT_ARCHIVED_STATUS,
          ]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const officer = requireOperationalRole(ctx.supabaseUser, ["admin"]);
        try {
          return await reviewSupabaseProduct(
            officer.id,
            input.productId,
            input.decision
          );
        } catch (error) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: errorMessage(error, "Unable to review this product."),
          });
        }
      }),
    reviewQuotation: supabaseProtectedProcedure
      .input(
        z.object({
          quotationId: z.string().uuid(),
          decision: z.enum(["responded", "declined"]),
          proposedPriceCents: z.number().int().positive().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const officer = requireOperationalRole(ctx.supabaseUser, ["admin"]);
        try {
          return await reviewSupabaseQuotation(
            officer.id,
            input.quotationId,
            input.decision,
            input.proposedPriceCents
          );
        } catch (error) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: errorMessage(error, "Unable to review this quotation."),
          });
        }
      }),
    updateOrderStatus: supabaseProtectedProcedure
      .input(
        z.object({
          orderId: z.string().uuid(),
          status: z.enum(["confirmed", "ready", "completed", "cancelled"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const officer = requireOperationalRole(ctx.supabaseUser, ["admin"]);
        try {
          return await updateSupabaseOfficerOrder(
            officer.id,
            input.orderId,
            input.status
          );
        } catch (error) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: errorMessage(error, "Unable to update this order."),
          });
        }
      }),
  }),

  supabaseAdmin: router({
    overview: supabaseProtectedProcedure.query(async ({ ctx }) => {
      requireOperationalRole(ctx.supabaseUser, ["superadmin"]);
      try {
        return await getSupabaseAdminOverview();
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: errorMessage(error, "Unable to load administrator records."),
        });
      }
    }),
    updateProfile: supabaseProtectedProcedure
      .input(
        z.object({
          userId: z.string().uuid(),
          roleName: z.enum(["buyer", "seller", "coop_officer", "system_admin"]),
          accountStatus: accountStatusSchema,
          cooperativeId: z.string().uuid().nullable(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const admin = requireOperationalRole(ctx.supabaseUser, ["superadmin"]);
        try {
          return await updateSupabaseProfileAsAdmin({
            actorId: admin.id,
            targetUserId: input.userId,
            roleName: input.roleName,
            accountStatus: input.accountStatus,
            cooperativeId: input.cooperativeId,
          });
        } catch (error) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: errorMessage(error, "Unable to update this profile."),
          });
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
