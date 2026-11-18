import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { toUserFacingErrorMessage } from "@shared/userFacingErrors";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

export const LOCAL_CART_LEFTOVERS_KEY = "agricoop-local-cart-leftovers";

export type BuyerCartItem = {
  productId: number;
  name: string;
  unit: string;
  quantity: number;
  minOrderQty: number;
  stockQty: number;
  priceCents: number;
  sellerId: number;
  sellerName: string;
  cooperativeId: number | null;
  cooperativeName?: string | null;
  cooperativeSlug?: string | null;
  sellerHasOnlineQr?: boolean;
  allowsPickup: boolean;
  allowsDelivery: boolean;
  acceptsOnlinePayment: boolean;
  primaryImageUrl?: string | null;
};

function readLocalLeftovers(): Array<{ productId: number; quantity: number }> {
  try {
    const raw = localStorage.getItem(LOCAL_CART_LEFTOVERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(row => {
        if (!row || typeof row !== "object") return null;
        const productId = Number((row as { productId?: unknown }).productId);
        const quantity = Number((row as { quantity?: unknown }).quantity);
        if (!Number.isInteger(productId) || productId <= 0 || !Number.isInteger(quantity) || quantity <= 0) {
          return null;
        }
        return { productId, quantity };
      })
      .filter((row): row is { productId: number; quantity: number } => Boolean(row));
  } catch {
    return [];
  }
}

export function clearLocalCartLeftovers() {
  try {
    localStorage.removeItem(LOCAL_CART_LEFTOVERS_KEY);
  } catch {
    // ignore
  }
}

export function writeLocalCartLeftovers(items: Array<{ productId: number; quantity: number }>) {
  try {
    if (!items.length) {
      localStorage.removeItem(LOCAL_CART_LEFTOVERS_KEY);
      return;
    }
    localStorage.setItem(LOCAL_CART_LEFTOVERS_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

export function useBuyerCart() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const canUseCart = Boolean(user && (user.role === "buyer" || user.role === "seller"));
  const mergedRef = useRef(false);

  const cartQuery = trpc.cart.mine.useQuery(undefined, {
    enabled: canUseCart,
    staleTime: 30_000,
    placeholderData: previous => previous,
  });

  const countQuery = trpc.cart.count.useQuery(undefined, {
    enabled: canUseCart,
    staleTime: 30_000,
  });

  const mergeMutation = trpc.cart.merge.useMutation({
    onSuccess: data => {
      utils.cart.mine.setData(undefined, data.items);
      void utils.cart.count.invalidate();
      clearLocalCartLeftovers();
    },
  });

  const setQuantityMutation = trpc.cart.setQuantity.useMutation({
    onMutate: async input => {
      await utils.cart.mine.cancel();
      const previous = utils.cart.mine.getData();
      if (previous) {
        const next = previous
          .map(item => (item.productId === input.productId ? { ...item, quantity: Math.max(0, input.quantity) } : item))
          .filter(item => item.quantity > 0);
        utils.cart.mine.setData(undefined, next);
      }
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) utils.cart.mine.setData(undefined, context.previous);
      toast.error(toUserFacingErrorMessage(error.message));
    },
    onSuccess: data => {
      utils.cart.mine.setData(undefined, data.items);
      void utils.cart.count.invalidate();
      if (data.clamped) {
        toast.message(`Only ${data.stockQty} available`);
      }
    },
  });

  const addMutation = trpc.cart.add.useMutation({
    onSuccess: data => {
      utils.cart.mine.setData(undefined, data.items);
      void utils.cart.count.invalidate();
      if (data.clamped) toast.message(`Only ${data.stockQty} available`);
    },
    onError: error => toast.error(toUserFacingErrorMessage(error.message)),
  });

  const removeMutation = trpc.cart.remove.useMutation({
    onMutate: async input => {
      await utils.cart.mine.cancel();
      const previous = utils.cart.mine.getData();
      if (previous) {
        utils.cart.mine.setData(undefined, previous.filter(item => item.productId !== input.productId));
      }
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) utils.cart.mine.setData(undefined, context.previous);
      toast.error(toUserFacingErrorMessage(error.message));
    },
    onSuccess: data => {
      utils.cart.mine.setData(undefined, data.items);
      void utils.cart.count.invalidate();
    },
  });

  useEffect(() => {
    if (!canUseCart || mergedRef.current || cartQuery.isLoading) return;
    const leftovers = readLocalLeftovers();
    if (!leftovers.length) {
      mergedRef.current = true;
      return;
    }
    mergedRef.current = true;
    mergeMutation.mutate({ items: leftovers });
  }, [canUseCart, cartQuery.isLoading, mergeMutation]);

  const items = (cartQuery.data ?? []) as BuyerCartItem[];
  const isCartLoading = canUseCart && cartQuery.isLoading && !cartQuery.data;
  const count = countQuery.data?.count ?? items.length;

  return {
    canUseCart,
    items,
    count,
    isCartLoading,
    isFetching: cartQuery.isFetching,
    add: (productId: number) => addMutation.mutateAsync({ productId }),
    setQuantity: (productId: number, quantity: number) => setQuantityMutation.mutateAsync({ productId, quantity }),
    remove: (productId: number) => removeMutation.mutateAsync({ productId }),
    refetch: () => cartQuery.refetch(),
    busy: setQuantityMutation.isPending || addMutation.isPending || removeMutation.isPending,
  };
}
