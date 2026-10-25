import { WorkspaceHeader } from "@/components/AgriShell";
import { trpc } from "@/lib/trpc";
import { getProductImageUrl } from "@/lib/productImages";
import { ArrowLeft, Loader2, Package } from "lucide-react";
import { Link, useParams } from "wouter";

const peso = (cents: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(cents / 100);

export default function ProductDetails() {
  const { id } = useParams<{ id: string }>();
  const productId = id ?? "";
  const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(productId);
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
  return <><WorkspaceHeader title="Product details" description="Review the crop, unit price, available stock, and seller before ordering."/><main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8"><Link href="/marketplace" className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-[#456b4d] no-underline"><ArrowLeft size={16}/> Back to marketplace</Link><article className="agri-card grid overflow-hidden md:grid-cols-2"><img src={product.primaryImageUrl || getProductImageUrl(product.name)} alt={product.name} className="h-72 w-full object-cover md:h-full md:min-h-[500px]"/><div className="p-6 sm:p-9"><span className="rounded-full bg-[#edf3e9] px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-[#487249]">{product.category}</span><h1 className="mt-4 font-display text-4xl font-bold text-[#214b35]">{product.name}</h1><p className="mt-3 text-lg font-semibold text-[#57715e]">Variety: {product.variety}</p><p className="mt-5 whitespace-pre-wrap leading-7 text-[#66766b]">{product.description}</p><div className="mt-7 grid gap-4 rounded-2xl bg-[#f2f6ef] p-5 sm:grid-cols-2"><div><p className="text-xs font-bold uppercase tracking-wide text-[#718174]">Price</p><p className="mt-1 font-display text-2xl font-bold text-[#1d5639]">{peso(product.priceCents)} <span className="font-sans text-sm">per {product.unit}</span></p></div><div><p className="text-xs font-bold uppercase tracking-wide text-[#718174]">Available stock</p><p className="mt-1 font-display text-2xl font-bold text-[#1d5639]">{product.stockQty} {product.unit}</p></div><div><p className="text-xs font-bold uppercase tracking-wide text-[#718174]">Minimum order</p><p className="mt-1 font-display text-2xl font-bold text-[#1d5639]">{product.minOrderQty} {product.unit}</p></div><div><p className="text-xs font-bold uppercase tracking-wide text-[#718174]">Seller</p><p className="mt-1 font-bold text-[#315640]">{sellerName || "Verified seller"}</p><p className="text-sm text-[#718174]">{cooperativeName || "Individual seller"}</p></div></div><Link href="/marketplace" className="agri-button mt-7 inline-flex text-sm no-underline"><Package size={16}/> Return to order</Link></div></article></main></>;
}
