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
