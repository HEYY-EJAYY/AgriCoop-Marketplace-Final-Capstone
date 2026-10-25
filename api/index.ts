import { createApp } from "../server/_core/app.js";
import type { NextFunction, Request, Response } from "express";

const app = createApp({ restoreVercelFunctionPath: true });

// Keep an explicit Vercel-compatible handler export. This makes the function
// entry point unambiguous to Vercel's Node runtime while preserving Express's
// request path and response handling.
export default function handler(req: Request, res: Response, next: NextFunction) {
  return app(req, res, next);
}
