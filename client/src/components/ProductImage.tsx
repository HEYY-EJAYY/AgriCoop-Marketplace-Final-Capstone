import { PRODUCT_IMAGE_PLACEHOLDER, resolveProductImageSrc } from "@/lib/productImages";
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

  useEffect(() => {
    setCurrent(resolved);
  }, [resolved]);

  return (
    <img
      src={current}
      alt={alt}
      width={width}
      height={height}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className={className}
      data-testid="product-image"
      data-image-src={current}
      onError={() => {
        if (current !== PRODUCT_IMAGE_PLACEHOLDER) setCurrent(PRODUCT_IMAGE_PLACEHOLDER);
      }}
    />
  );
}

export { PRODUCT_IMAGE_PLACEHOLDER };
