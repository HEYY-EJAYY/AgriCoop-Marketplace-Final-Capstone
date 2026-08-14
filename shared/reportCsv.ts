export type CsvCell = string | number | boolean | null | undefined;

/** Converts tabular report data to a standards-compatible CSV payload. */
export function buildCsv(rows: CsvCell[][]) {
  return rows
    .map(row => row.map(cell => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n");
}
