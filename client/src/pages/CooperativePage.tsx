import { ListingOptionBadges } from "@/components/ListingOptionBadges";
import { PageFrame, shellContainerClass } from "@/components/AgriShell";
import { ProductImage } from "@/components/ProductImage";
import { resolveProductImageSrc } from "@/lib/productImages";
import { trpc } from "@/lib/trpc";
import { toUserFacingErrorMessage } from "@shared/userFacingErrors";
import { cooperativePickupAddressLine, hasStructuredPickupAddress, isPickupAddressComplete } from "@shared/pickupAddress";
import { ArrowLeft, Leaf, Loader2 } from "lucide-react";
import { Link, useRoute } from "wouter";

const peso = (cents: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(cents / 100);

type CoopProduct = {
  id: number;
  name: string;
  variety?: string | null;
  category?: string | null;
  unit?: string | null;
  priceCents: number;
  primaryImageUrl?: string | null;
  allowsPickup?: boolean | null;
  allowsDelivery?: boolean | null;
  acceptsOnlinePayment?: boolean | null;
};

type CooperativeBySlugPayload = {
  cooperative: {
    id: number;
    name: string;
    location: string;
    slug?: string | null;
    description?: string | null;
    status?: string | null;
    address?: string | null;
    pickupContactNumber?: string | null;
    pickupInstructions?: string | null;
    operatingHours?: string | null;
    pickupProvince?: string | null;
    pickupCity?: string | null;
    pickupBarangay?: string | null;
    pickupStreetAddress?: string | null;
  };
  products: CoopProduct[];
};

type QueryErrorLike = { data?: { code?: string } | null; message?: string } | null;

type BySlugHook = {
  useQuery: (
    input: { slug: string },
    opts?: { enabled?: boolean },
  ) => {
    data: CooperativeBySlugPayload | undefined;
    isLoading: boolean;
    isFetching: boolean;
    error: QueryErrorLike;
    refetch: () => unknown;
  };
};

function useCooperativeBySlug(slug: string, enabled: boolean) {
  return trpc.cooperatives.bySlug.useQuery({ slug }, { enabled });
}

function isNotFound(error: QueryErrorLike) {
  return error?.data?.code === "NOT_FOUND";
}

export default function CooperativePage() {
  const [match, params] = useRoute("/cooperatives/:slug");
  const slug = (match ? params?.slug : "")?.trim() ?? "";
  const validSlug = slug.length > 0;

  const { data, isLoading, isFetching, error, refetch } = useCooperativeBySlug(slug, validSlug);

  if (!validSlug || (!isLoading && !error && !data) || isNotFound(error)) {
    return (
      <PageFrame>
        <main className={`${shellContainerClass} py-10`}>
          <div className="agri-card mx-auto max-w-xl p-5 sm:p-6 text-center">
            <Leaf className="mx-auto text-[#6d9852]" />
            <h1 className="mt-4 font-display text-3xl font-bold text-[#254f37]">Cooperative not found</h1>
            <p className="mt-3 text-[#65766b]">
              {toUserFacingErrorMessage(
                error?.message,
                "We could not find a cooperative for this link. It may be inactive or the address is incorrect.",
              )}
            </p>
            <Link href="/marketplace" className="agri-button mt-5 inline-flex min-h-11 text-sm no-underline">
              <ArrowLeft size={16} /> Back to marketplace
            </Link>
          </div>
        </main>
      </PageFrame>
    );
  }

  if (error) {
    return (
      <PageFrame>
        <main className={`${shellContainerClass} py-10`}>
          <div className="agri-card mx-auto max-w-xl p-5 sm:p-6 text-center">
            <h1 className="font-display text-3xl font-bold text-[#254f37]">Cooperative page unavailable</h1>
            <p role="alert" className="mt-3 text-[#65766b]">{toUserFacingErrorMessage(error.message)}</p>
            <button type="button" className="agri-button mt-5 min-h-11" disabled={isFetching} onClick={() => void refetch()}>
              <Loader2 className={isFetching ? "animate-spin" : ""} size={16} /> Retry
            </button>
            <Link href="/marketplace" className="agri-ghost mt-3 inline-flex min-h-11 text-sm no-underline">
              <ArrowLeft size={16} /> Back to marketplace
            </Link>
          </div>
        </main>
      </PageFrame>
    );
  }

  if (isLoading || !data) {
    return (
      <PageFrame>
        <main className={`${shellContainerClass} grid min-h-[50vh] place-items-center py-16`}>
          <Loader2 className="animate-spin text-[#4e8257]" aria-label="Loading" />
        </main>
      </PageFrame>
    );
  }

  const { cooperative, products } = data;

  return (
    <PageFrame>
      <main className={`${shellContainerClass} py-8`}>
        <nav className="mb-5 text-xs font-bold text-[#66806b]" aria-label="Breadcrumb">
          <Link href="/" className="no-underline hover:text-[#1f5a3c]">Home</Link>
          <span className="mx-2">/</span>
          <Link href="/marketplace" className="no-underline hover:text-[#1f5a3c]">Marketplace</Link>
          <span className="mx-2">/</span>
          <span className="text-[#214b35]">{cooperative.name}</span>
        </nav>

        <section className="agri-card p-5 sm:p-6">
          <p className="text-sm font-extrabold uppercase tracking-[.13em] text-[#668d49]">Cooperative</p>
          <h1 className="mt-1 font-display text-3xl font-bold text-[#244e36]">{cooperative.name}</h1>
          <p className="mt-2 text-[#65766b]">{cooperative.location}</p>
          {cooperative.description && (
            <p className="mt-4 max-w-3xl leading-7 text-[#66766b]">{cooperative.description}</p>
          )}
          {(cooperative.address || cooperative.location || cooperative.pickupContactNumber || cooperative.pickupInstructions || cooperative.operatingHours || hasStructuredPickupAddress(cooperative)) && (
            <div className="mt-5 rounded-xl bg-[#f2f6ef] p-4 text-sm text-[#45614e]">
              <p className="font-bold text-[#315640]">Pickup information</p>
              <p className="mt-1">
                {cooperativePickupAddressLine(cooperative) || "Address not yet provided"}
              </p>
              {hasStructuredPickupAddress(cooperative) && !isPickupAddressComplete(cooperative) && (
                <p className="mt-1 text-xs font-semibold text-[#8c574c]">This pickup address is incomplete — buyers are asked to confirm the exact pickup point.</p>
              )}
              {cooperative.pickupContactNumber && <p className="mt-1">Contact: {cooperative.pickupContactNumber}</p>}
              {cooperative.pickupInstructions && <p className="mt-1">Instructions: {cooperative.pickupInstructions}</p>}
              {cooperative.operatingHours && <p className="mt-1">Hours: {cooperative.operatingHours}</p>}
            </div>
          )}
        </section>

        <section className="mt-8">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl font-bold text-[#264f37]">Listings</h2>
              <p className="mt-1 text-sm text-[#6a796e]">Products currently available from this cooperative.</p>
            </div>
            <Link href="/marketplace" className="agri-ghost min-h-11 text-sm no-underline">Browse full marketplace</Link>
          </div>

          {products.length ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {products.map(product => {
                const image = resolveProductImageSrc(product.primaryImageUrl, product.name);
                return (
                  <Link
                    key={product.id}
                    href={`/products/${product.id}`}
                    className="agri-card flex flex-col overflow-hidden no-underline transition hover:border-[#abd19e]"
                  >
                    <ProductImage
                      src={image}
                      alt={product.name}
                      productName={product.name}
                      width={640}
                      height={384}
                      className="aspect-[4/3] w-full object-cover"
                    />
                    <div className="flex flex-1 flex-col p-4">
                      {product.category && (
                        <span className="w-fit rounded-full bg-[#edf3e9] px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-[#487249]">
                          {product.category}
                        </span>
                      )}
                      <h3 className="mt-2 font-display text-xl font-bold text-[#214b35]">{product.name}</h3>
                      {product.variety && <p className="mt-1 text-sm text-[#57715e]">{product.variety}</p>}
                      <p className="mt-3 font-display text-lg font-bold text-[#1d5639]">
                        {peso(product.priceCents)}
                        {product.unit ? <span className="font-sans text-sm font-semibold text-[#57715e]"> / {product.unit}</span> : null}
                      </p>
                      <ListingOptionBadges
                        className="mt-3"
                        allowsPickup={product.allowsPickup}
                        allowsDelivery={product.allowsDelivery}
                      />
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="agri-card grid min-h-52 place-items-center p-5 sm:p-6 text-center">
              <div>
                <Leaf className="mx-auto text-[#6d9852]" />
                <h3 className="mt-3 font-display text-2xl font-bold text-[#254f37]">No listings yet</h3>
                <p className="mt-2 text-sm text-[#65766b]">
                  This cooperative does not have published products available right now. Check back soon or browse the full marketplace.
                </p>
                <Link href="/marketplace" className="agri-button mt-5 inline-flex min-h-11 text-sm no-underline">
                  Browse marketplace
                </Link>
              </div>
            </div>
          )}
        </section>
      </main>
    </PageFrame>
  );
}
