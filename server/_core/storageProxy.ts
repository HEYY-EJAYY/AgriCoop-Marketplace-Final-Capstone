import { and, eq, or } from "drizzle-orm";
import type { Express } from "express";
import { productImages, products, users } from "../../drizzle/pg-schema";
import { APP_ROLES, requireOperationalRole } from "../authz";
import { supabaseAdmin } from "../clients";
import { getDb, getUserByVerifiedAuthId, withRequestDatabaseScope } from "../db";
import { isVerifiedSupabaseEmail } from "../registration";
import { ENV } from "./env";
import {
  canAccessLegacyProductImage,
  normalizeLegacyProductImagePath,
} from "./storageProxyAuth";

type ProxyAuthorization = "allowed" | "unauthenticated" | "forbidden" | "not_found";

export function registerStorageProxy(app: Express) {
  app.get("/manus-storage/*", async (req, res) => {
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!bearer) {
      res.status(401).send("Authentication required");
      return;
    }

    let authUser: Awaited<ReturnType<typeof supabaseAdmin.auth.getUser>>;
    try {
      authUser = await supabaseAdmin.auth.getUser(bearer);
    } catch {
      res.status(503).send("Storage authorization unavailable");
      return;
    }
    const verifiedAuthUser = authUser.data.user;
    if (authUser.error || !verifiedAuthUser || !isVerifiedSupabaseEmail(verifiedAuthUser)) {
      res.status(401).send("Authentication required");
      return;
    }

    const imagePath = normalizeLegacyProductImagePath((req.params as Record<string, string>)[0]);
    if (!imagePath) {
      res.status(404).send("Storage object not found");
      return;
    }

    let authorization: ProxyAuthorization;
    try {
      authorization = await withRequestDatabaseScope(verifiedAuthUser.id, async () => {
        const mapping = await getUserByVerifiedAuthId(verifiedAuthUser.id);
        const actor = mapping.user;
        if (!actor || actor.openId !== verifiedAuthUser.id) return "unauthenticated";

        try {
          requireOperationalRole(actor, APP_ROLES);
        } catch {
          return "forbidden";
        }

        const db = await getDb();
        const referencedImages = await db.select({
          sellerId: products.sellerId,
          cooperativeId: products.cooperativeId,
          status: products.status,
          verificationStatus: products.verificationStatus,
          visibility: products.visibility,
          sellerApprovalStatus: users.approvalStatus,
          primaryImageUrl: products.primaryImageUrl,
          galleryImageUrl: productImages.imageUrl,
        })
          .from(products)
          .innerJoin(users, eq(products.sellerId, users.id))
          .leftJoin(productImages, eq(productImages.productId, products.id))
          .where(or(
            eq(products.primaryImageUrl, imagePath),
            eq(productImages.imageUrl, imagePath),
          ));

        const allowed = referencedImages.some(image => canAccessLegacyProductImage(
          verifiedAuthUser.id,
          actor,
          {
            sellerId: image.sellerId,
            cooperativeId: image.cooperativeId,
            status: image.status,
            verificationStatus: image.verificationStatus,
            visibility: image.visibility,
            sellerApprovalStatus: image.sellerApprovalStatus,
            imagePaths: [image.primaryImageUrl, image.galleryImageUrl].filter((path): path is string => Boolean(path)),
          },
          imagePath,
        ));
        return allowed ? "allowed" : "not_found";
      });
    } catch (error) {
      console.error("[StorageProxy] authorization lookup failed", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
      res.status(503).send("Storage authorization unavailable");
      return;
    }

    if (authorization === "unauthenticated") {
      res.status(401).send("Authentication required");
      return;
    }
    if (authorization === "forbidden") {
      res.status(403).send("Operational access required");
      return;
    }
    if (authorization !== "allowed") {
      res.status(404).send("Storage object not found");
      return;
    }
    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(503).send("Storage service unavailable");
      return;
    }

    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/",
      );
      forgeUrl.searchParams.set("path", imagePath.slice("/manus-storage/".length));

      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` },
      });

      if (!forgeResp.ok) {
        console.error("[StorageProxy] storage service rejected an authorized image request", {
          status: forgeResp.status,
        });
        res.status(502).send("Storage backend error");
        return;
      }

      const signed = await forgeResp.json() as { url?: unknown };
      if (typeof signed.url !== "string") {
        res.status(502).send("Storage backend error");
        return;
      }

      res.set("Cache-Control", "no-store");
      res.redirect(307, signed.url);
    } catch (error) {
      console.error("[StorageProxy] signed image request failed", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
      res.status(502).send("Storage proxy error");
    }
  });
}
