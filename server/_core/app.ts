import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerConversationStreamRoute } from "./conversationStream";
import { getHealthStatus } from "../health";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { systemRouter } from "./systemRouter";
import { MAX_IMAGE_UPLOAD_REQUEST_BODY_BYTES } from "../../shared/productOptions";

type CreateAppOptions = {
  restoreVercelFunctionPath?: boolean;
};

export function createApp(options: CreateAppOptions = {}) {
  const app = express();

  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(express.json({ limit: MAX_IMAGE_UPLOAD_REQUEST_BODY_BYTES }));
  app.use(express.urlencoded({ limit: MAX_IMAGE_UPLOAD_REQUEST_BODY_BYTES, extended: true }));

  if (options.restoreVercelFunctionPath) {
    app.use((req, _res, next) => {
      const requestUrl = new URL(req.url, "http://localhost");
      const path = requestUrl.searchParams.get("__vercel_path");
      if (path !== null) {
        requestUrl.searchParams.delete("__vercel_path");
        req.url = `/api/${path.replace(/^\/+/, "")}${requestUrl.search}`;
      }
      next();
    });
  }

  app.get("/api/health", async (_req, res) => {
    const health = await getHealthStatus();
    res.status(health.status === "ok" ? 200 : 503).json(health);
  });
  registerConversationStreamRoute(app);

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );
  app.use(
    "/api/system",
    createExpressMiddleware({
      router: systemRouter,
      createContext,
    }),
  );

  return app;
}
