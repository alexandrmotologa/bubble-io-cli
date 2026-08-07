import Table from 'cli-table3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for controlling how the table is rendered. */
export interface TableRenderOptions {
  /** Maximum characters per cell before truncation (default: 30). */
  maxCellWidth?: number;
  /** Maximum number of columns to render (default: 8). */
  maxColumns?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_CELL_WIDTH = 30;
const DEFAULT_MAX_COLUMNS = 8;

/**
 * System fields that are always shown first / last, regardless of schema order.
 * `_id` goes first; date fields go last.
 */
const PINNED_FIRST = ['_id'];
const PINNED_LAST = ['Creation Date', 'Modified Date'];
const PINNED_LAST_SET = new Set(PINNED_LAST);

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

/**
 * Safely converts any Bubble field value to a display string.
 *
 * - `null` / `undefined` → `''`
 * - Array → comma-separated list of stringified elements
 * - Primitive → `String(value)`
 * - Plain object → `[object]`
 */
export function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return value.map((v) => formatCellValue(v)).join(', ');
  }
  if (typeof value === 'object') return '[object]';
  return String(value);
}

/**
 * Truncates a string to `maxWidth` characters, appending `…` when truncated.
 *
 * @param value    - The string to truncate.
 * @param maxWidth - Maximum allowed length (default: `DEFAULT_MAX_CELL_WIDTH`).
 */
export function truncateCell(
  value: string,
  maxWidth: number = DEFAULT_MAX_CELL_WIDTH
): string {
  if (value.length <= maxWidth) return value;
  return value.slice(0, maxWidth - 1) + '…';
}

/**
 * Derives an ordered array of column header names from a set of records.
 *
 * Column ordering rules:
 * 1. `_id` always first.
 * 2. All other keys in insertion order, excluding pinned-last fields.
 * 3. `Creation Date` and `Modified Date` last (if present).
 * 4. At most `maxColumns` columns are returned.
 *
 * @param records    - The records to inspect for keys.
 * @param maxColumns - Maximum number of columns (default: `DEFAULT_MAX_COLUMNS`).
 */
export function buildTableHeaders(
  records: Record<string, unknown>[],
  maxColumns: number = DEFAULT_MAX_COLUMNS
): string[] {
  if (records.length === 0) return [];

  // Collect all unique keys across all records
  const allKeys = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      allKeys.add(key);
    }
  }

  const middle: string[] = [];
  const tail: string[] = [];

  for (const key of allKeys) {
    if (PINNED_FIRST.includes(key)) continue; // handled separately
    if (PINNED_LAST_SET.has(key)) {
      tail.push(key);
      continue;
    }
    middle.push(key);
  }

  // Respect PINNED_LAST ordering
  const orderedTail = PINNED_LAST.filter((k) => tail.includes(k));

  const firstPresent = PINNED_FIRST.filter((k) => allKeys.has(k));
  const ordered = [...firstPresent, ...middle, ...orderedTail];

  return ordered.slice(0, maxColumns);
}

/**
 * Renders an array of Bubble records as a bordered `cli-table3` table string.
 *
 * @param records - Records to display.
 * @param options - Optional rendering settings.
 * @returns A ready-to-print table string (including trailing newline from `toString()`).
 */
export function renderTable(
  records: Record<string, unknown>[],
  options: TableRenderOptions = {}
): string {
  const maxCellWidth = options.maxCellWidth ?? DEFAULT_MAX_CELL_WIDTH;
  const maxColumns = options.maxColumns ?? DEFAULT_MAX_COLUMNS;

  const headers = buildTableHeaders(records, maxColumns);

  const table = new Table({
    head: headers,
    style: { head: ['cyan'], border: ['dim'] },
    wordWrap: false,
  });

  for (const record of records) {
    const row = headers.map((col) => {
      const raw = formatCellValue(record[col]);
      return truncateCell(raw, maxCellWidth);
    });
    table.push(row);
  }

  return table.toString();
}
