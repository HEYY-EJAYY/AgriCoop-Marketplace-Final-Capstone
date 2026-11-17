import { eq } from "drizzle-orm";
import type { Express } from "express";
import { conversations, users } from "../../drizzle/pg-schema";
import { APP_ROLES, canAccessConversation, requireOperationalRole } from "../authz";
import { supabaseAdmin } from "../clients";
import { getDb, getUserByVerifiedAuthId, withRequestDatabaseScope } from "../db";
import { isVerifiedSupabaseEmail } from "../registration";
import { subscribeConversation } from "../realtime";

export function registerConversationStreamRoute(app: Express) {
  app.get("/api/conversations/:conversationId/stream", async (req, res) => {
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!bearer) return res.status(401).end();
    let authResult: Awaited<ReturnType<typeof supabaseAdmin.auth.getUser>>;
    try {
      authResult = await supabaseAdmin.auth.getUser(bearer);
    } catch {
      return res.status(503).end();
    }
    if (authResult.error) {
      const errorStatus = typeof authResult.error === "object" && "status" in authResult.error
        ? authResult.error.status
        : undefined;
      return res.status(errorStatus === 401 || errorStatus === 403 ? 401 : 503).end();
    }
    const authUser = authResult.data.user;
    if (!authUser || !isVerifiedSupabaseEmail(authUser)) return res.status(401).end();
    const conversationId = Number(req.params.conversationId);
    if (!Number.isInteger(conversationId)) return res.status(403).end();
    let access: typeof conversations.$inferSelect | null = null;
    try {
      access = await withRequestDatabaseScope(authUser.id, async () => {
        const { user: localUser } = await getUserByVerifiedAuthId(authUser.id);
        if (!localUser) return null;
        try {
          requireOperationalRole(localUser, APP_ROLES);
        } catch {
          return null;
        }
        const db = await getDb();
        const thread = (await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1))[0];
        const seller = thread?.sellerId === null || thread?.sellerId === undefined
          ? undefined
          : (await db.select({ cooperativeId: users.cooperativeId }).from(users).where(eq(users.id, thread.sellerId)).limit(1))[0];
        if (!thread || !canAccessConversation(localUser, thread, seller?.cooperativeId ?? null)) return null;
        return thread;
      });
    } catch (error) {
      console.error("[ConversationStream] authorization lookup failed", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
      return res.status(503).end();
    }
    if (!access) return res.status(403).end();
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(`event: ready\ndata: ${JSON.stringify({ conversationId })}\n\n`);
    const unsubscribe = subscribeConversation(conversationId, event => res.write(`event: message\ndata: ${JSON.stringify(event)}\n\n`));
    const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 25_000);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.on("close", close);
    res.on("close", close);
  });
}
