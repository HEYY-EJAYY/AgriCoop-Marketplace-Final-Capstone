import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { supabaseAdmin } from "../clients";
import { conversations } from "../../drizzle/schema";
import { and, eq, or } from "drizzle-orm";
import { getDb, getUserByOpenId } from "../db";
import { subscribeConversation } from "../realtime";

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
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.get("/api/conversations/:conversationId/stream", async (req, res) => {
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "") || (typeof req.query.access_token === "string" ? req.query.access_token : undefined);
    if (!bearer) return res.status(401).end();
    const { data } = await supabaseAdmin.auth.getUser(bearer);
    if (!data.user) return res.status(401).end();
    const localUser = await getUserByOpenId(data.user.id);
    const conversationId = Number(req.params.conversationId);
    const db = await getDb();
    if (!localUser || !db || !Number.isInteger(conversationId)) return res.status(403).end();
    const thread = (await db.select().from(conversations).where(and(eq(conversations.id, conversationId), or(eq(conversations.buyerId, localUser.id), eq(conversations.sellerId, localUser.id)))).limit(1))[0];
    if (!thread && localUser.role !== "admin" && localUser.role !== "superadmin") return res.status(403).end();
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(`event: ready\ndata: ${JSON.stringify({ conversationId })}\n\n`);
    const unsubscribe = subscribeConversation(conversationId, event => res.write(`event: message\ndata: ${JSON.stringify(event)}\n\n`));
    req.on("close", unsubscribe);
  });
  registerStorageProxy(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
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
