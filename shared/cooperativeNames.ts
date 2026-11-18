/** Shared cooperative name/location normalization (client + server). */

export function normalizeCooperativeName(name: string) {
  const trailingPunctuation = new RegExp("^[\\p{P}\\p{S}]+|[\\p{P}\\p{S}]+$", "gu");
  const words = new RegExp("[\\p{L}\\p{M}]+", "gu");
  const ignoredCharacters = new RegExp("[\\p{P}\\p{S}\\s]", "gu");
  const cleanName = name
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .replace(trailingPunctuation, "");
  const displayName = cleanName.replace(words, word => {
    const letters = Array.from(word);
    const first = letters.shift();
    return `${first?.toLocaleUpperCase() ?? ""}${letters.join("").toLocaleLowerCase()}`;
  });
  const normalizedName = cleanName
    .toLocaleLowerCase()
    .replace(ignoredCharacters, "");

  if (!displayName || !normalizedName) {
    throw new Error("Enter a valid cooperative name.");
  }

  return { displayName, normalizedName };
}

/** Municipality/city + province → comparable key (lowercase, trim, collapse spaces, strip punctuation). */
export function normalizeCooperativeLocation(location: string) {
  const ignoredCharacters = new RegExp("[\\p{P}\\p{S}\\s]", "gu");
  const clean = location
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ");
  const normalizedLocation = clean.toLocaleLowerCase().replace(ignoredCharacters, "");
  if (!clean || !normalizedLocation) {
    throw new Error("Enter a valid location (municipality/city and province).");
  }
  return { displayLocation: clean, normalizedLocation };
}

export function normalizeCooperativeAddress(address: string) {
  const clean = address.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!clean || clean.length < 3) {
    throw new Error("Enter a street or barangay address.");
  }
  if (clean.length > 255) {
    throw new Error("Address is too long.");
  }
  return clean;
}
