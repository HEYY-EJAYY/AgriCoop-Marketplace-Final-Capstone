import { PRODUCT_IMAGE_PLACEHOLDER, resolveProductImageSrc } from "@/lib/productImages";
import { cn } from "@/lib/utils";
import React, { useEffect, useState } from "react";

type ProductImageProps = {
  src?: string | null;
  alt: string;
  productName?: string;
  width?: number;
  height?: number;
  className?: string;
  eager?: boolean;
};

/**
 * Shared product media. Never falls back to the marketing hero asset —
 * broken or missing photos use the default placeholder icon.
 *
 * A single transient failure (aborted request, cold storage, flaky network)
 * must not latch the placeholder forever: the image is retried once via a
 * remount before falling back, and the neutral background keeps the card
 * from looking empty while the real photo loads.
 */
export function ProductImage({
  src,
  alt,
  productName,
  width = 640,
  height = 384,
  className = "aspect-[4/3] w-full object-cover",
  eager = false,
}: ProductImageProps) {
  const resolved = resolveProductImageSrc(src, productName ?? alt);
  const [current, setCurrent] = useState(resolved);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setCurrent(resolved);
    setAttempt(0);
    setFailed(false);
  }, [resolved]);

  const displaySrc = failed ? PRODUCT_IMAGE_PLACEHOLDER : current;

  return (
    <img
      key={attempt}
      src={displaySrc}
      alt={alt}
      width={width}
      height={height}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : "auto"}
      decoding="async"
      className={cn("bg-[#edf2e7]", className)}
      data-testid="product-image"
      data-image-src={displaySrc}
      onError={() => {
        if (displaySrc === PRODUCT_IMAGE_PLACEHOLDER) return;
        if (attempt === 0) {
          setAttempt(1);
        } else {
          setFailed(true);
        }
      }}
    />
  );
}

export { PRODUCT_IMAGE_PLACEHOLDER };
