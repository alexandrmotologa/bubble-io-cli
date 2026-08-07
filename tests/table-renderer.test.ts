import { describe, it, expect } from 'vitest';
import {
  formatCellValue,
  truncateCell,
  buildTableHeaders,
  renderTable,
} from '../src/utils/table-renderer.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleRecords: Record<string, unknown>[] = [
  {
    _id: 'abc123',
    Name: 'Widget',
    Price: 9.99,
    'Is Active': true,
    'Creation Date': '2026-08-01T10:00:00.000Z',
    'Modified Date': '2026-08-02T11:00:00.000Z',
  },
  {
    _id: 'def456',
    Name: 'Gadget',
    Price: 19.99,
    'Is Active': false,
    'Creation Date': '2026-08-03T12:00:00.000Z',
    'Modified Date': '2026-08-04T13:00:00.000Z',
  },
];

// ---------------------------------------------------------------------------
// formatCellValue
// ---------------------------------------------------------------------------

describe('formatCellValue', () => {
  it('returns empty string for null', () => {
    expect(formatCellValue(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatCellValue(undefined)).toBe('');
  });

  it('converts a string value to itself', () => {
    expect(formatCellValue('hello')).toBe('hello');
  });

  it('converts a number to its string representation', () => {
    expect(formatCellValue(42)).toBe('42');
    expect(formatCellValue(9.99)).toBe('9.99');
  });

  it('converts a boolean to its string representation', () => {
    expect(formatCellValue(true)).toBe('true');
    expect(formatCellValue(false)).toBe('false');
  });

  it('converts an array to a comma-separated string', () => {
    expect(formatCellValue(['a', 'b', 'c'])).toBe('a, b, c');
  });

  it('handles nested arrays recursively', () => {
    expect(formatCellValue([1, [2, 3]])).toBe('1, 2, 3');
  });

  it('converts a plain object to "[object]"', () => {
    expect(formatCellValue({ key: 'val' })).toBe('[object]');
  });

  it('handles empty array as empty string', () => {
    expect(formatCellValue([])).toBe('');
  });
});

// ---------------------------------------------------------------------------
// truncateCell
// ---------------------------------------------------------------------------

describe('truncateCell', () => {
  it('does NOT truncate a string at or below maxWidth', () => {
    expect(truncateCell('hello', 10)).toBe('hello');
    expect(truncateCell('1234567890', 10)).toBe('1234567890');
  });

  it('truncates a string longer than maxWidth with ellipsis', () => {
    const result = truncateCell('hello world', 8);
    expect(result).toBe('hello w…');
    expect(result.length).toBe(8);
  });

  it('uses the default max width (30) when no maxWidth is provided', () => {
    const long = 'a'.repeat(40);
    const result = truncateCell(long);
    expect(result.length).toBe(30);
    expect(result.endsWith('…')).toBe(true);
  });

  it('truncates exactly at boundary (maxWidth + 1 chars)', () => {
    const val = 'a'.repeat(31);
    const result = truncateCell(val, 30);
    expect(result.length).toBe(30);
    expect(result.endsWith('…')).toBe(true);
  });

  it('returns empty string unchanged', () => {
    expect(truncateCell('', 10)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// buildTableHeaders
// ---------------------------------------------------------------------------

describe('buildTableHeaders', () => {
  it('returns empty array for empty records', () => {
    expect(buildTableHeaders([])).toEqual([]);
  });

  it('places _id as the first column', () => {
    const headers = buildTableHeaders(sampleRecords);
    expect(headers[0]).toBe('_id');
  });

  it('places Creation Date before Modified Date (both at end)', () => {
    const headers = buildTableHeaders(sampleRecords);
    const cdIdx = headers.indexOf('Creation Date');
    const mdIdx = headers.indexOf('Modified Date');
    expect(cdIdx).toBeGreaterThan(-1);
    expect(mdIdx).toBeGreaterThan(-1);
    expect(cdIdx).toBeLessThan(mdIdx);
    // Both must come after all non-pinned columns
    const nameIdx = headers.indexOf('Name');
    expect(nameIdx).toBeLessThan(cdIdx);
  });

  it('respects maxColumns limit', () => {
    const headers = buildTableHeaders(sampleRecords, 3);
    expect(headers.length).toBeLessThanOrEqual(3);
  });

  it('uses default maxColumns of 8', () => {
    // Construct a record with 12 keys
    const bigRecord: Record<string, unknown> = {};
    for (let i = 0; i < 12; i++) bigRecord[`field${i}`] = i;
    bigRecord['_id'] = 'x';
    const headers = buildTableHeaders([bigRecord]);
    expect(headers.length).toBeLessThanOrEqual(8);
  });

  it('collects keys from all records (union of keys)', () => {
    const r1 = { _id: '1', Name: 'A' };
    const r2 = { _id: '2', Price: 9.99 };
    const headers = buildTableHeaders([r1, r2]);
    expect(headers).toContain('Name');
    expect(headers).toContain('Price');
  });
});

// ---------------------------------------------------------------------------
// renderTable
// ---------------------------------------------------------------------------

describe('renderTable', () => {
  it('returns a string containing all header names', () => {
    const output = renderTable(sampleRecords);
    expect(output).toContain('_id');
    expect(output).toContain('Name');
    expect(output).toContain('Price');
  });

  it('returns a string containing cell values', () => {
    const output = renderTable(sampleRecords);
    expect(output).toContain('Widget');
    expect(output).toContain('Gadget');
  });

  it('handles empty records array (returns table with no rows but no crash)', () => {
    const output = renderTable([]);
    // Empty records → empty headers → empty table string
    expect(typeof output).toBe('string');
  });

  it('respects maxCellWidth option by truncating long values', () => {
    const records = [{ _id: 'a'.repeat(50), Name: 'Short' }];
    const output = renderTable(records, { maxCellWidth: 10 });
    // _id value is 50 chars, should be truncated to 10
    expect(output).not.toContain('a'.repeat(50));
    expect(output).toContain('…');
  });

  it('respects maxColumns option', () => {
    const output = renderTable(sampleRecords, { maxColumns: 2 });
    // With maxColumns=2, we should see _id and one more column
    // but NOT all 6 columns
    expect(output).not.toContain('Creation Date');
  });
});
