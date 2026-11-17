import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerStorageProxy } from "./storageProxy";
import { registerConversationStreamRoute } from "./conversationStream";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { getHealthStatus } from "../health";
import { systemRouter } from "./systemRouter";
import { MAX_IMAGE_UPLOAD_REQUEST_BODY_BYTES } from "../../shared/productOptions";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.get("/api/health", async (_req, res) => {
    const health = await getHealthStatus();
    res.status(health.status === "ok" ? 200 : 503).json(health);
  });
  app.use(express.json({ limit: MAX_IMAGE_UPLOAD_REQUEST_BODY_BYTES }));
  app.use(express.urlencoded({ limit: MAX_IMAGE_UPLOAD_REQUEST_BODY_BYTES, extended: true }));
  registerConversationStreamRoute(app);
  registerStorageProxy(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // Mount systemRouter for health and notification operations
  app.use("/api/system", createExpressMiddleware({
    router: systemRouter,
    createContext,
  }));
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
