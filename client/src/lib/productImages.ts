/** Default icon when a listing has no photo or the photo fails to load. Never the hero banner. */
export const PRODUCT_IMAGE_PLACEHOLDER = "/images/product-default.svg";

/** Hero / marketing assets that must never be used as product media. */
export const FORBIDDEN_PRODUCT_IMAGE_PATHS = [
  "/images/hero-banner",
  "/images/hero-banner-800.webp",
  "/images/hero-banner-1200.webp",
  "hero-banner",
] as const;

const localCatalog: Array<{ match: RegExp; src: string }> = [
  { match: /mango/i, src: "/images/Manggo.jpeg" },
  { match: /banana/i, src: "/images/Banana.jpeg" },
  { match: /pineapple/i, src: "/images/Pineapple.jpeg" },
  { match: /sugarcane/i, src: "/images/Sugarcane.jpeg" },
  { match: /coffee/i, src: "/images/Coffee%20Beans.jpeg" },
  { match: /coconut/i, src: "/images/Coconut.jpeg" },
  { match: /cassava/i, src: "/images/Cassava%20Roots.jpg" },
  { match: /cacao/i, src: "/images/Cacao.jpg" },
  { match: /corn/i, src: "/images/Corn.jpeg" },
  { match: /rice/i, src: "/images/Rice.jpeg" },
];

export function isForbiddenProductImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return FORBIDDEN_PRODUCT_IMAGE_PATHS.some(fragment => lower.includes(fragment.toLowerCase()));
}

export function getProductImageUrl(productName: string) {
  return localCatalog.find(({ match }) => match.test(productName))?.src ?? PRODUCT_IMAGE_PLACEHOLDER;
}

/**
 * Prefer the listing's own Storage/public URL.
 * Do NOT rewrite to Supabase Image Transformation (`/render/image/`) — that endpoint
 * returns 403 on this project and previously caused every card to fall back to the hero.
 */
export function optimizeListingImageUrl(
  url: string | null | undefined,
  fallbackName: string,
  _width = 640,
  _height = 480,
) {
  return resolveProductImageSrc(url, fallbackName);
}

export function resolveProductImageSrc(url: string | null | undefined, fallbackName: string) {
  const raw = (url && url.trim()) || "";
  if (!raw || isForbiddenProductImageUrl(raw)) {
    return getProductImageUrl(fallbackName);
  }
  try {
    // Absolute URL or site-relative path — keep as-is (object/public Storage URLs work).
    const parsed = new URL(raw, "https://agricoop.local");
    if (parsed.pathname.includes("/storage/v1/render/image/")) {
      // Repair any already-rewritten broken transform URLs back to object/public.
      parsed.pathname = parsed.pathname.replace("/storage/v1/render/image/", "/storage/v1/object/");
      parsed.search = "";
      return parsed.toString();
    }
  } catch {
    /* keep raw */
  }
  return raw;
}
