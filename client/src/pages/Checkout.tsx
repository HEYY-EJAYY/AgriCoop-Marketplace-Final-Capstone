import { PageFrame, shellContainerClass } from "@/components/AgriShell";
import { useAuth } from "@/_core/hooks/useAuth";
import { goToAuth } from "@/const";
import { supabase } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";
import {
  groupCartItemsBySeller,
  type CheckoutCartItem,
} from "../../../shared/checkoutCart";
import { getAccountAccessRestriction } from "../../../shared/accountAccess";
import { useBuyerCart } from "@/hooks/useBuyerCart";
import {
  defaultFulfillmentForPayment,
  fulfillmentOptionsForListings,
  methodsForListings,
  paymentMethodAvailability,
  PAYMENT_METHODS,
  PAYMENT_METHOD_HELPERS,
  paymentMethodLabel,
  type FulfillmentMethod,
  type PaymentMethod,
  type SystemPaymentAvailability,
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
  receiptUploadIntent?: string;
};

type CheckoutOnlineDetails = {
  qrImageUrl: string;
  accountName: string;
  accountNumber: string;
  label: string;
  instructions?: string | null;
};

const checkoutAvailabilityFallback: SystemPaymentAvailability = {
  cashPickupEnabled: true,
  cashDeliveryEnabled: true,
  onlineEnabled: false,
  onlineAccountReady: false,
};

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
    onlinePaymentEnabled: item.onlinePaymentEnabled !== false,
  }));
}

function SellerCheckoutGroup({
  sellerId,
  sellerName,
  items,
  choice,
  onChoiceChange,
  availability,
  onlineDetails,
  onlineLoading,
}: {
  sellerId: number;
  sellerName: string;
  items: CheckoutCartItem[];
  choice: SellerGroupChoice;
  onChoiceChange: (next: SellerGroupChoice) => void;
  availability: SystemPaymentAvailability;
  onlineDetails?: CheckoutOnlineDetails | null;
  onlineLoading: boolean;
}) {
  const flags = useMemo(() => listingFlags(items), [items]);
  const methods = useMemo(() => methodsForListings(flags, availability), [flags, availability]);
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
      onChoiceChange({ paymentMethod, fulfillmentMethod: fulfillment, receiptUploadIntent: undefined });
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
      receiptUploadIntent: paymentMethod === "online" ? choice.receiptUploadIntent : undefined,
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
      onChoiceChange({ ...choice, receiptUploadIntent: finalized.receiptUploadIntent });
      toast.success("Receipt uploaded for this seller group.");
    } catch (problem) {
      const message = toUserFacingErrorMessage(problem instanceof Error ? problem.message : "Upload failed.");
      setReceiptError(message);
      toast.error(message);
      onChoiceChange({ ...choice, receiptUploadIntent: undefined });
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
      onChoiceChange({ ...choice, receiptUploadIntent: undefined });
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
        <fieldset className="min-w-0">
          <legend className="text-xs font-extrabold uppercase tracking-wide text-[#638947]">Payment</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {PAYMENT_METHODS.map(method => {
            const methodAvailability = paymentMethodAvailability(method, flags, availability);
            const reasonId = `payment-${sellerId}-${method}-reason`;
            return (
              <label
                key={method}
                className={`rounded-xl border p-3 text-sm font-bold ${
                  methodAvailability.available ? "cursor-pointer" : "cursor-not-allowed opacity-70"
                } ${
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
                  disabled={!methodAvailability.available}
                  aria-describedby={methodAvailability.reason ? reasonId : undefined}
                  onChange={() => setPaymentMethod(method)}
                />
                {checkoutMethodLabel(method)}
                {methodAvailability.reason && (
                  <span id={reasonId} className="mt-1 block text-xs font-normal leading-5">
                    {methodAvailability.reason}
                  </span>
                )}
              </label>
            );
          })}
        </div>
        {choice.paymentMethod && (
          <p className="mt-2 text-xs leading-5 text-[#4d6854]">{PAYMENT_METHOD_HELPERS[choice.paymentMethod]}</p>
        )}
        </fieldset>
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
          <h4 className="font-bold text-[#315640]">Pay via AgriCoop QR</h4>
          <p className="mt-1 text-xs text-[#66766b]">A cooperative officer verifies the receipt before the seller fulfills the order.</p>
          {onlineLoading ? (
            <Loader2 className="mt-4 animate-spin text-[#4e8257]" />
          ) : (
            <>
              {onlineDetails?.qrImageUrl ? (
                <img
                  src={onlineDetails.qrImageUrl}
                  alt="AgriCoop payment QR"
                  className="mt-3 h-32 w-32 rounded-lg border border-[#e2e8de] object-contain"
                />
              ) : (
                <div className="mt-3 grid h-32 w-32 place-items-center rounded-lg bg-[#f0f5ed] text-[#82987a]">
                  <QrCode />
                </div>
              )}
              {onlineDetails?.instructions && (
                <p className="mt-3 text-xs leading-5 text-[#4d6854]">{onlineDetails.instructions}</p>
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
              {choice.receiptUploadIntent && (
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
  const { items: cartItems, isCartLoading, remove: removeCartItem } = useBuyerCart();
  const cart = useMemo(
    () => (cartItems.length ? { items: cartItems as CheckoutCartItem[] } : null),
    [cartItems],
  );
  const sellerMap = useMemo(() => (cart ? groupCartItemsBySeller(cart.items) : new Map()), [cart]);

  const availabilityQuery = trpc.systemPayment.getAvailability.useQuery(undefined, {
    enabled: Boolean(user && (user.role === "buyer" || user.role === "seller")),
  });
  const availability = availabilityQuery.data ?? checkoutAvailabilityFallback;
  const onlineDetailsQuery = trpc.systemPayment.getCheckoutOnlineDetails.useQuery(undefined, {
    enabled: Boolean(user?.role === "buyer" && availability.onlineEnabled && availability.onlineAccountReady),
    retry: false,
  });

  const initialChoices = useMemo(() => {
    const map = new Map<number, SellerGroupChoice>();
    Array.from(sellerMap.entries()).forEach(([sellerId, items]) => {
      const flags = listingFlags(items);
      const methods = methodsForListings(flags, availability);
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
  }, [sellerMap, availability]);

  const [choices, setChoices] = useState<Map<number, SellerGroupChoice>>(initialChoices);
  const [delivery, setDelivery] = useState({
    recipientName: "",
    contactNumber: "",
    province: "",
    city: "",
    barangay: "",
    streetAddress: "",
    instructions: "",
  });

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
      choice => choice.paymentMethod !== "online" || Boolean(choice.receiptUploadIntent),
    );
  }, [choices]);

  const allChoicesAvailable = Array.from(sellerMap.entries()).every(([sellerId, items]) => {
    const choice = choices.get(sellerId);
    return Boolean(choice && methodsForListings(listingFlags(items), availability).includes(choice.paymentMethod));
  });
  const needsCodAddress = Array.from(choices.values()).some(choice => choice.paymentMethod === "cash_delivery");
  const codAddressComplete = Boolean(
    delivery.recipientName.trim().length >= 2
    && delivery.contactNumber.trim().length >= 7
    && delivery.province.trim().length >= 2
    && delivery.city.trim().length >= 2
    && delivery.barangay.trim().length >= 2
    && delivery.streetAddress.trim().length >= 5,
  );
  const deliveryPayload = {
    recipientName: delivery.recipientName.trim(),
    contactNumber: delivery.contactNumber.trim(),
    province: delivery.province.trim(),
    city: delivery.city.trim(),
    barangay: delivery.barangay.trim(),
    streetAddress: delivery.streetAddress.trim(),
    instructions: delivery.instructions.trim() || undefined,
  };
  const canSubmit = Boolean(
    cart
    && choices.size === sellerMap.size
    && allChoicesAvailable
    && allOnlineHaveReceipt
    && (!needsCodAddress || codAddressComplete)
    && !submitting
    && !isCartLoading,
  );

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
        if (choice.paymentMethod === "online" && !choice.receiptUploadIntent) {
          throw new Error("Upload a payment receipt for each online payment group.");
        }
        const result = await createOrder.mutateAsync({
          items: items.map((item: CheckoutCartItem) => ({ productId: item.productId, quantity: item.quantity })),
          paymentMethod: choice.paymentMethod,
          fulfillmentMethod: choice.fulfillmentMethod,
          receiptUploadIntent: choice.receiptUploadIntent,
          deliveryDetails: choice.paymentMethod === "cash_delivery" ? deliveryPayload : undefined,
          buyerNote:
            choice.paymentMethod === "online"
              ? "Buyer paid via the AgriCoop QR; receipt attached at checkout."
              : "Please confirm availability and arrange the selected cash handover.",
        });
        createdIds.push(result.orderId);
      }
      await Promise.all(cart.items.map(item => removeCartItem(item.productId).catch(() => undefined)));
      void utils.cart.mine.invalidate();
      void utils.cart.count.invalidate();
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
        <main className={`${shellContainerClass} py-16 text-center`}>
          <h1 className="font-display text-3xl font-bold text-[#244e36]">Sign in to continue checkout</h1>
          <p className="mt-3 text-[#5c6c60]">Your saved order stays on your account after you sign in.</p>
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
        <main className={`${shellContainerClass} py-16 text-center`}>
          <h1 className="font-display text-3xl font-bold text-[#244e36]">Marketplace checkout unavailable</h1>
          <p className="mt-3 text-[#5c6c60]">
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
  if (isCartLoading) {
    return (
      <PageFrame>
        <main className={`${shellContainerClass} py-16 text-center`} role="status">
          <Loader2 className="mx-auto animate-spin text-[#4e8257]" size={28} aria-hidden />
          <h1 className="mt-4 font-display text-3xl font-bold text-[#244e36]">Loading your order…</h1>
        </main>
      </PageFrame>
    );
  }
  if (!cart) {
    return (
      <PageFrame>
        <main className={`${shellContainerClass} py-16 text-center`}>
          <h1 className="font-display text-3xl font-bold text-[#244e36]">Your checkout basket is empty</h1>
          <p className="mt-3 text-[#5c6c60]">Return to the marketplace and add items to your order.</p>
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
        <p className="mt-2 text-sm text-[#5c6c60]">
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
                  availability={availability}
                  onlineDetails={onlineDetailsQuery.data}
                  onlineLoading={onlineDetailsQuery.isLoading}
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
            {needsCodAddress && (
              <div className="mt-5 rounded-xl border border-[#e2e9dd] bg-[#f7faf5] p-4">
                <h3 className="text-sm font-bold text-[#315640]">Delivery address for cash on delivery</h3>
                <p className="mt-1 text-xs text-[#6c7c70]">Required before you can submit. This address is saved with the order.</p>
                <div className="mt-3 grid gap-3">
                  <label className="field-label text-xs">Recipient name
                    <input className="field-control" value={delivery.recipientName} onChange={event => setDelivery({ ...delivery, recipientName: event.target.value })} />
                  </label>
                  <label className="field-label text-xs">Contact number
                    <input className="field-control" inputMode="tel" value={delivery.contactNumber} onChange={event => setDelivery({ ...delivery, contactNumber: event.target.value })} />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="field-label text-xs">Province / region
                      <input className="field-control" value={delivery.province} onChange={event => setDelivery({ ...delivery, province: event.target.value })} />
                    </label>
                    <label className="field-label text-xs">City / municipality
                      <input className="field-control" value={delivery.city} onChange={event => setDelivery({ ...delivery, city: event.target.value })} />
                    </label>
                  </div>
                  <label className="field-label text-xs">Barangay
                    <input className="field-control" value={delivery.barangay} onChange={event => setDelivery({ ...delivery, barangay: event.target.value })} />
                  </label>
                  <label className="field-label text-xs">Street, house no., subdivision
                    <input className="field-control" value={delivery.streetAddress} onChange={event => setDelivery({ ...delivery, streetAddress: event.target.value })} />
                  </label>
                  <label className="field-label text-xs">Delivery instructions (optional)
                    <input className="field-control" value={delivery.instructions} onChange={event => setDelivery({ ...delivery, instructions: event.target.value })} />
                  </label>
                </div>
                {!codAddressComplete && <p className="mt-2 text-xs text-[#8c574c]">Complete all required address fields to place a cash-on-delivery order.</p>}
              </div>
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