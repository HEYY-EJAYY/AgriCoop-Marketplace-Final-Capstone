import { PageFrame, shellContainerClass } from "@/components/AgriShell";
import { useAuth } from "@/_core/hooks/useAuth";
import { goToAuth } from "@/const";
import { trpc } from "@/lib/trpc";
import { ProductImage } from "@/components/ProductImage";
import { toUserFacingErrorMessage } from "@shared/userFacingErrors";
import { ListingOptionBadges } from "@/components/ListingOptionBadges";
import { CHECKOUT_CART_STORAGE_KEY, hasMinimumOrderStock } from "../../../shared/checkoutCart";
import { getAccountAccessRestriction } from "../../../shared/accountAccess";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Filter,
  Loader2,
  MessageCircleMore,
  PackagePlus,
  Search,
  ShoppingBag,
  ShoppingBasket,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link, useLocation, useSearch } from "wouter";

type CartItem = {
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
};

type SortOption = "price_asc" | "price_desc" | "stock_desc" | "cooperative" | "category";

type MarketplaceParams = {
  q: string;
  category: string;
  cooperativeId: string;
  sort: SortOption;
  page: number;
};

const PAGE_SIZE = 24;
const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "stock_desc", label: "Stock: highest first" },
  { value: "cooperative", label: "Cooperative (A–Z)" },
  { value: "category", label: "Category (A–Z)" },
];
const VALID_SORT = new Set<SortOption>(SORT_OPTIONS.map(option => option.value));

const peso = (cents: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(cents / 100);

function parseMarketplaceParams(search: string): MarketplaceParams {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  const sortParam = params.get("sort");
  const sort: SortOption =
    sortParam && VALID_SORT.has(sortParam as SortOption) ? (sortParam as SortOption) : "price_asc";
  const pageRaw = parseInt(params.get("page") ?? "1", 10);
  return {
    q: params.get("q") ?? "",
    category: params.get("category") ?? "all",
    cooperativeId: params.get("cooperativeId") ?? "all",
    sort,
    page: Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1,
  };
}

function buildMarketplacePath(params: MarketplaceParams): string {
  const sp = new URLSearchParams();
  if (params.q.trim()) sp.set("q", params.q.trim());
  if (params.category !== "all") sp.set("category", params.category);
  if (params.cooperativeId !== "all") sp.set("cooperativeId", params.cooperativeId);
  if (params.sort !== "price_asc") sp.set("sort", params.sort);
  if (params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return qs ? `/marketplace?${qs}` : "/marketplace";
}

function apiSortFromOption(sort: SortOption): "asc" | "desc" {
  return sort === "price_desc" ? "desc" : "asc";
}

type ListingRow = {
  product: {
    id: number;
    sellerId: number;
    cooperativeId: number | null;
    name: string;
    category: string;
    variety: string;
    description: string;
    unit: string;
    priceCents: number;
    stockQty: number;
    minOrderQty: number;
    primaryImageUrl: string | null;
    imageUrls: string[];
    allowsPickup?: boolean;
    allowsDelivery?: boolean;
    acceptsOnlinePayment?: boolean;
  };
  sellerName: string | null;
  cooperativeName: string | null;
  cooperativeSlug?: string | null;
  sellerHasOnlineQr?: boolean;
};

function filterListings(listings: ListingRow[], params: MarketplaceParams): ListingRow[] {
  const needle = params.q.trim().toLowerCase();
  const coopFilter = params.cooperativeId !== "all" ? Number(params.cooperativeId) : null;
  return listings.filter(listing => {
    if (coopFilter != null && !Number.isNaN(coopFilter) && listing.product.cooperativeId !== coopFilter) {
      return false;
    }
    if (!needle) return true;
    const haystack = `${listing.product.name} ${listing.product.category} ${listing.sellerName || ""} ${listing.cooperativeName || ""}`.toLowerCase();
    return haystack.includes(needle);
  });
}

function sortListings(listings: ListingRow[], sort: SortOption): ListingRow[] {
  const copy = [...listings];
  switch (sort) {
    case "price_asc":
      return copy.sort((a, b) => a.product.priceCents - b.product.priceCents);
    case "price_desc":
      return copy.sort((a, b) => b.product.priceCents - a.product.priceCents);
    case "stock_desc":
      return copy.sort((a, b) => b.product.stockQty - a.product.stockQty);
    case "cooperative":
      return copy.sort((a, b) =>
        (a.cooperativeName ?? "").localeCompare(b.cooperativeName ?? "", undefined, { sensitivity: "base" }),
      );
    case "category":
      return copy.sort((a, b) =>
        a.product.category.localeCompare(b.product.category, undefined, { sensitivity: "base" }),
      );
    default:
      return copy;
  }
}

function ListingCardImage({
  product,
  eager,
}: {
  product: ListingRow["product"];
  eager: boolean;
}) {
  return (
    <ProductImage
      src={product.primaryImageUrl ?? product.imageUrls?.[0]}
      alt={product.name}
      productName={product.name}
      eager={eager}
    />
  );
}

function FilterFields({
  params,
  categories,
  cooperatives,
  onParamsChange,
  idPrefix,
}: {
  params: MarketplaceParams;
  categories: { category: string }[];
  cooperatives: { id: number; name: string }[];
  onParamsChange: (patch: Partial<MarketplaceParams>) => void;
  idPrefix: string;
}) {
  return (
  <>
      <label className="field-label" htmlFor={`${idPrefix}-search`}>
        Search
        <div className="flex items-center gap-2 rounded-xl bg-[#f3f7f0] px-3 text-[#64786a]">
          <Search size={18} aria-hidden />
          <input
            id={`${idPrefix}-search`}
            className="w-full bg-transparent py-2 text-sm outline-none placeholder:text-[#8a978c]"
            value={params.q}
            onChange={e => onParamsChange({ q: e.target.value, page: 1 })}
            placeholder="Produce, category, farmer, or cooperative"
          />
        </div>
      </label>
      <label className="field-label mt-3" htmlFor={`${idPrefix}-category`}>
        Category
        <div className="relative">
          <select
            id={`${idPrefix}-category`}
            className="field-control appearance-none pr-9"
            value={params.category}
            onChange={e => onParamsChange({ category: e.target.value, page: 1 })}
          >
            <option value="all">All categories</option>
            {categories.map(item => (
              <option key={item.category} value={item.category}>
                {item.category}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-2.5 text-[#66806b]" size={15} aria-hidden />
        </div>
      </label>
      <label className="field-label mt-3" htmlFor={`${idPrefix}-cooperative`}>
        Cooperative
        <div className="relative">
          <select
            id={`${idPrefix}-cooperative`}
            className="field-control appearance-none pr-9"
            value={params.cooperativeId}
            onChange={e => onParamsChange({ cooperativeId: e.target.value, page: 1 })}
          >
            <option value="all">All cooperatives</option>
            {cooperatives.map(coop => (
              <option key={coop.id} value={String(coop.id)}>
                {coop.name}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-2.5 text-[#66806b]" size={15} aria-hidden />
        </div>
      </label>
      <label className="field-label mt-3" htmlFor={`${idPrefix}-sort`}>
        Sort by
        <div className="relative">
          <select
            id={`${idPrefix}-sort`}
            className="field-control appearance-none pr-9"
            value={params.sort}
            onChange={e => onParamsChange({ sort: e.target.value as SortOption, page: 1 })}
          >
            {SORT_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-2.5 text-[#66806b]" size={15} aria-hidden />
        </div>
      </label>
  </>
  );
}

export default function Marketplace() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const searchString = useSearch();
  const [, setLocation] = useLocation();
  const params = useMemo(() => parseMarketplaceParams(searchString), [searchString]);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [quoteProduct, setQuoteProduct] = useState<{
    id: number;
    name: string;
    unit: string;
    priceCents: number;
    minOrderQty: number;
    stockQty: number;
  } | null>(null);
  const [quoteQty, setQuoteQty] = useState(1);
  const [quoteNote, setQuoteNote] = useState("");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const marketplaceInput = useMemo(
    () => ({
      category: params.category === "all" ? undefined : params.category,
      sort: apiSortFromOption(params.sort),
    }),
    [params.category, params.sort],
  );

  const listingsQuery = trpc.marketplace.list.useQuery(marketplaceInput, { staleTime: 60_000 });
  const { data: listings = [], isLoading } = listingsQuery;
  const categoriesQuery = trpc.marketplace.categories.useQuery(undefined, { staleTime: 5 * 60_000 });
  const { data: categories = [] } = categoriesQuery;
  const cooperativesQuery = trpc.cooperatives.listActive.useQuery(undefined, { staleTime: 5 * 60_000 });
  const { data: cooperativeCatalog = [] } = cooperativesQuery;

  const quoteMutation = trpc.quotations.request.useMutation({
    onSuccess: () => {
      setQuoteProduct(null);
      setQuoteNote("");
      toast.success("Quotation request sent.");
      utils.quotations.buyerMine.invalidate();
    },
    onError: err => toast.error(toUserFacingErrorMessage(err.message)),
  });

  const cooperatives = useMemo(() => {
    // Prefer the full active cooperative catalog so filters stay complete even when
    // a coop temporarily has no published listings (cards still use listing.cooperativeName).
    if (cooperativeCatalog.length) {
      return cooperativeCatalog
        .map(coop => ({ id: coop.id, name: coop.name }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    }
    const map = new Map<number, string>();
    for (const listing of listings) {
      const id = listing.product.cooperativeId;
      const name = listing.cooperativeName?.trim();
      if (id != null && name) map.set(id, name);
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [cooperativeCatalog, listings]);

  const processedListings = useMemo(() => {
    const filtered = filterListings(listings as ListingRow[], params);
    return sortListings(filtered, params.sort);
  }, [listings, params]);

  const totalCount = processedListings.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const safePage = Math.min(params.page, totalPages);
  const pageStart = totalCount === 0 ? 0 : (safePage - 1) * PAGE_SIZE;
  const pageListings = processedListings.slice(pageStart, pageStart + PAGE_SIZE);

  const updateParams = useCallback(
    (patch: Partial<MarketplaceParams>) => {
      const next = { ...params, ...patch };
      setLocation(buildMarketplacePath(next));
    },
    [params, setLocation],
  );

  const clearFilters = useCallback(() => {
    setLocation("/marketplace");
    setMobileFiltersOpen(false);
  }, [setLocation]);

  const accessRestriction = user ? getAccountAccessRestriction(user) : null;
  const canTrade = Boolean(user && (user.role === "buyer" || user.role === "seller") && !accessRestriction);

  const addToCart = (listing: ListingRow) => {
    const product = listing.product;
    if (!user) return goToAuth("Marketplace.addToCart");
    if (!canTrade) {
      return toast.error(
        accessRestriction === "pending"
          ? "Your account is pending cooperative approval before you can place orders."
          : "Only approved Buyer or Farmer accounts can place marketplace orders.",
      );
    }
    if (user.id === product.sellerId) return toast.error("You cannot place an order for your own listing.");
    if (!hasMinimumOrderStock(product.stockQty, product.minOrderQty)) {
      return toast.error("This listing does not currently have enough stock to meet its minimum order.");
    }
    setCart(current => {
      const existing = current.find(item => item.productId === product.id);
      if (existing) {
        return current.map(item =>
          item.productId === product.id
            ? { ...item, quantity: Math.min(item.quantity + product.minOrderQty, product.stockQty) }
            : item,
        );
      }
      return [
        ...current,
        {
          productId: product.id,
          name: product.name,
          unit: product.unit,
          quantity: product.minOrderQty,
          minOrderQty: product.minOrderQty,
          stockQty: product.stockQty,
          priceCents: product.priceCents,
          sellerId: product.sellerId,
          sellerName: listing.sellerName || "Verified seller",
          cooperativeId: product.cooperativeId,
          cooperativeName: listing.cooperativeName,
          cooperativeSlug: listing.cooperativeSlug ?? null,
          sellerHasOnlineQr: listing.sellerHasOnlineQr ?? false,
          allowsPickup: product.allowsPickup ?? true,
          allowsDelivery: product.allowsDelivery ?? true,
          acceptsOnlinePayment: product.acceptsOnlinePayment ?? false,
        },
      ];
    });
    toast.success(`${product.name} added to your order.`);
  };

  const requestQuote = (product: ListingRow["product"]) => {
    if (!user) return goToAuth("Marketplace.requestQuote");
    if (!canTrade) {
      return toast.error(
        accessRestriction === "pending"
          ? "Your account is pending cooperative approval before you can request quotations."
          : "Only approved Buyer or Farmer accounts can request quotations.",
      );
    }
    if (user.id === product.sellerId) return toast.error("You cannot request a quotation for your own listing.");
    if (!hasMinimumOrderStock(product.stockQty, product.minOrderQty)) {
      return toast.error("This listing does not currently have enough stock to meet its minimum order.");
    }
    setQuoteQty(product.minOrderQty);
    setQuoteProduct({
      id: product.id,
      name: product.name,
      unit: product.unit,
      priceCents: product.priceCents,
      minOrderQty: product.minOrderQty,
      stockQty: product.stockQty,
    });
  };

  const submitCart = () => {
    if (cart.some(item => item.quantity < item.minOrderQty || item.quantity > item.stockQty)) {
      return toast.error("Check each quantity against its minimum order and available stock.");
    }
    if (!user) return goToAuth("Marketplace.submitCart");
    if (!canTrade) {
      return toast.error(
        accessRestriction === "pending"
          ? "Your account is pending cooperative approval before checkout."
          : "Only approved Buyer or Farmer accounts can check out.",
      );
    }
    try {
      sessionStorage.setItem(
        CHECKOUT_CART_STORAGE_KEY,
        JSON.stringify({
          items: cart,
        }),
      );
      window.location.assign("/checkout");
    } catch {
      toast.error("Checkout could not be opened. Please try again.");
    }
  };

  useEffect(() => {
    if (params.page > totalPages && totalPages >= 1) {
      updateParams({ page: totalPages });
    }
  }, [params.page, totalPages, updateParams]);

  if (listingsQuery.error || categoriesQuery.error) {
    const error = listingsQuery.error ?? categoriesQuery.error;
    const isFetching = listingsQuery.isFetching || categoriesQuery.isFetching;
    return (
      <PageFrame>
        <main className={`${shellContainerClass} py-16 text-center`}>
          <h1 className="font-display text-3xl font-bold text-[#244e36]">Marketplace data could not be loaded</h1>
          <p role="alert" className="mt-3 text-[#647568]">
            {toUserFacingErrorMessage(error?.message)}
          </p>
          <p className="mt-2 text-sm text-[#647568]">Listings are not being shown as an empty result.</p>
          <button
            type="button"
            className="agri-button mt-6"
            disabled={isFetching}
            onClick={() => void Promise.all([listingsQuery.refetch(), categoriesQuery.refetch()])}
          >
            <Loader2 className={isFetching ? "animate-spin" : ""} size={16} /> Retry
          </button>
        </main>
      </PageFrame>
    );
  }

  const showingEnd = Math.min(pageStart + PAGE_SIZE, totalCount);
  const hasActiveFilters =
    params.q.trim() !== "" ||
    params.category !== "all" ||
    params.cooperativeId !== "all" ||
    params.sort !== "price_asc" ||
    params.page > 1;

  return (
    <PageFrame>
      <main className="py-0 sm:py-0">
        <section className="agri-full-bleed bg-[#1f4f36] py-10 text-[#fffdf8]" data-full-bleed>
          <div className={shellContainerClass}>
            <p className="text-sm font-extrabold uppercase tracking-[.13em] text-[#bed99c]">Marketplace</p>
            <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h1 className="font-display text-4xl font-bold">Find harvests with a clear, fair price.</h1>
                <p className="mt-3 max-w-2xl text-[#d8e9d6]">
                  Browse active cooperative listings, compare prices, request a quotation, or prepare a direct order.
                </p>
              </div>
            </div>
          </div>
        </section>

        <div className={`${shellContainerClass} py-6 sm:py-8`}>
        <nav className="mt-0 text-xs font-bold text-[#66806b]" aria-label="Breadcrumb">
          <Link href="/" className="no-underline hover:text-[#1f5a3c]">
            Home
          </Link>
          <span className="mx-2">/</span>
          <span className="text-[#214b35]">Marketplace</span>
        </nav>

        <section className="mt-5 grid gap-7 xl:grid-cols-[1fr_300px]">
          <div>
            <div className="hidden rounded-2xl border border-[#dce4d6] bg-[#fffdf8] p-4 lg:block">
              <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
                <label className="field-label xl:col-span-2" htmlFor="marketplace-search-desktop">
                  Search
                  <div className="flex items-center gap-2 rounded-xl bg-[#f3f7f0] px-3 text-[#64786a]">
                    <Search size={18} aria-hidden />
                    <input
                      id="marketplace-search-desktop"
                      className="w-full bg-transparent py-2 text-sm outline-none placeholder:text-[#8a978c]"
                      value={params.q}
                      onChange={e => updateParams({ q: e.target.value, page: 1 })}
                      placeholder="Produce, category, farmer, or cooperative"
                    />
                  </div>
                </label>
                <label className="field-label" htmlFor="marketplace-category-desktop">
                  Category
                  <div className="relative">
                    <select
                      id="marketplace-category-desktop"
                      className="field-control appearance-none pr-9"
                      value={params.category}
                      onChange={e => updateParams({ category: e.target.value, page: 1 })}
                    >
                      <option value="all">All categories</option>
                      {categories.map(item => (
                        <option key={item.category} value={item.category}>
                          {item.category}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-2.5" size={15} aria-hidden />
                  </div>
                </label>
                <label className="field-label" htmlFor="marketplace-cooperative-desktop">
                  Cooperative
                  <div className="relative">
                    <select
                      id="marketplace-cooperative-desktop"
                      className="field-control appearance-none pr-9"
                      value={params.cooperativeId}
                      onChange={e => updateParams({ cooperativeId: e.target.value, page: 1 })}
                    >
                      <option value="all">All cooperatives</option>
                      {cooperatives.map(coop => (
                        <option key={coop.id} value={String(coop.id)}>
                          {coop.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-2.5" size={15} aria-hidden />
                  </div>
                </label>
                <label className="field-label lg:col-span-2 xl:col-span-4" htmlFor="marketplace-sort-desktop">
                  Sort by
                  <div className="relative max-w-sm">
                    <select
                      id="marketplace-sort-desktop"
                      className="field-control appearance-none pr-9"
                      value={params.sort}
                      onChange={e => updateParams({ sort: e.target.value as SortOption, page: 1 })}
                    >
                      {SORT_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-2.5" size={15} aria-hidden />
                  </div>
                </label>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 lg:hidden">
              <button
                type="button"
                className="agri-ghost inline-flex items-center gap-2 text-sm"
                onClick={() => setMobileFiltersOpen(true)}
              >
                <Filter size={16} aria-hidden />
                Filters & sort
              </button>
              <p className="text-sm font-semibold text-[#57715e]">
                {totalCount === 0
                  ? "No listings"
                  : `${totalCount} listing${totalCount === 1 ? "" : "s"}`}
              </p>
            </div>

            <p className="mt-4 hidden text-sm font-semibold text-[#57715e] lg:block">
              {totalCount === 0
                ? "No listings match your filters."
                : totalCount === 1
                  ? "1 listing"
                  : totalCount <= PAGE_SIZE
                    ? `${totalCount} listings`
                    : `Showing ${pageStart + 1}–${showingEnd} of ${totalCount} listings`}
            </p>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 lg:hidden">
                {totalCount > 0 && (
                  <p className="text-xs text-[#718174]">
                    Page {safePage} of {totalPages}
                  </p>
                )}
              </div>
              {totalPages > 1 && (
                <div className="ml-auto flex items-center gap-2 lg:ml-0 lg:justify-end">
                  <button
                    type="button"
                    className="agri-ghost inline-flex items-center gap-1 text-sm"
                    disabled={safePage <= 1}
                    onClick={() => updateParams({ page: safePage - 1 })}
                  >
                    <ChevronLeft size={16} aria-hidden />
                    Previous
                  </button>
                  <span className="hidden text-sm font-semibold text-[#57715e] sm:inline">
                    Page {safePage} of {totalPages}
                  </span>
                  <button
                    type="button"
                    className="agri-ghost inline-flex items-center gap-1 text-sm"
                    disabled={safePage >= totalPages}
                    onClick={() => updateParams({ page: safePage + 1 })}
                  >
                    Next
                    <ChevronRight size={16} aria-hidden />
                  </button>
                </div>
              )}
            </div>

            {isLoading ? (
              <div className="mt-6 grid min-h-80 place-items-center">
                <Loader2 className="animate-spin text-[#528267]" size={32} aria-label="Loading listings" />
              </div>
            ) : pageListings.length ? (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {pageListings.map((listing, index) => {
                  const { product, sellerName, cooperativeName, cooperativeSlug } = listing;
                  return (
                    <article key={product.id} className="agri-card flex flex-col overflow-hidden">
                      <ListingCardImage product={product} eager={index < 6} />
                      <div className="flex flex-1 flex-col p-3 sm:p-4">
                        <div className="flex items-start justify-between gap-2">
                          <span className="rounded-full bg-[#edf3e9] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-[#487249]">
                            {product.category}
                          </span>
                          <span className="text-[10px] font-bold text-[#66806b]">
                            {product.stockQty} {product.unit}
                          </span>
                        </div>
                        <h2 className="mt-2 font-display text-lg font-bold leading-tight text-[#214b35] sm:text-xl">
                          <Link href={`/products/${product.id}`} className="text-inherit no-underline">
                            {product.name}
                          </Link>
                        </h2>
                        <p className="mt-1 line-clamp-1 text-xs font-semibold text-[#57715e]">{product.variety}</p>
                        <p className="mt-1 line-clamp-2 min-h-8 text-xs leading-5 text-[#66766b]">
                          {product.description}
                        </p>
                        <ListingOptionBadges
                          className="mt-2"
                          allowsPickup={product.allowsPickup}
                          allowsDelivery={product.allowsDelivery}
                        />
                        <div className="mt-3 border-t border-[#edf0e9] pt-3">
                          <p className="font-display text-xl font-bold text-[#1d5639]">
                            {peso(product.priceCents)}{" "}
                            <span className="font-sans text-[10px] font-bold text-[#66806b]">/{product.unit}</span>
                          </p>
                          <p className="mt-1 line-clamp-1 text-[10px] text-[#718174]">
                            By {sellerName || "Verified seller"}
                            {cooperativeName && cooperativeSlug ? (
                              <>
                                {" · "}
                                <Link
                                  href={`/cooperatives/${encodeURIComponent(cooperativeSlug)}`}
                                  className="text-inherit no-underline hover:text-[#1f5a3c]"
                                >
                                  {cooperativeName}
                                </Link>
                              </>
                            ) : cooperativeName ? (
                              ` · ${cooperativeName}`
                            ) : (
                              ""
                            )}
                          </p>
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <button
                            type="button"
                            className="agri-ghost min-h-11 px-2 py-2 text-xs"
                            disabled={product.stockQty === 0}
                            onClick={() => requestQuote(product)}
                          >
                            <MessageCircleMore size={15} aria-hidden /> Quote
                          </button>
                          <button
                            type="button"
                            className="agri-button min-h-11 px-2 py-2 text-xs"
                            disabled={product.stockQty === 0}
                            onClick={() => addToCart(listing)}
                          >
                            <PackagePlus size={15} aria-hidden /> Add
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="agri-card mt-6 grid min-h-70 place-items-center p-8 text-center">
                <div>
                  <ShoppingBasket className="mx-auto text-[#7ba15b]" size={34} aria-hidden />
                  <h2 className="mt-4 font-display text-2xl font-bold text-[#2d573d]">No listings match this view.</h2>
                  <p className="mt-2 text-sm text-[#65766b]">
                    Try adjusting your search or filters, or check back as cooperative members add their harvests.
                  </p>
                  {hasActiveFilters && (
                    <button type="button" className="agri-button mt-5 text-sm" onClick={clearFilters}>
                      Clear filters
                    </button>
                  )}
                </div>
              </div>
            )}

            {totalPages > 1 && pageListings.length > 0 && (
              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  className="agri-ghost inline-flex items-center gap-1 text-sm"
                  disabled={safePage <= 1}
                  onClick={() => updateParams({ page: safePage - 1 })}
                >
                  <ChevronLeft size={16} aria-hidden />
                  Previous
                </button>
                <button
                  type="button"
                  className="agri-ghost inline-flex items-center gap-1 text-sm"
                  disabled={safePage >= totalPages}
                  onClick={() => updateParams({ page: safePage + 1 })}
                >
                  Next
                  <ChevronRight size={16} aria-hidden />
                </button>
              </div>
            )}
          </div>

          <aside className="h-fit agri-card p-5 xl:sticky xl:top-24" id="order">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-bold text-[#264f37]">Your order</h2>
              <span className="grid h-7 min-w-7 place-items-center rounded-full bg-[#e5f0df] px-1 text-xs font-extrabold text-[#387047]">
                {cart.length}
              </span>
            </div>
            {cart.length ? (
              <>
                <div className="mt-4 space-y-3">
                  {cart.map(item => (
                    <div key={item.productId} className="rounded-xl bg-[#f2f6ef] p-3">
                      <div className="flex justify-between gap-2">
                        <p className="font-bold text-[#315640]">{item.name}</p>
                        <button
                          type="button"
                          onClick={() => setCart(cart.filter(x => x.productId !== item.productId))}
                          className="text-[#8c574c]"
                          aria-label={`Remove ${item.name}`}
                        >
                          <X size={16} />
                        </button>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="grid h-6 w-6 place-items-center rounded bg-white font-bold"
                            onClick={() =>
                              setCart(
                                cart.map(x =>
                                  x.productId === item.productId
                                    ? { ...x, quantity: Math.max(x.minOrderQty, x.quantity - x.minOrderQty) }
                                    : x,
                                ),
                              )
                            }
                          >
                            −
                          </button>
                          <span className="font-bold">
                            {item.quantity} {item.unit}
                          </span>
                          <button
                            type="button"
                            className="grid h-6 w-6 place-items-center rounded bg-white font-bold"
                            onClick={() =>
                              setCart(
                                cart.map(x =>
                                  x.productId === item.productId
                                    ? { ...x, quantity: Math.min(x.stockQty, x.quantity + x.minOrderQty) }
                                    : x,
                                ),
                              )
                            }
                          >
                            +
                          </button>
                        </div>
                        <span className="font-bold text-[#315640]">
                          {peso(item.priceCents)} per {item.unit} · {peso(item.priceCents * item.quantity)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-5 border-t border-[#e1e9dd] pt-4">
                  <div className="flex justify-between text-sm font-bold text-[#355a43]">
                    <span>Total</span>
                    <span>{peso(cart.reduce((sum, item) => sum + item.priceCents * item.quantity, 0))}</span>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-[#4d6854]">
                    Choose payment per seller on the checkout page.
                  </p>
                  <button type="button" className="agri-button mt-4 w-full text-sm" onClick={submitCart}>
                    <ShoppingBag size={16} aria-hidden /> Continue to checkout
                  </button>
                </div>
              </>
            ) : (
              <div className="py-8 text-center">
                <ClipboardList className="mx-auto text-[#a1b594]" size={30} aria-hidden />
                <p className="mt-3 text-sm leading-6 text-[#718074]">
                  Add products from one or more farmers. Checkout creates one order per seller.
                </p>
              </div>
            )}
          </aside>
        </section>

        {mobileFiltersOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-[#102c1e]/45"
              aria-label="Close filters"
              onClick={() => setMobileFiltersOpen(false)}
            />
            <div className="absolute bottom-0 left-0 right-0 max-h-[85vh] overflow-y-auto rounded-t-[1.5rem] bg-[#fffdf8] p-5 shadow-2xl">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xl font-bold text-[#214b35]">Filters</h2>
                <button
                  type="button"
                  className="rounded-lg p-1 text-[#66806b] hover:bg-[#edf3e9]"
                  onClick={() => setMobileFiltersOpen(false)}
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="mt-4">
                <FilterFields
                  idPrefix="marketplace-mobile"
                  params={params}
                  categories={categories}
                  cooperatives={cooperatives}
                  onParamsChange={patch => updateParams(patch)}
                />
              </div>
              <div className="mt-5 flex gap-2">
                {hasActiveFilters && (
                  <button type="button" className="agri-ghost flex-1 text-sm" onClick={clearFilters}>
                    Clear filters
                  </button>
                )}
                <button type="button" className="agri-button flex-1 text-sm" onClick={() => setMobileFiltersOpen(false)}>
                  View results
                </button>
              </div>
            </div>
          </div>
        )}

        {quoteProduct && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-[#102c1e]/45 p-4">
            <form
              onSubmit={e => {
                e.preventDefault();
                quoteMutation.mutate({
                  productId: quoteProduct.id,
                  requestedQty: quoteQty,
                  buyerNote: quoteNote || undefined,
                });
              }}
              className="w-full max-w-md rounded-[1.5rem] bg-[#fffdf8] p-6 shadow-2xl"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-extrabold uppercase tracking-[.12em] text-[#6d9147]">
                    Formal quotation request
                  </p>
                  <h2 className="mt-1 font-display text-2xl font-bold text-[#214b35]">{quoteProduct.name}</h2>
                </div>
                <button
                  type="button"
                  className="rounded-lg p-1 text-[#66806b] hover:bg-[#edf3e9]"
                  onClick={() => setQuoteProduct(null)}
                  aria-label="Close quotation form"
                >
                  <X />
                </button>
              </div>
              <label className="field-label mt-5">
                Desired quantity
                <input
                  required
                  className="field-control"
                  min={quoteProduct.minOrderQty}
                  max={quoteProduct.stockQty}
                  step="1"
                  type="number"
                  value={quoteQty}
                  onChange={e => setQuoteQty(Number(e.target.value))}
                />
                {(quoteQty < quoteProduct.minOrderQty || quoteQty > quoteProduct.stockQty) && (
                  <span role="alert" className="mt-1 block text-xs normal-case tracking-normal text-[#a34838]">
                    Enter at least {quoteProduct.minOrderQty} {quoteProduct.unit} and no more than {quoteProduct.stockQty}{" "}
                    {quoteProduct.unit}.
                  </span>
                )}
                <span className="mt-1 block normal-case tracking-normal text-[#718174]">Unit: {quoteProduct.unit}</span>
              </label>
              <label className="field-label mt-4">
                Note for the farmer
                <textarea
                  className="field-control min-h-24 resize-y"
                  placeholder="Delivery or pickup preferences, desired schedule, etc."
                  value={quoteNote}
                  onChange={e => setQuoteNote(e.target.value)}
                />
              </label>
              <p className="mt-3 text-sm font-bold text-[#2d603f]">
                Estimated total: {peso(quoteQty * quoteProduct.priceCents)}
              </p>
              <p className="mt-4 rounded-xl bg-[#edf3e9] p-3 text-xs leading-5 text-[#4d6854]">
                <Check className="mr-1 inline text-[#4c834d]" size={14} aria-hidden /> The seller will respond with
                pricing details before you place an order.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" className="agri-ghost text-sm" onClick={() => setQuoteProduct(null)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="agri-button text-sm"
                  disabled={
                    quoteMutation.isPending ||
                    quoteQty < quoteProduct.minOrderQty ||
                    quoteQty > quoteProduct.stockQty
                  }
                >
                  {quoteMutation.isPending && <Loader2 className="animate-spin" size={15} aria-hidden />} Send request
                </button>
              </div>
            </form>
          </div>
        )}
        </div>
      </main>
    </PageFrame>
  );
}