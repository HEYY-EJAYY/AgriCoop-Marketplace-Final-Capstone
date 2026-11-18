const SPECIAL_WORDS: Record<string, string> = {
  f2f: "F2F",
  gcash: "GCash",
  id: "ID",
  qr: "QR",
  superadmin: "SuperAdmin",
};

export function formatEnumLabel(value: string | null | undefined, fallback = "Unknown"): string {
  const normalized = value?.trim();
  if (!normalized) return fallback;
  return normalized
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map(word => SPECIAL_WORDS[word.toLowerCase()] ?? `${word[0]!.toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ");
}

export function formatCombinedEnumLabels(...values: Array<string | null | undefined>): string {
  return values.filter(value => Boolean(value?.trim()))
    .map(value => formatEnumLabel(value))
    .join(" - ");
}
