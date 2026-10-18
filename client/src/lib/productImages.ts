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
