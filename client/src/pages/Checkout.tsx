import { PageFrame } from "@/components/AgriShell";
import { useAuth } from "@/_core/hooks/useAuth";
import { goToAuth } from "@/const";
import { trpc } from "@/lib/trpc";
import { CHECKOUT_CART_STORAGE_KEY, checkoutCartSchema } from "../../../shared/checkoutCart";
import { getAccountAccessRestriction } from "../../../shared/accountAccess";
import { ArrowLeft, CheckCircle2, Loader2, QrCode, ShoppingBag } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Link, useLocation } from "wouter";

type CheckoutPaymentMethod = "cash_pickup" | "cash_delivery" | "gcash";

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

const peso = (cents: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(cents / 100);

export default function Checkout() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  const [cart] = useState(readCheckoutCart);
  const [paymentMethod, setPaymentMethod] = useState<CheckoutPaymentMethod>(cart?.paymentMethod ?? "cash_pickup");
  const [selectedOptionId, setSelectedOptionId] = useState<number | null>(null);
  const {
    data: paymentOptions = [],
    isLoading: optionsLoading,
    isFetching: optionsFetching,
    error: optionsError,
    refetch: refetchOptions,
  } = trpc.adminPayment.checkoutOptions.useQuery(
    {
      cooperativeId: cart?.cooperativeId ?? null,
      productIds: cart?.items.map(item => item.productId) ?? [],
    },
    { enabled: Boolean(user && cart) },
  );
  const utils = trpc.useUtils();
  const order = trpc.orders.create.useMutation({
    onSuccess: () => {
      sessionStorage.removeItem(CHECKOUT_CART_STORAGE_KEY);
      toast.success("Order submitted. The seller will confirm availability.");
      void utils.orders.buyerMine.invalidate();
      setLocation("/dashboard");
    },
    onError: error => toast.error(error.message),
  });
  const selectedOption = paymentOptions.find(option => option.id === selectedOptionId)
    ?? paymentOptions[0]
    ?? null;
  const totalCents = cart?.items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0) ?? 0;
  const accessRestriction = user ? getAccountAccessRestriction(user) : null;
  const roleCanOrder = Boolean(user && (user.role === "buyer" || user.role === "seller") && !accessRestriction);
  const canSubmit = paymentMethod !== "gcash"
    || (selectedOption !== null && !optionsLoading && !optionsError);

  const submitOrder = () => {
    if (!user) return goToAuth("Checkout.submitOrder");
    if (!roleCanOrder || !cart) return;
    if (paymentMethod === "gcash" && !selectedOption) {
      toast.error("There is no active GCash payment option for this seller.");
      return;
    }
    order.mutate({
      items: cart.items.map(item => ({ productId: item.productId, quantity: item.quantity })),
      paymentMethod,
      paymentOptionId: paymentMethod === "gcash" ? selectedOption?.id : undefined,
      buyerNote: paymentMethod === "gcash"
        ? "Buyer selected GCash. Payment proof will be submitted after order placement."
        : "Please confirm availability and arrange the selected cash handover.",
    });
  };

  if (loading) {
    return <PageFrame><div className="grid min-h-80 place-items-center"><Loader2 className="animate-spin text-[#4e8257]"/></div></PageFrame>;
  }
  if (!user) {
    return <PageFrame><main className="mx-auto max-w-xl px-4 py-16 text-center"><h1 className="font-display text-3xl font-bold text-[#244e36]">Sign in to continue checkout</h1><p className="mt-3 text-[#647568]">Your basket is kept for this browser session.</p><button className="agri-button mt-6" onClick={() => goToAuth("Checkout")}>Sign in</button></main></PageFrame>;
  }
  if (!roleCanOrder) {
    return <PageFrame><main className="mx-auto max-w-xl px-4 py-16 text-center"><h1 className="font-display text-3xl font-bold text-[#244e36]">Marketplace checkout unavailable</h1><p className="mt-3 text-[#647568]">{accessRestriction === "pending" ? "Your account is pending cooperative approval before you can place orders." : accessRestriction === "suspended" ? "This account is suspended. Contact cooperative support for help." : "Only approved Buyer and Seller accounts can place marketplace orders."}</p><Link href="/dashboard" className="agri-button mt-6 inline-flex no-underline">Return to workspace</Link></main></PageFrame>;
  }
  if (!cart) {
    return <PageFrame><main className="mx-auto max-w-xl px-4 py-16 text-center"><h1 className="font-display text-3xl font-bold text-[#244e36]">Your checkout basket is unavailable</h1><p className="mt-3 text-[#647568]">Return to the marketplace and rebuild your basket. No order was placed.</p><Link href="/marketplace" className="agri-button mt-6 inline-flex no-underline">Browse marketplace</Link></main></PageFrame>;
  }
  if (paymentMethod === "gcash" && optionsError) {
    return <PageFrame><main className="mx-auto max-w-xl px-4 py-16 text-center"><h1 className="font-display text-3xl font-bold text-[#244e36]">GCash options could not be loaded</h1><p role="alert" className="mt-3 text-[#647568]">{optionsError.message}</p><p className="mt-2 text-sm text-[#647568]">No order has been placed. Retry the request before continuing with GCash.</p><button type="button" className="agri-button mt-6" disabled={optionsFetching} onClick={() => void refetchOptions()}><Loader2 className={optionsFetching ? "animate-spin" : ""} size={16}/> Retry</button><button type="button" className="agri-ghost mt-3" onClick={() => setPaymentMethod("cash_pickup")}>Choose cash on pickup instead</button></main></PageFrame>;
  }

  return <PageFrame><main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
    <Link href="/marketplace" className="agri-ghost text-sm no-underline"><ArrowLeft size={16}/> Return to marketplace</Link>
    <h1 className="mt-5 font-display text-4xl font-bold text-[#244e36]">Review your order</h1>
    <p className="mt-2 text-sm text-[#647568]">Order totals and item availability are verified again by the server before submission.</p>
    <div className="mt-7 grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
      <section className="agri-card p-5 sm:p-6">
        <h2 className="font-display text-2xl font-bold text-[#264f37]">Payment method</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {([
            ["cash_pickup", "Cash on pickup"],
            ["cash_delivery", "Cash on delivery"],
            ["gcash", "GCash"],
          ] as const).map(([value, label]) => <label key={value} className={`cursor-pointer rounded-xl border p-4 text-sm font-bold ${paymentMethod === value ? "border-[#5d8a5e] bg-[#edf4e9] text-[#315640]" : "border-[#e3e9de] text-[#66766b]"}`}>
            <input type="radio" name="payment-method" className="mr-2 accent-[#4e8257]" value={value} checked={paymentMethod === value} onChange={() => setPaymentMethod(value)}/>{label}
          </label>)}
        </div>
        {paymentMethod === "gcash" && <div className="mt-5 rounded-2xl border border-[#e1e9dd] bg-[#f7faf4] p-4">
          <h3 className="font-bold text-[#315640]">Available QR payment options</h3>
          {optionsLoading ? <Loader2 className="mt-4 animate-spin text-[#4e8257]"/> : paymentOptions.length ? <div className="mt-3 space-y-3">{paymentOptions.map(option => <label key={option.id} className="flex cursor-pointer gap-3 rounded-xl border border-[#dfe8db] bg-white p-3">
            <input type="radio" name="payment-option" className="mt-1 accent-[#4e8257]" checked={(selectedOption?.id ?? null) === option.id} onChange={() => setSelectedOptionId(option.id)}/>
            {option.qrImageUrl ? <img src={option.qrImageUrl} alt={`${option.methodName} QR code`} className="h-24 w-24 rounded-lg border border-[#e2e8de] object-contain"/> : <div className="grid h-24 w-24 place-items-center rounded-lg bg-[#f0f5ed] text-[#82987a]"><QrCode/></div>}
            <span className="min-w-0"><span className="block font-bold text-[#315640]">{option.methodName}</span><span className="mt-1 block text-xs text-[#68796d]">{option.accountName}{option.accountNumber ? ` · ${option.accountNumber}` : ""}</span>{option.instructions && <span className="mt-1 block whitespace-pre-wrap text-xs leading-5 text-[#6a796e]">{option.instructions}</span>}</span>
          </label>)}</div> : <p className="mt-3 text-sm text-[#8c574c]">No active GCash options are configured for this seller's cooperative.</p>}
          <p className="mt-4 rounded-lg bg-[#edf3e9] p-3 text-xs leading-5 text-[#4d6854]"><CheckCircle2 className="mr-1 inline" size={14}/> Do not send payment until the order is submitted. The app does not process or verify GCash automatically.</p>
        </div>}
      </section>
      <aside className="agri-card h-fit p-5 sm:p-6">
        <h2 className="font-display text-2xl font-bold text-[#264f37]">Order summary</h2>
        <div className="mt-4 space-y-3">{cart.items.map(item => <div key={item.productId} className="flex justify-between gap-3 border-b border-[#edf0e9] pb-3 text-sm"><span className="text-[#526858]">{item.name} × {item.quantity} {item.unit}</span><span className="font-bold text-[#315640]">{peso(item.priceCents * item.quantity)}</span></div>)}</div>
        <div className="mt-4 flex justify-between font-bold text-[#315640]"><span>Estimated total</span><span>{peso(totalCents)}</span></div>
        <button className="agri-button mt-5 w-full" disabled={order.isPending || !canSubmit} onClick={submitOrder}>{order.isPending ? <Loader2 className="animate-spin" size={16}/> : <ShoppingBag size={16}/>} Place order</button>
      </aside>
    </div>
  </main></PageFrame>;
}
