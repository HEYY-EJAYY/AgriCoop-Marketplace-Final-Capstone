import { WorkspaceHeader } from "@/components/AgriShell";
import { trpc } from "@/lib/trpc";
import { getProductImageUrl } from "@/lib/productImages";
import { ArrowLeft, Loader2, Package } from "lucide-react";
import { Link, useParams } from "wouter";
import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { goToAuth } from "@/const";

const peso = (cents: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(cents / 100);

export default function ProductDetails() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [quantity, setQuantity] = useState(1);
  const order = trpc.orders.create.useMutation({
    onSuccess: () => { toast.success("Order submitted. Follow its progress in My activity."); void utils.orders.buyerMine.invalidate(); window.location.assign("/activity"); },
    onError: error => toast.error(error.message),
  });
  const { id } = useParams<{ id: string }>();
  const productId = Number(id);
  const validId = Number.isSafeInteger(productId) && productId > 0;
  const { data: listing, isLoading, error } = trpc.marketplace.byId.useQuery(
    { id: productId },
    { enabled: validId },
  );

  if (!validId || (!isLoading && (error || !listing))) {
    return <><WorkspaceHeader title="Product details" description="This marketplace listing is unavailable."/><main className="mx-auto max-w-3xl px-4 py-10"><div className="agri-card p-8 text-center"><h1 className="font-display text-3xl font-bold text-[#254f37]">Listing not found</h1><p className="mt-3 text-[#65766b]">{error?.message || "This product is not currently available."}</p><Link href="/marketplace" className="agri-button mt-5 inline-flex text-sm no-underline"><ArrowLeft size={16}/> Back to marketplace</Link></div></main></>;
  }

  if (isLoading || !listing) {
    return <div className="grid min-h-screen place-items-center bg-[#f8f5ee]"><Loader2 className="animate-spin text-[#4e8257]"/></div>;
  }

  const { product, sellerName, cooperativeName } = listing;
  const minimum = product.minOrderQty;
  const orderQuantity = Math.max(minimum, quantity);
  const cannotOrder = product.stockQty < minimum || orderQuantity > product.stockQty || user?.id === product.sellerId;
  return <><WorkspaceHeader title="Product details" description="Review the crop, unit price, available stock, and seller before ordering."/><main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8"><Link href="/marketplace" className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-[#456b4d] no-underline"><ArrowLeft size={16}/> Back to marketplace</Link><article className="agri-card grid overflow-hidden md:grid-cols-2"><img src={product.primaryImageUrl || getProductImageUrl(product.name)} alt={product.name} className="h-72 w-full object-cover md:h-full md:min-h-[500px]"/><div className="p-6 sm:p-9"><span className="rounded-full bg-[#edf3e9] px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-[#487249]">{product.category}</span><h1 className="mt-4 font-display text-4xl font-bold text-[#214b35]">{product.name}</h1><p className="mt-3 text-lg font-semibold text-[#57715e]">Variety: {product.variety}</p><p className="mt-5 whitespace-pre-wrap leading-7 text-[#66766b]">{product.description}</p><div className="mt-7 grid gap-4 rounded-2xl bg-[#f2f6ef] p-5 sm:grid-cols-2"><div><p className="text-xs font-bold uppercase tracking-wide text-[#718174]">Price</p><p className="mt-1 font-display text-2xl font-bold text-[#1d5639]">{peso(product.priceCents)} <span className="font-sans text-sm">per {product.unit}</span></p></div><div><p className="text-xs font-bold uppercase tracking-wide text-[#718174]">Available stock</p><p className="mt-1 font-display text-2xl font-bold text-[#1d5639]">{product.stockQty} {product.unit}</p></div><div><p className="text-xs font-bold uppercase tracking-wide text-[#718174]">Minimum order</p><p className="mt-1 font-display text-2xl font-bold text-[#1d5639]">{product.minOrderQty} {product.unit}</p></div><div><p className="text-xs font-bold uppercase tracking-wide text-[#718174]">Seller</p><p className="mt-1 font-bold text-[#315640]">{sellerName || "Verified seller"}</p><p className="text-sm text-[#718174]">{cooperativeName || "Individual seller"}</p></div></div><label className="field-label mt-6">Quantity ({product.unit})<input className="field-control" type="number" min={minimum} max={product.stockQty} step="1" value={Math.max(minimum, quantity)} onChange={event => setQuantity(Number(event.target.value))}/></label><p className="mt-2 flex justify-between text-sm font-bold text-[#315640]"><span>Order total</span><span>{peso(product.priceCents * orderQuantity)}</span></p><div className="mt-5 flex flex-wrap gap-3"><button className="agri-button text-sm" disabled={order.isPending || cannotOrder} onClick={() => { if (!user) return goToAuth(); order.mutate({ items: [{ productId: product.id, quantity: orderQuantity }], buyerNote: "Please confirm availability and arrange a face-to-face handover." }); }}>{order.isPending ? <Loader2 className="animate-spin" size={16}/> : <Package size={16}/>} Order now</button><Link href="/marketplace" className="agri-ghost text-sm no-underline">Continue shopping</Link></div>{cannotOrder && <p className="mt-3 text-sm text-[#a34838]">{user?.id === product.sellerId ? "You cannot order your own listing." : "This listing cannot meet the minimum quantity right now."}</p>}</div></article></main></>;
}
