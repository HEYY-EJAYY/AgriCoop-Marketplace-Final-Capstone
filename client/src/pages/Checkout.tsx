import { PageFrame, shellContainerClass } from "@/components/AgriShell";
import { useAuth } from "@/_core/hooks/useAuth";
import { goToAuth } from "@/const";
import { supabase } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";
import {
  CHECKOUT_CART_STORAGE_KEY,
  checkoutCartSchema,
  groupCartItemsBySeller,
  type CheckoutCartItem,
} from "../../../shared/checkoutCart";
import { getAccountAccessRestriction } from "../../../shared/accountAccess";
import {
  defaultFulfillmentForPayment,
  fulfillmentOptionsForListings,
  methodsForListings,
  PAYMENT_METHOD_HELPERS,
  paymentMethodLabel,
  type FulfillmentMethod,
  type PaymentMethod,
} from "../../../shared/paymentMethods";
import {
  PAYMENT_PROOF_BUCKET,
  PAYMENT_PROOF_CONTENT_TYPES,
  PAYMENT_PROOF_MAX_BYTES,
} from "../../../shared/paymentProofs";
import { toUserFacingErrorMessage } from "@shared/userFacingErrors";
import { ArrowLeft, Copy, Loader2, QrCode, ShoppingBag, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link, useLocation } from "wouter";

type SellerGroupChoice = {
  paymentMethod: PaymentMethod;
  fulfillmentMethod: FulfillmentMethod;
  receiptStoragePath?: string;
};

type SellerOnlinePayment = {
  qrImageUrl?: string | null;
  accountName?: string | null;
  accountNumber?: string | null;
  label?: string | null;
};

type OnlinePaymentQueryHook = {
  useQuery: (
    input: { sellerId: number },
    opts?: { enabled?: boolean },
  ) => {
    data: SellerOnlinePayment | undefined;
    isLoading: boolean;
    error: { message?: string } | null;
  };
};

type CheckoutReceiptUploadHook = {
  useMutation: () => {
    mutateAsync: (input: {
      sellerId: number;
      fileName: string;
      contentType: (typeof PAYMENT_PROOF_CONTENT_TYPES)[number];
      fileSizeBytes: number;
    }) => Promise<{ storagePath: string; uploadToken: string; uploadIntent: string }>;
    isPending: boolean;
  };
};

type CheckoutReceiptFinalizeHook = {
  useMutation: () => {
    mutateAsync: (input: { sellerId: number; uploadIntent: string }) => Promise<{ receiptStoragePath: string }>;
    isPending: boolean;
  };
};

function useSellerOnlinePayment(sellerId: number, enabled: boolean) {
  return trpc.sellers.getOnlinePayment.useQuery({ sellerId }, { enabled });
}

function readCheckoutCart() {
  try {
    const raw = sessionStorage.getItem(CHECKOUT_CART_STORAGE_KEY);
    if (!raw) return null;
    const parsed = checkoutCartSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      sessionStorage.removeItem(CHECKOUT_CART_STORAGE_KEY);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

const peso = (cents: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(cents / 100);

function checkoutMethodLabel(method: PaymentMethod) {
  if (method === "cash_pickup") return "Cash on pickup";
  if (method === "cash_delivery") return "Cash on delivery";
  return paymentMethodLabel(method);
}

function listingFlags(items: CheckoutCartItem[]) {
  return items.map(item => ({
    allowsPickup: item.allowsPickup ?? true,
    allowsDelivery: item.allowsDelivery ?? true,
    acceptsOnlinePayment: item.acceptsOnlinePayment ?? false,
  }));
}

function sellerHasOnlineQr(items: CheckoutCartItem[]) {
  return items.every(item => item.sellerHasOnlineQr === true);
}

function SellerCheckoutGroup({
  sellerId,
  sellerName,
  items,
  choice,
  onChoiceChange,
}: {
  sellerId: number;
  sellerName: string;
  items: CheckoutCartItem[];
  choice: SellerGroupChoice;
  onChoiceChange: (next: SellerGroupChoice) => void;
}) {
  const flags = useMemo(() => listingFlags(items), [items]);
  const onlineQuery = useSellerOnlinePayment(sellerId, true);
  const onlineDetails = onlineQuery.data;
  const hasQr = sellerHasOnlineQr(items) || Boolean(onlineDetails?.qrImageUrl);
  const methods = useMemo(() => methodsForListings(flags, hasQr), [flags, hasQr]);
  const fulfillmentOptions = fulfillmentOptionsForListings(flags);
  const groupTotal = items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);

  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [receiptError, setReceiptError] = useState("");

  const canUploadReceipt = true;
  const uploadReceipt = trpc.payments.uploadCheckoutReceipt.useMutation();
  const finalizeReceipt = trpc.payments.finalizeCheckoutReceipt.useMutation();

  useEffect(() => {
    if (!receiptFile) {
      setReceiptPreview(null);
      return;
    }
    const url = URL.createObjectURL(receiptFile);
    setReceiptPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [receiptFile]);

  useEffect(() => {
    if (!methods.includes(choice.paymentMethod) && methods.length) {
      const paymentMethod = methods[0]!;
      const fulfillment =
        defaultFulfillmentForPayment(paymentMethod, {
          allowsPickup: flags.every(f => f.allowsPickup),
          allowsDelivery: flags.every(f => f.allowsDelivery),
          acceptsOnlinePayment: flags.every(f => f.acceptsOnlinePayment),
        }) ?? fulfillmentOptions[0] ?? "pickup";
      onChoiceChange({ paymentMethod, fulfillmentMethod: fulfillment, receiptStoragePath: undefined });
    }
  }, [methods, choice.paymentMethod, flags, fulfillmentOptions, onChoiceChange]);

  const setPaymentMethod = (paymentMethod: PaymentMethod) => {
    const fulfillment =
      paymentMethod === "cash_pickup"
        ? "pickup"
        : paymentMethod === "cash_delivery"
          ? "delivery"
          : defaultFulfillmentForPayment(paymentMethod, {
              allowsPickup: flags.every(f => f.allowsPickup),
              allowsDelivery: flags.every(f => f.allowsDelivery),
              acceptsOnlinePayment: flags.every(f => f.acceptsOnlinePayment),
            }) ?? fulfillmentOptions[0] ?? "pickup";
    onChoiceChange({
      paymentMethod,
      fulfillmentMethod: fulfillment,
      receiptStoragePath: paymentMethod === "online" ? choice.receiptStoragePath : undefined,
    });
    if (paymentMethod !== "online") {
      setReceiptFile(null);
      setReceiptError("");
    }
  };

  const uploadReceiptFile = async (file: File) => {
    if (!canUploadReceipt || !uploadReceipt || !finalizeReceipt) {
      toast.error("Checkout receipt upload is not available yet. Try again after the app is updated.");
      return;
    }
  setReceiptBusy(true);
    setReceiptError("");
    try {
      const authorization = await uploadReceipt.mutateAsync({
        sellerId,
        fileName: file.name,
        contentType: file.type as (typeof PAYMENT_PROOF_CONTENT_TYPES)[number],
        fileSizeBytes: file.size,
      });
      const { error } = await supabase.storage
        .from(PAYMENT_PROOF_BUCKET)
        .uploadToSignedUrl(authorization.storagePath, authorization.uploadToken, file, { contentType: file.type });
      if (error) throw new Error(error.message);
      const finalized = await finalizeReceipt.mutateAsync({
        sellerId,
        uploadIntent: authorization.uploadIntent,
      });
      onChoiceChange({ ...choice, receiptStoragePath: finalized.receiptStoragePath });
      toast.success("Receipt uploaded for this seller group.");
    } catch (problem) {
      const message = toUserFacingErrorMessage(problem instanceof Error ? problem.message : "Upload failed.");
      setReceiptError(message);
      toast.error(message);
      onChoiceChange({ ...choice, receiptStoragePath: undefined });
    } finally {
      setReceiptBusy(false);
    }
  };

  const onPickReceipt = (file: File | null) => {
    if (!file) return;
    if (
      !PAYMENT_PROOF_CONTENT_TYPES.includes(file.type as (typeof PAYMENT_PROOF_CONTENT_TYPES)[number])
      || file.size > PAYMENT_PROOF_MAX_BYTES
    ) {
      setReceiptError("Choose a JPEG, PNG, or WebP receipt up to 5 MiB.");
      setReceiptFile(null);
      onChoiceChange({ ...choice, receiptStoragePath: undefined });
      return;
    }
    setReceiptError("");
    setReceiptFile(file);
    void uploadReceiptFile(file);
  };

  const copyAmount = async () => {
    try {
      await navigator.clipboard.writeText((groupTotal / 100).toFixed(2));
      toast.success("Amount copied.");
    } catch {
      toast.error("Could not copy amount.");
    }
  };

  const showOnline = choice.paymentMethod === "online";

  return (
    <section className="rounded-2xl border border-[#e1e9dd] bg-[#f7faf4] p-4 sm:p-5">
      <h3 className="font-display text-xl font-bold text-[#264f37]">{sellerName}</h3>
      <p className="mt-1 text-xs text-[#6d7d70]">
        {items.length} listing{items.length === 1 ? "" : "s"} · {peso(groupTotal)}
      </p>
      <ul className="mt-3 space-y-2 text-sm text-[#526858]">
        {items.map(item => (
          <li key={item.productId} className="flex justify-between gap-2 border-b border-[#edf0e9] pb-2">
            <span>
              {item.name} × {item.quantity} {item.unit}
            </span>
            <span className="font-bold text-[#315640]">{peso(item.priceCents * item.quantity)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-5">
        <p className="text-xs font-extrabold uppercase tracking-wide text-[#638947]">Payment</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {methods.map(method => (
            <label
              key={method}
              className={`cursor-pointer rounded-xl border p-3 text-sm font-bold ${
                choice.paymentMethod === method
                  ? "border-[#5d8a5e] bg-[#edf4e9] text-[#315640]"
                  : "border-[#e3e9de] bg-white text-[#66766b]"
              }`}
            >
              <input
                type="radio"
                name={`payment-${sellerId}`}
                className="mr-2 accent-[#4e8257]"
                checked={choice.paymentMethod === method}
                onChange={() => setPaymentMethod(method)}
              />
              {checkoutMethodLabel(method)}
            </label>
          ))}
        </div>
        {choice.paymentMethod && (
          <p className="mt-2 text-xs leading-5 text-[#4d6854]">{PAYMENT_METHOD_HELPERS[choice.paymentMethod]}</p>
        )}
      </div>

      {showOnline && fulfillmentOptions.length > 1 && (
        <FulfillmentPicker
          options={fulfillmentOptions}
          value={choice.fulfillmentMethod}
          onChange={fulfillmentMethod => onChoiceChange({ ...choice, fulfillmentMethod })}
        />
      )}

      {showOnline && (
        <div className="mt-5 rounded-2xl border border-[#dfe8db] bg-white p-4">
          <h4 className="font-bold text-[#315640]">Pay via seller QR</h4>
          {onlineQuery.isLoading ? (
            <Loader2 className="mt-4 animate-spin text-[#4e8257]" />
          ) : (
            <>
              {onlineDetails?.qrImageUrl ? (
                <img
                  src={onlineDetails.qrImageUrl}
                  alt={`${sellerName} payment QR`}
                  className="mt-3 h-32 w-32 rounded-lg border border-[#e2e8de] object-contain"
                />
              ) : (
                <div className="mt-3 grid h-32 w-32 place-items-center rounded-lg bg-[#f0f5ed] text-[#82987a]">
                  <QrCode />
                </div>
              )}
              <p className="mt-3 text-sm font-bold text-[#315640]">
                {onlineDetails?.label || onlineDetails?.accountName || "Online payment"}
              </p>
              {onlineDetails?.accountNumber && (
                <p className="mt-1 text-xs text-[#68796d]">
                  {onlineDetails.accountName ? `${onlineDetails.accountName} · ` : ""}
                  {onlineDetails.accountNumber}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="font-display text-lg font-bold text-[#1d5639]">{peso(groupTotal)}</span>
                <button type="button" className="agri-ghost px-2 py-1 text-xs" onClick={() => void copyAmount()}>
                  <Copy size={14} /> Copy amount
                </button>
              </div>
              <label className="field-label mt-4">
                Payment receipt (required)
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="field-control"
                  disabled={receiptBusy || !canUploadReceipt}
                  onChange={e => onPickReceipt(e.target.files?.[0] ?? null)}
                />
              </label>
              {!canUploadReceipt && (
                <p role="alert" className="mt-2 text-xs text-[#a34838]">
                  Receipt upload will be available once checkout payment procedures are deployed.
                </p>
              )}
              {receiptError && (
                <p role="alert" className="mt-2 text-xs text-[#a34838]">
                  {receiptError}
                </p>
              )}
              {choice.receiptStoragePath && (
                <p className="mt-2 text-xs font-bold text-[#387047]">Receipt ready for order placement.</p>
              )}
              {receiptPreview && (
                <img
                  src={receiptPreview}
                  alt="Receipt preview"
                  className="mt-3 max-h-48 rounded-lg border border-[#e3e9de] object-contain"
                />
              )}
              {(receiptBusy || uploadReceipt?.isPending || finalizeReceipt?.isPending) && (
                <p className="mt-2 text-xs text-[#66766b]">
                  <Loader2 className="mr-1 inline animate-spin" size={14} />
                  Uploading receipt…
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function FulfillmentPicker({
  options,
  value,
  onChange,
}: {
  options: FulfillmentMethod[];
  value: FulfillmentMethod;
  onChange: (value: FulfillmentMethod) => void;
}) {
  return (
    <div className="mt-4">
      <p className="text-xs font-extrabold uppercase tracking-wide text-[#638947]">Fulfillment</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map(option => (
          <label
            key={option}
            className={`cursor-pointer rounded-xl border px-3 py-2 text-xs font-bold ${
              value === option ? "border-[#5d8a5e] bg-[#edf4e9] text-[#315640]" : "border-[#e3e9de] text-[#66766b]"
            }`}
          >
            <input
              type="radio"
              name="fulfillment"
              className="mr-1 accent-[#4e8257]"
              checked={value === option}
              onChange={() => onChange(option)}
            />
            {option === "pickup" ? "Pickup" : "Delivery"}
          </label>
        ))}
      </div>
    </div>
  );
}

export default function Checkout() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  const [cart] = useState(readCheckoutCart);
  const sellerMap = useMemo(() => (cart ? groupCartItemsBySeller(cart.items) : new Map()), [cart]);

  const initialChoices = useMemo(() => {
    const map = new Map<number, SellerGroupChoice>();
    Array.from(sellerMap.entries()).forEach(([sellerId, items]) => {
      const flags = listingFlags(items);
      const methods = methodsForListings(flags, sellerHasOnlineQr(items));
      const paymentMethod = methods[0] ?? "cash_pickup";
      const fulfillmentMethod =
        defaultFulfillmentForPayment(paymentMethod, {
          allowsPickup: flags.every(f => f.allowsPickup),
          allowsDelivery: flags.every(f => f.allowsDelivery),
          acceptsOnlinePayment: flags.every(f => f.acceptsOnlinePayment),
        }) ?? "pickup";
      map.set(sellerId, { paymentMethod, fulfillmentMethod });
    });
    return map;
  }, [sellerMap]);

  const [choices, setChoices] = useState<Map<number, SellerGroupChoice>>(initialChoices);

  useEffect(() => {
    setChoices(initialChoices);
  }, [initialChoices]);

  const utils = trpc.useUtils();
  const createOrder = trpc.orders.create.useMutation();
  const [submitting, setSubmitting] = useState(false);

  const totalCents = cart?.items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0) ?? 0;
  const accessRestriction = user ? getAccountAccessRestriction(user) : null;
  const roleCanOrder = Boolean(user && (user.role === "buyer" || user.role === "seller") && !accessRestriction);

  const allOnlineHaveReceipt = useMemo(() => {
    return Array.from(choices.values()).every(
      choice => choice.paymentMethod !== "online" || Boolean(choice.receiptStoragePath),
    );
  }, [choices]);

  const canSubmit = Boolean(cart && choices.size === sellerMap.size && allOnlineHaveReceipt && !submitting);

  const updateChoice = useCallback((sellerId: number, next: SellerGroupChoice) => {
    setChoices(current => {
      const copy = new Map(current);
      copy.set(sellerId, next);
      return copy;
    });
  }, []);

  const submitOrder = async () => {
    if (!user) return goToAuth("Checkout.submitOrder");
    if (!roleCanOrder || !cart || !canSubmit) return;

    setSubmitting(true);
    const createdIds: number[] = [];
    try {
      for (const [sellerId, items] of Array.from(sellerMap.entries())) {
        const choice = choices.get(sellerId);
        if (!choice) throw new Error("Choose payment for every seller group.");
        if (choice.paymentMethod === "online" && !choice.receiptStoragePath) {
          throw new Error("Upload a payment receipt for each online payment group.");
        }
        const result = await createOrder.mutateAsync({
          items: items.map((item: CheckoutCartItem) => ({ productId: item.productId, quantity: item.quantity })),
          paymentMethod: choice.paymentMethod,
          fulfillmentMethod: choice.fulfillmentMethod,
          receiptStoragePath: choice.receiptStoragePath,
          buyerNote:
            choice.paymentMethod === "online"
              ? "Buyer paid via seller QR; receipt attached at checkout."
              : "Please confirm availability and arrange the selected cash handover.",
        });
        createdIds.push(result.orderId);
      }
      sessionStorage.removeItem(CHECKOUT_CART_STORAGE_KEY);
      toast.success(
        createdIds.length === 1
          ? "Order submitted. The seller will confirm availability."
          : `${createdIds.length} orders submitted—one per seller.`,
      );
      void utils.orders.buyerMine.invalidate();
      setLocation(createdIds.length === 1 ? `/orders/${createdIds[0]}` : "/activity");
    } catch (problem) {
      if (createdIds.length) {
        toast.error(
          `${createdIds.length} order(s) were placed before an error occurred. Review Activity before retrying.`,
        );
        void utils.orders.buyerMine.invalidate();
      } else {
        toast.error(toUserFacingErrorMessage(problem instanceof Error ? problem.message : "Could not place order."));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <PageFrame>
        <div className="grid min-h-80 place-items-center">
          <Loader2 className="animate-spin text-[#4e8257]" />
        </div>
      </PageFrame>
    );
  }
  if (!user) {
    return (
      <PageFrame>
        <main className={`${shellContainerClass} max-w-xl py-16 text-center`}>
          <h1 className="font-display text-3xl font-bold text-[#244e36]">Sign in to continue checkout</h1>
          <p className="mt-3 text-[#647568]">Your basket is kept for this browser session.</p>
          <button className="agri-button mt-6" type="button" onClick={() => goToAuth("Checkout")}>
            Sign in
          </button>
        </main>
      </PageFrame>
    );
  }
  if (!roleCanOrder) {
    return (
      <PageFrame>
        <main className={`${shellContainerClass} max-w-xl py-16 text-center`}>
          <h1 className="font-display text-3xl font-bold text-[#244e36]">Marketplace checkout unavailable</h1>
          <p className="mt-3 text-[#647568]">
            {accessRestriction === "pending"
              ? "Your account is pending cooperative approval before you can place orders."
              : accessRestriction === "suspended"
                ? "This account is suspended. Contact cooperative support for help."
                : "Only approved Buyer and Seller accounts can place marketplace orders."}
          </p>
          <Link href="/dashboard" className="agri-button mt-6 inline-flex no-underline">
            Return to workspace
          </Link>
        </main>
      </PageFrame>
    );
  }
  if (!cart) {
    return (
      <PageFrame>
        <main className={`${shellContainerClass} max-w-xl py-16 text-center`}>
          <h1 className="font-display text-3xl font-bold text-[#244e36]">Your checkout basket is unavailable</h1>
          <p className="mt-3 text-[#647568]">Return to the marketplace and rebuild your basket. No order was placed.</p>
          <Link href="/marketplace" className="agri-button mt-6 inline-flex no-underline">
            Browse marketplace
          </Link>
        </main>
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      <main className={`${shellContainerClass} py-10`}>
        <Link href="/marketplace" className="agri-ghost text-sm no-underline">
          <ArrowLeft size={16} /> Return to marketplace
        </Link>
        <h1 className="mt-5 font-display text-4xl font-bold text-[#244e36]">Review your order</h1>
        <p className="mt-2 text-sm text-[#647568]">
          {sellerMap.size > 1
            ? "Each farmer is checked out separately with its own payment choice."
            : "Order totals and item availability are verified again by the server before submission."}
        </p>
        <div className="mt-7 grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
          <div className="space-y-4">
            {Array.from(sellerMap.entries()).map(([sellerId, items]) => {
              const choice = choices.get(sellerId) ?? initialChoices.get(sellerId)!;
              return (
                <SellerCheckoutGroup
                  key={sellerId}
                  sellerId={sellerId}
                  sellerName={items[0]?.sellerName || "Farm seller"}
                  items={items}
                  choice={choice}
                  onChoiceChange={next => updateChoice(sellerId, next)}
                />
              );
            })}
          </div>
          <aside className="agri-card h-fit p-5 sm:p-6">
            <h2 className="font-display text-2xl font-bold text-[#264f37]">Order summary</h2>
            <div className="mt-4 space-y-3">
              {cart.items.map(item => (
                <div key={item.productId} className="flex justify-between gap-3 border-b border-[#edf0e9] pb-3 text-sm">
                  <span className="text-[#526858]">
                    {item.name} × {item.quantity} {item.unit}
                  </span>
                  <span className="font-bold text-[#315640]">{peso(item.priceCents * item.quantity)}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-between font-bold text-[#315640]">
              <span>Estimated total</span>
              <span>{peso(totalCents)}</span>
            </div>
            {sellerMap.size > 1 && (
              <p className="mt-3 text-xs leading-5 text-[#4d6854]">
                You will place {sellerMap.size} separate orders—one per seller.
              </p>
            )}
            <button
              type="button"
              className="agri-button mt-5 w-full"
              disabled={!canSubmit || createOrder.isPending}
              onClick={() => void submitOrder()}
            >
              {submitting || createOrder.isPending ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <ShoppingBag size={16} />
              )}{" "}
              Place {sellerMap.size > 1 ? `${sellerMap.size} orders` : "order"}
            </button>
            {!allOnlineHaveReceipt && (
              <p className="mt-3 text-xs text-[#8c574c]">
                <Upload className="mr-1 inline" size={12} />
                Upload a receipt for each seller group using online payment.
              </p>
            )}
          </aside>
        </div>
      </main>
    </PageFrame>
  );
}