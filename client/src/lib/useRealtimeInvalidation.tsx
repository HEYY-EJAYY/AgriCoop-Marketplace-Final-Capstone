import { useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";

/**
 * Subscribes to Supabase Realtime postgres_changes for operational tables and
 * invalidates the matching tRPC queries so dashboards update without refresh.
 * RLS on the published tables scopes events to rows the user may SELECT.
 */

const TABLE_QUERIES: Record<string, string[]> = {
  notifications: ["notifications.mine", "notifications.pendingCounts"],
  orders: [
    "orders.buyerMine", "orders.sellerMine", "orders.buyerMineCounts", "notifications.pendingCounts",
    "orders.sellerMineCounts", "orders.byId", "orders.history",
    "payments.mine", "payments.reviewQueue", "cooperativeAdmin.overview", "admin.overview",
  ],
  orderHistory: ["orders.history", "orders.byId", "admin.overview", "cooperativeAdmin.overview"],
  orderEvents: ["orders.byId", "admin.overview", "cooperativeAdmin.overview"],
  transactions: ["admin.overview", "cooperativeAdmin.overview", "payments.mine"],
  paymentProofs: ["payments.mine", "payments.reviewQueue", "admin.overview", "cooperativeAdmin.overview"],
  conversations: ["conversations.mine", "conversations.messages", "cooperativeAdmin.orderThreadStates", "notifications.pendingCounts"],
  conversationMessages: ["conversations.messages", "conversations.mine"],
  threadStates: ["conversations.mine", "cooperativeAdmin.orderThreadStates"],
  quotations: ["quotations.buyerMine", "quotations.sellerMine", "quotations.counts", "admin.overview", "cooperativeAdmin.overview", "notifications.pendingCounts"],
  products: ["marketplace.list", "marketplace.byId", "products.mine", "admin.overview", "cooperativeAdmin.overview", "notifications.pendingCounts"],
  users: ["admin.overview", "cooperativeAdmin.overview", "auth.me", "notifications.pendingCounts"],
  cooperatives: ["admin.overview", "cooperativeAdmin.overview", "marketplace.list", "notifications.pendingCounts"],
};

function invalidatePath(utils: ReturnType<typeof trpc.useUtils>, path: string) {
  const [routerName, procName] = path.split(".");
  const router = (utils as unknown as Record<string, Record<string, { invalidate: () => Promise<unknown> }>>)[routerName];
  router?.[procName]?.invalidate().catch(() => undefined);
}

export function RealtimeInvalidator() {
  const { user, isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const userId = user?.id;

  useEffect(() => {
    if (!isAuthenticated || !userId || !isSupabaseConfigured) return;

    const invalidateAll = () => {
      for (const paths of Object.values(TABLE_QUERIES)) for (const p of paths) invalidatePath(utils, p);
    };

    const channel = supabase.channel(`agricoop-realtime-${userId}`);
    for (const table of Object.keys(TABLE_QUERIES)) {
      channel.on("postgres_changes", { event: "*", schema: "agricoop_app", table }, () => {
        for (const p of TABLE_QUERIES[table]) invalidatePath(utils, p);
      });
    }
    channel.subscribe((status) => {
      // Reconcile on (re)subscribe so missed events during disconnects are recovered.
      if (status === "SUBSCRIBED") invalidateAll();
    });

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, userId]);

  return null;
}
