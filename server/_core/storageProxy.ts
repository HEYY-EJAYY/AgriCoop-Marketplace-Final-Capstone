import type { Express } from "express";
import { supabaseAdmin } from "../clients";
import { getUserByOpenId } from "../db";
import { ENV } from "./env";
import { isStorageProxyUserAuthenticated } from "./storageProxyAuth";

export function registerStorageProxy(app: Express) {
  app.get("/manus-storage/*", async (req, res) => {
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "")
      || (typeof req.query.access_token === "string" ? req.query.access_token : undefined);
    if (!bearer) {
      res.status(401).send("Authentication required");
      return;
    }
    const { data, error } = await supabaseAdmin.auth.getUser(bearer);
    if (error || !data.user) {
      res.status(401).send("Authentication required");
      return;
    }
    const localUser = await getUserByOpenId(data.user.id);
    if (!isStorageProxyUserAuthenticated(data.user.id, localUser?.openId)) {
      res.status(401).send("Authentication required");
      return;
    }
    const key = (req.params as Record<string, string>)[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }

    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }

    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/",
      );
      forgeUrl.searchParams.set("path", key);

      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` },
      });

      if (!forgeResp.ok) {
        const body = await forgeResp.text().catch(() => "");
        console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
        res.status(502).send("Storage backend error");
        return;
      }

      const { url } = (await forgeResp.json()) as { url: string };
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }

      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}
