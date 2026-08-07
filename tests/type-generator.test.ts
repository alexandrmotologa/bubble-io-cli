import { describe, it, expect } from 'vitest';
import {
  BUBBLE_TYPE_MAP,
  bubbleTypeToTs,
  generateInterface,
  generateTypeFile,
} from '../src/utils/type-generator.js';
import type { BubbleDataType } from '../src/services/bubble-meta.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A minimal data type with no fields (system fields only). */
const emptyType: BubbleDataType = {
  id: 'product',
  display: 'Product',
  fields: [],
};

/** A rich fixture covering all relevant field type categories. */
const richType: BubbleDataType = {
  id: 'order',
  display: 'Order',
  fields: [
    { id: 'f1', display: 'Name', type: 'text' },
    { id: 'f2', display: 'Total', type: 'number' },
    { id: 'f3', display: 'Is Paid', type: 'boolean' },
    { id: 'f4', display: 'Created At', type: 'date' },
    { id: 'f5', display: 'Location', type: 'geographic address' },
    { id: 'f6', display: 'Receipt', type: 'file' },
    { id: 'f7', display: 'Cover Image', type: 'image' },
    { id: 'f8', display: 'Status', type: 'option' },
    { id: 'f9', display: 'Tags', type: 'list of text' },
    { id: 'f10', display: 'Scores', type: 'list of number' },
    { id: 'f11', display: 'Due Dates', type: 'list of date' },
    { id: 'f12', display: 'Flags', type: 'list of boolean' },
    { id: 'f13', display: 'Attachments', type: 'list of file' },
    { id: 'f14', display: 'Photos', type: 'list of image' },
  ],
};

/** A type containing a relationship field pointing to another user-defined type. */
const typeWithRelationship: BubbleDataType = {
  id: 'invoice',
  display: 'Invoice',
  fields: [
    { id: 'r1', display: 'Customer', type: 'User' },
    { id: 'r2', display: 'Product', type: 'Product' },
    { id: 'r3', display: 'Line Items', type: 'list of Product' },
  ],
};

/** A field display name containing spaces and special characters. */
const typeWithSpacedFields: BubbleDataType = {
  id: 'profile',
  display: 'Profile',
  fields: [
    { id: 's1', display: 'First Name', type: 'text' },
    { id: 's2', display: 'Date of Birth', type: 'date' },
    { id: 's3', display: 'simpleField', type: 'number' },
  ],
};

const knownTypes = new Set(['Product', 'Order', 'Invoice', 'Profile', 'User']);

// ---------------------------------------------------------------------------
// bubbleTypeToTs
// ---------------------------------------------------------------------------

describe('bubbleTypeToTs', () => {
  it('maps all primitive types from BUBBLE_TYPE_MAP correctly', () => {
    for (const [bubbleType, tsType] of Object.entries(BUBBLE_TYPE_MAP)) {
      expect(bubbleTypeToTs(bubbleType, new Set())).toBe(tsType);
    }
  });

  it('maps "text" → "string"', () => {
    expect(bubbleTypeToTs('text', new Set())).toBe('string');
  });

  it('maps "number" → "number"', () => {
    expect(bubbleTypeToTs('number', new Set())).toBe('number');
  });

  it('maps "boolean" → "boolean"', () => {
    expect(bubbleTypeToTs('boolean', new Set())).toBe('boolean');
  });

  it('maps "date" → "string" (ISO 8601 string from Bubble API)', () => {
    expect(bubbleTypeToTs('date', new Set())).toBe('string');
  });

  it('maps "geographic address" → "BubbleGeographicAddress"', () => {
    expect(bubbleTypeToTs('geographic address', new Set())).toBe('BubbleGeographicAddress');
  });

  it('maps "file" → "string"', () => {
    expect(bubbleTypeToTs('file', new Set())).toBe('string');
  });

  it('maps "image" → "string"', () => {
    expect(bubbleTypeToTs('image', new Set())).toBe('string');
  });

  it('maps "list of text" → "string[]"', () => {
    expect(bubbleTypeToTs('list of text', new Set())).toBe('string[]');
  });

  it('maps "list of number" → "number[]"', () => {
    expect(bubbleTypeToTs('list of number', new Set())).toBe('number[]');
  });

  it('maps "list of date" → "string[]"', () => {
    expect(bubbleTypeToTs('list of date', new Set())).toBe('string[]');
  });

  it('maps a user-defined type (in knownTypes) → "string" (ID reference)', () => {
    expect(bubbleTypeToTs('Product', knownTypes)).toBe('string');
  });

  it('maps "list of <CustomDataType>" → "string[]" (list of ID references)', () => {
    expect(bubbleTypeToTs('list of Product', knownTypes)).toBe('string[]');
  });

  it('maps Bubble built-in system type "user" (case-insensitive) → "string"', () => {
    expect(bubbleTypeToTs('User', new Set())).toBe('string');
    expect(bubbleTypeToTs('user', new Set())).toBe('string');
  });

  it('falls back to "unknown" for completely unmapped types', () => {
    expect(bubbleTypeToTs('some-exotic-type', new Set())).toBe('unknown');
    expect(bubbleTypeToTs('', new Set())).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// generateInterface
// ---------------------------------------------------------------------------

describe('generateInterface', () => {
  it('always includes _id as a required string', () => {
    const output = generateInterface(emptyType, knownTypes);
    expect(output).toContain('_id: string;');
  });

  it('always includes Creation Date as a required string', () => {
    const output = generateInterface(emptyType, knownTypes);
    expect(output).toContain("'Creation Date': string;");
  });

  it('always includes Modified Date as a required string', () => {
    const output = generateInterface(emptyType, knownTypes);
    expect(output).toContain("'Modified Date': string;");
  });

  it('opens with the correct interface declaration using the display name', () => {
    const output = generateInterface(emptyType, knownTypes);
    expect(output).toMatch(/^export interface Product \{/);
  });

  it('marks all user-defined fields as optional (?)', () => {
    const output = generateInterface(richType, knownTypes);
    // Every user field line should use ?: not :
    const userFieldLines = output
      .split('\n')
      .filter((l) => l.includes('?: '));
    expect(userFieldLines.length).toBeGreaterThan(0);
    // System fields must NOT be optional
    expect(output).toContain('_id: string;');
    expect(output).not.toContain('_id?: string;');
  });

  it('wraps field names containing spaces in single quotes', () => {
    const output = generateInterface(typeWithSpacedFields, knownTypes);
    expect(output).toContain("'First Name'?:");
    expect(output).toContain("'Date of Birth'?:");
  });

  it('does NOT wrap simple camelCase field names in quotes', () => {
    const output = generateInterface(typeWithSpacedFields, knownTypes);
    expect(output).toContain('simpleField?:');
    expect(output).not.toContain("'simpleField'");
  });

  it('adds a relationship JSDoc comment for custom data type fields', () => {
    const output = generateInterface(typeWithRelationship, knownTypes);
    expect(output).toContain('relationship → stored as Bubble ID');
  });

  it('does NOT add a relationship JSDoc comment for primitive fields', () => {
    const output = generateInterface(richType, knownTypes);
    // Find all JSDoc comment lines (lines starting with /** [...]) and verify
    // none of them say "relationship" — richType has only primitives, no relationships.
    const commentLines = output
      .split('\n')
      .filter((l) => l.trim().startsWith('/**') || l.trim().startsWith('*'));
    const hasRelationshipComment = commentLines.some((l) =>
      l.includes('relationship')
    );
    expect(hasRelationshipComment).toBe(false);
  });

  it('generates correct TypeScript types for all primitive Bubble types', () => {
    const output = generateInterface(richType, knownTypes);
    expect(output).toContain("Name?: string;");     // text
    expect(output).toContain("Total?: number;");    // number
    expect(output).toContain("'Is Paid'?: boolean;");  // boolean
    expect(output).toContain("Tags?: string[];");   // list of text
    expect(output).toContain("Scores?: number[];"); // list of number
    expect(output).toContain("Location?: BubbleGeographicAddress;"); // geo
  });

  it('resolves list-of-relationship fields to string[]', () => {
    const output = generateInterface(typeWithRelationship, knownTypes);
    expect(output).toContain("'Line Items'?: string[];");
  });
});

// ---------------------------------------------------------------------------
// generateTypeFile
// ---------------------------------------------------------------------------

describe('generateTypeFile', () => {
  it('always includes the auto-generated header comment', () => {
    const output = generateTypeFile([emptyType]);
    expect(output).toContain('Auto-generated by bubble-io-cli');
    expect(output).toContain('DO NOT EDIT');
  });

  it('embeds appName and env in the header when provided', () => {
    const output = generateTypeFile([emptyType], { appName: 'my-app', env: 'version-live' });
    expect(output).toContain('App: my-app');
    expect(output).toContain('Environment: version-live');
  });

  it('includes a Generated timestamp in the header when appName/env are provided', () => {
    const output = generateTypeFile([emptyType], { appName: 'my-app' });
    expect(output).toMatch(/Generated: \d{4}-\d{2}-\d{2}T/);
  });

  it('injects BubbleGeographicAddress helper when geo fields are present', () => {
    const output = generateTypeFile([richType]);
    expect(output).toContain('export interface BubbleGeographicAddress');
  });

  it('does NOT inject BubbleGeographicAddress when no geo fields exist', () => {
    const output = generateTypeFile([emptyType]);
    expect(output).not.toContain('BubbleGeographicAddress');
  });

  it('generates interfaces for ALL types when no singleType filter is set', () => {
    const output = generateTypeFile([emptyType, richType, typeWithRelationship]);
    expect(output).toContain('export interface Product');
    expect(output).toContain('export interface Order');
    expect(output).toContain('export interface Invoice');
  });

  it('generates ONLY the requested interface when singleType is set', () => {
    const output = generateTypeFile([emptyType, richType], { singleType: 'Order' });
    expect(output).toContain('export interface Order');
    expect(output).not.toContain('export interface Product');
  });

  it('singleType filter is case-insensitive', () => {
    const output = generateTypeFile([emptyType, richType], { singleType: 'order' });
    expect(output).toContain('export interface Order');
    expect(output).not.toContain('export interface Product');
  });

  it('produces just the header for an empty types array', () => {
    const output = generateTypeFile([]);
    expect(output).toContain('DO NOT EDIT');
    expect(output).not.toContain('export interface');
  });

  it('generates deterministic output for the same input', () => {
    const out1 = generateTypeFile([emptyType, richType]);
    const out2 = generateTypeFile([emptyType, richType]);
    // Strip timestamps from both before comparing
    const strip = (s: string): string => s.replace(/Generated: .+\n/g, '');
    expect(strip(out1)).toBe(strip(out2));
  });

  it('ends the output file with a newline', () => {
    const output = generateTypeFile([emptyType]);
    expect(output.endsWith('\n')).toBe(true);
  });

  it('correctly uses the full knownTypes set for cross-type relationship resolution', () => {
    const types = [emptyType, typeWithRelationship];
    const output = generateTypeFile(types);
    // Invoice.Product should resolve to string (Product is in knownTypes from the full array)
    expect(output).toContain("Product?: string;");
  });
});
