/**
 * CSV conversion utilities for bubble-io-cli.
 * Converts flat or nested Bubble record objects to RFC 4180-compliant CSV.
 */

/**
 * Recursively flattens a nested object into dot-notation keys.
 * Arrays are serialised as JSON strings to preserve their content.
 *
 * @example
 * flattenRecord({ name: 'Alice', address: { city: 'Paris' } })
 * // → { name: 'Alice', 'address.city': 'Paris' }
 */
export function flattenRecord(
  record: Record<string, unknown>,
  prefix = ''
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(record)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value === null || value === undefined) {
      result[fullKey] = '';
    } else if (Array.isArray(value)) {
      result[fullKey] = JSON.stringify(value);
    } else if (typeof value === 'object') {
      Object.assign(result, flattenRecord(value as Record<string, unknown>, fullKey));
    } else {
      result[fullKey] = String(value);
    }
  }

  return result;
}

/**
 * Escapes a single CSV cell value per RFC 4180.
 * Wraps in double-quotes when the value contains commas, quotes, or newlines.
 */
function escapeCsvCell(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Converts an array of Bubble record objects to a CSV string.
 * Collects all unique keys across all records to build a consistent header row.
 * Missing fields in individual records are represented as empty cells.
 *
 * @param records - Array of objects from the Bubble Data API
 * @returns A CSV-formatted string (header + rows), or an empty string for empty input
 */
export function jsonToCsv(records: Record<string, unknown>[]): string {
  if (records.length === 0) return '';

  // Flatten all records and collect the union of all field names
  const allKeys = new Set<string>();
  const flattenedRecords = records.map((record) => {
    const flat = flattenRecord(record);
    Object.keys(flat).forEach((k) => allKeys.add(k));
    return flat;
  });

  const headers = Array.from(allKeys);
  const headerRow = headers.map(escapeCsvCell).join(',');
  const dataRows = flattenedRecords.map((record) =>
    headers.map((h) => escapeCsvCell(record[h] ?? '')).join(',')
  );

  return [headerRow, ...dataRows].join('\n');
}
