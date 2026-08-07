import { describe, it, expect } from 'vitest';
import { flattenRecord, jsonToCsv } from '../src/utils/csv';

describe('flattenRecord()', () => {
  it('should return a flat object unchanged', () => {
    const result = flattenRecord({ name: 'Alice', age: '30' });
    expect(result).toEqual({ name: 'Alice', age: '30' });
  });

  it('should flatten one level of nesting with dot notation', () => {
    const result = flattenRecord({ address: { city: 'Paris', zip: '75001' } });
    expect(result).toEqual({ 'address.city': 'Paris', 'address.zip': '75001' });
  });

  it('should flatten deeply nested objects', () => {
    const result = flattenRecord({ a: { b: { c: 'deep' } } });
    expect(result['a.b.c']).toBe('deep');
  });

  it('should serialize arrays as JSON strings', () => {
    const result = flattenRecord({ tags: ['a', 'b', 'c'] });
    expect(result['tags']).toBe('["a","b","c"]');
  });

  it('should represent null values as empty strings', () => {
    const result = flattenRecord({ email: null });
    expect(result['email']).toBe('');
  });

  it('should represent undefined values as empty strings', () => {
    const result = flattenRecord({ email: undefined });
    expect(result['email']).toBe('');
  });

  it('should handle a mix of flat and nested fields', () => {
    const result = flattenRecord({ id: '1', meta: { created: '2026-01-01' } });
    expect(result['id']).toBe('1');
    expect(result['meta.created']).toBe('2026-01-01');
  });
});

describe('jsonToCsv()', () => {
  it('should return an empty string for an empty array', () => {
    expect(jsonToCsv([])).toBe('');
  });

  it('should produce a correct header row from a single record', () => {
    const csv = jsonToCsv([{ name: 'Alice', age: '30' }]);
    const [header] = csv.split('\n');
    expect(header).toBe('name,age');
  });

  it('should produce correct data rows', () => {
    const csv = jsonToCsv([
      { name: 'Alice', age: '30' },
      { name: 'Bob', age: '25' },
    ]);
    const lines = csv.split('\n');
    expect(lines[1]).toBe('Alice,30');
    expect(lines[2]).toBe('Bob,25');
  });

  it('should escape values containing commas with double quotes', () => {
    const csv = jsonToCsv([{ description: 'Hello, world' }]);
    expect(csv).toContain('"Hello, world"');
  });

  it('should escape values containing double quotes', () => {
    const csv = jsonToCsv([{ title: 'Say "Hello"' }]);
    expect(csv).toContain('"Say ""Hello"""');
  });

  it('should handle missing fields across records with empty cells', () => {
    const csv = jsonToCsv([
      { name: 'Alice', email: 'a@test.com' },
      { name: 'Bob' },
    ]);
    const lines = csv.split('\n');
    // Bob's email cell should be empty
    expect(lines[2]).toBe('Bob,');
  });

  it('should flatten nested objects into dot-notation columns', () => {
    const csv = jsonToCsv([{ user: { name: 'Alice', city: 'Paris' } }]);
    const [header] = csv.split('\n');
    expect(header).toContain('user.name');
    expect(header).toContain('user.city');
  });

  it('should produce the correct number of lines (1 header + N data rows)', () => {
    const records = Array.from({ length: 5 }, (_, i) => ({ id: String(i) }));
    const csv = jsonToCsv(records);
    expect(csv.split('\n')).toHaveLength(6); // 1 header + 5 rows
  });
});
