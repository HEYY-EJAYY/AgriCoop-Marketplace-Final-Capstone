import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers.js";
import { createContext } from "./context.js";

type CreateAppOptions = {
  restoreVercelFunctionPath?: boolean;
};

export function createApp(options: CreateAppOptions = {}) {
  const app = express();

  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    if (process.env.NODE_ENV === "production" && req.secure) {
      res.setHeader("Strict-Transport-Security", "max-age=15552000");
    }
    next();
  });

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "1mb", extended: true }));

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

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  return app;
}
