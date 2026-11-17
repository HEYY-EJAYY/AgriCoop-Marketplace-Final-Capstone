export const PRODUCT_UNITS = ["kg", "sack", "piece", "bunch", "metric ton"] as const;
export const MAX_PRODUCT_IMAGE_SIZE_BYTES = 3 * 1024 * 1024;
export const MAX_IMAGE_UPLOAD_REQUEST_BODY_BYTES = 4_300_000;
export const MAX_PRODUCT_IMAGES = 10;
export const isProductImageSizeAllowed = (size: number) => size > 0 && size <= MAX_PRODUCT_IMAGE_SIZE_BYTES;

export function moveProductImage<T>(images: readonly T[], index: number, offset: -1 | 1) {
  const target = index + offset;
  if (index < 0 || target < 0 || index >= images.length || target >= images.length) {
    return [...images];
  }
  const reordered = [...images];
  [reordered[index], reordered[target]] = [reordered[target]!, reordered[index]!];
  return reordered;
}

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
