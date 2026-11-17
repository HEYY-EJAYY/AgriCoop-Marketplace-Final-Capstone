const productImages: Array<{ match: RegExp; src: string }> = [
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

export function getProductImageUrl(productName: string) {
  return productImages.find(({ match }) => match.test(productName))?.src ?? "/images/product-default.svg";
}

/** Resize Supabase Storage public images for list cards; leave local/static URLs alone. */
export function optimizeListingImageUrl(url: string | null | undefined, fallbackName: string, width = 640, height = 480) {
  const raw = (url && url.trim()) || getProductImageUrl(fallbackName);
  try {
    const parsed = new URL(raw, "https://agricoop.local");
    if (parsed.pathname.includes("/storage/v1/object/public/")) {
      parsed.pathname = parsed.pathname.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/");
      parsed.searchParams.set("width", String(width));
      parsed.searchParams.set("height", String(height));
      parsed.searchParams.set("resize", "cover");
      parsed.searchParams.set("quality", "75");
      return parsed.toString();
    }
  } catch {
    /* keep raw */
  }
  return raw;
}
