import { shellContainerClass, WorkspaceHeader } from "@/components/AgriShell";
import { trpc } from "@/lib/trpc";
import { ProductImage } from "@/components/ProductImage";
import { resolveProductImageSrc } from "@/lib/productImages";
import { toUserFacingErrorMessage } from "@shared/userFacingErrors";
import { ArrowLeft, Loader2, Package, ShoppingBag } from "lucide-react";
import { Link, useParams } from "wouter";
import { useState } from "react";

const peso = (cents: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(cents / 100);

export default function ProductDetails() {
  const { id } = useParams<{ id: string }>();
  const productId = Number(id);
  const validId = Number.isSafeInteger(productId) && productId > 0;
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const { data: listing, isLoading, error, isFetching, refetch } = trpc.marketplace.byId.useQuery(
    { id: productId },
    { enabled: validId },
  );

  if (!validId || (!isLoading && !error && !listing)) {
    return <><WorkspaceHeader title="Product details" description="This marketplace listing is unavailable."/><main className="mx-auto max-w-3xl px-4 py-10"><div className="agri-card p-8 text-center"><h1 className="font-display text-3xl font-bold text-[#254f37]">Listing not found</h1><p className="mt-3 text-[#65766b]">{toUserFacingErrorMessage(error?.message, "This product is not currently available.")}</p><Link href="/marketplace" className="agri-button mt-5 inline-flex min-h-11 text-sm no-underline"><ArrowLeft size={16}/> Back to marketplace</Link></div></main></>;
  }

  if (error) {
    return <><WorkspaceHeader title="Product details" description="The marketplace could not load this listing."/><main className="mx-auto max-w-3xl px-4 py-10"><div className="agri-card p-8 text-center"><h1 className="font-display text-3xl font-bold text-[#254f37]">Product details are unavailable</h1><p role="alert" className="mt-3 text-[#65766b]">{toUserFacingErrorMessage(error.message)}</p><button type="button" className="agri-button mt-5 min-h-11" disabled={isFetching} onClick={() => void refetch()}><Loader2 className={isFetching ? "animate-spin" : ""} size={16}/> Retry</button><Link href="/marketplace" className="agri-ghost mt-3 inline-flex min-h-11 text-sm no-underline"><ArrowLeft size={16}/> Back to marketplace</Link></div></main></>;
  }

  if (isLoading || !listing) {
    return <div className="grid min-h-screen place-items-center bg-[#f8f5ee]"><Loader2 className="animate-spin text-[#4e8257]"/></div>;
  }

  const { product, sellerName, cooperativeName } = listing;
  const imageUrls = (product.imageUrls?.length
    ? product.imageUrls
    : product.primaryImageUrl
      ? [product.primaryImageUrl]
      : [null]
  ).map(url => resolveProductImageSrc(url, product.name));
  const selectedImageUrl = imageUrls[selectedImageIndex] ?? imageUrls[0];
  const outOfStock = product.stockQty === 0;
  return <>
    <WorkspaceHeader title="Product details" description="Review the crop, unit price, available stock, and seller before ordering."/>
    <main className={`${shellContainerClass} py-8`}>
      <nav className="mb-5 text-xs font-bold text-[#66806b]" aria-label="Breadcrumb">
        <Link href="/" className="no-underline hover:text-[#1f5a3c]">Home</Link>
        <span className="mx-2">/</span>
        <Link href="/marketplace" className="no-underline hover:text-[#1f5a3c]">Marketplace</Link>
        <span className="mx-2">/</span>
        <span className="text-[#214b35]">{product.name}</span>
      </nav>
      <article className="agri-card grid overflow-hidden md:grid-cols-2">
        <div className="p-4">
          <ProductImage
            src={selectedImageUrl}
            alt={`${product.name} image ${selectedImageIndex + 1}`}
            productName={product.name}
            width={960}
            height={720}
            eager
            className="h-72 w-full rounded-xl object-cover md:h-[500px]"
          />
          {imageUrls.length > 1 && <div className="mt-3 grid grid-cols-5 gap-2">
            {imageUrls.map((imageUrl, index) => <button key={`${imageUrl}-${index}`} type="button" aria-label={`Show product image ${index + 1}`} aria-pressed={index === selectedImageIndex} onClick={() => setSelectedImageIndex(index)} className={`min-h-11 overflow-hidden rounded-lg border-2 ${index === selectedImageIndex ? "border-[#47774e]" : "border-transparent"}`}>
              <ProductImage src={imageUrl} alt="" productName={product.name} width={160} height={160} className="h-16 w-full object-cover" />
            </button>)}
          </div>}
        </div>
        <div className="p-6 sm:p-9">
          <span className="rounded-full bg-[#edf3e9] px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-[#487249]">{product.category}</span>
          <h1 className="mt-4 font-display text-4xl font-bold text-[#214b35]">{product.name}</h1>
          <p className="mt-3 text-lg font-semibold text-[#57715e]">Variety: {product.variety}</p>
          <p className="mt-5 whitespace-pre-wrap leading-7 text-[#66766b]">{product.description}</p>
          <div className="mt-7 grid gap-4 rounded-2xl bg-[#f2f6ef] p-5 sm:grid-cols-2">
            <div><p className="text-xs font-bold uppercase tracking-wide text-[#718174]">Price</p><p className="mt-1 font-display text-2xl font-bold text-[#1d5639]">{peso(product.priceCents)} <span className="font-sans text-sm">per {product.unit}</span></p></div>
            <div><p className="text-xs font-bold uppercase tracking-wide text-[#718174]">Available stock</p><p className="mt-1 font-display text-2xl font-bold text-[#1d5639]">{product.stockQty} {product.unit}</p></div>
            <div><p className="text-xs font-bold uppercase tracking-wide text-[#718174]">Minimum order</p><p className="mt-1 font-display text-2xl font-bold text-[#1d5639]">{product.minOrderQty} {product.unit}</p></div>
            <div><p className="text-xs font-bold uppercase tracking-wide text-[#718174]">Seller</p><p className="mt-1 font-bold text-[#315640]">{sellerName || "Verified seller"}</p><p className="text-sm text-[#718174]">{cooperativeName || "Individual seller"}</p></div>
          </div>
          <div className="mt-7 hidden gap-3 sm:flex">
            <Link href="/marketplace#order" className={`agri-button inline-flex min-h-11 flex-1 justify-center text-sm no-underline ${outOfStock ? "pointer-events-none opacity-50" : ""}`}><Package size={16}/> Add via marketplace basket</Link>
            <Link href="/marketplace" className={`agri-ghost inline-flex min-h-11 flex-1 justify-center text-sm no-underline ${outOfStock ? "pointer-events-none opacity-50" : ""}`}><ShoppingBag size={16}/> Buy from listings</Link>
          </div>
          <p className="mt-3 text-xs leading-5 text-[#6a796e]">Orders are prepared in the marketplace basket so quantity rules and single-seller bulk constraints stay consistent.</p>
        </div>
      </article>
      <div className="fixed inset-x-0 bottom-16 z-30 border-t border-[#dce4d6] bg-[#fffdf8]/97 p-3 backdrop-blur sm:hidden">
        <div className="mx-auto flex max-w-lg gap-2">
          <Link href="/marketplace#order" className={`agri-button inline-flex min-h-11 flex-1 justify-center text-sm no-underline ${outOfStock ? "pointer-events-none opacity-50" : ""}`}>Add to basket</Link>
          <Link href="/marketplace" className={`agri-ghost inline-flex min-h-11 flex-1 justify-center text-sm no-underline ${outOfStock ? "pointer-events-none opacity-50" : ""}`}>Browse</Link>
        </div>
      </div>
    </main>
  </>;
}
