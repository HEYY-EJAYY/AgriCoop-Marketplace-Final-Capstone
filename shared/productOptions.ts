export const PRODUCT_UNITS = ["kg", "sack", "piece", "bunch", "metric ton"] as const;
export const MAX_PRODUCT_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
export const isProductImageSizeAllowed = (size: number) => size > 0 && size <= MAX_PRODUCT_IMAGE_SIZE_BYTES;

export const PRODUCT_VARIETIES: Record<string, string[]> = {
  rice: ["Jasmine", "Dinorado", "Sinandomeng", "Brown", "Glutinous"],
  corn: ["Yellow", "White", "Sweet", "Glutinous", "Popcorn"],
  coconut: ["Tall", "Dwarf", "Hybrid"],
  banana: ["Lakatan", "Latundan", "Saba", "Cavendish", "Senorita"],
  mango: ["Carabao", "Indian", "Pico", "Katchamita"],
  pineapple: ["Smooth Cayenne", "Queen", "Red Spanish", "MD-2"],
  sugarcane: ["Commercial varieties", "High-sugar varieties", "Chewing sugarcane"],
  coffee: ["Arabica", "Robusta", "Liberica (Barako)", "Excelsa"],
  cacao: ["Forastero", "Criollo", "Trinitario"],
  cassava: ["Sweet", "Bitter", "Industrial"],
};

export function getProductVarieties(productName: string) {
  const name = productName.toLowerCase();
  const match = Object.entries(PRODUCT_VARIETIES).find(([crop]) => name.includes(crop));
  return match?.[1] ?? [];
}
