import { describe, it, expect } from 'vitest';
import { generateErd, generateErdData, sanitizeId, wrapInMarkdownDocument } from '../src/utils/schema-erd.js';
import type { BubbleDataType } from '../src/services/bubble-meta.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const PRODUCT_TYPE: BubbleDataType = {
  id: 'Product_1',
  display: 'Product',
  fields: [
    { id: 'f1', display: 'Name', type: 'text' },
    { id: 'f2', display: 'Price', type: 'number' },
    { id: 'f3', display: 'Is Active', type: 'boolean' },
    { id: 'f4', display: 'Created Date', type: 'date' },
  ],
};

const ORDER_TYPE: BubbleDataType = {
  id: 'Order_1',
  display: 'Order',
  fields: [
    { id: 'f5', display: 'Status', type: 'text' },
    { id: 'f6', display: 'Quantity', type: 'number' },
    { id: 'f7', display: 'Product', type: 'Product' }, // relationship → Product
  ],
};

const SYSTEM_USER_TYPE: BubbleDataType = {
  id: 'User_builtin',
  display: 'User',
  fields: [
    { id: 'fu1', display: 'email', type: 'text' },
  ],
};

const TYPE_WITH_SYSTEM_REL: BubbleDataType = {
  id: 'Post_1',
  display: 'Post',
  fields: [
    { id: 'fp1', display: 'Title', type: 'text' },
    { id: 'fp2', display: 'Author', type: 'User' }, // relationship → system type
  ],
};

const TYPE_WITH_SPACES: BubbleDataType = {
  id: 'BlogPost_1',
  display: 'Blog Post',
  fields: [
    { id: 'fb1', display: 'Post Title', type: 'text' },
  ],
};

// ---------------------------------------------------------------------------
// sanitizeId
// ---------------------------------------------------------------------------

describe('sanitizeId', () => {
  it('replaces spaces with underscores', () => {
    expect(sanitizeId('Blog Post')).toBe('Blog_Post');
  });

  it('replaces hyphens and dots with underscores', () => {
    expect(sanitizeId('my-type.v2')).toBe('my_type_v2');
  });

  it('leaves alphanumeric and underscore unchanged', () => {
    expect(sanitizeId('Product_123')).toBe('Product_123');
  });

  it('handles empty string', () => {
    expect(sanitizeId('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// generateErdData
// ---------------------------------------------------------------------------

describe('generateErdData', () => {
  it('returns an empty entities array for an empty input', () => {
    const result = generateErdData([]);
    expect(result.entities).toHaveLength(0);
  });

  it('maps a single type with only primitive fields correctly', () => {
    const result = generateErdData([PRODUCT_TYPE]);
    expect(result.entities).toHaveLength(1);

    const entity = result.entities[0];
    expect(entity.id).toBe('Product');
    expect(entity.label).toBe('Product');
    expect(entity.relationships).toHaveLength(0);
    expect(entity.primitiveFields).toHaveLength(4);

    // Field names are sanitized
    expect(entity.primitiveFields[0]).toEqual({ typeLabel: 'text', fieldName: 'Name' });
    expect(entity.primitiveFields[2]).toEqual({ typeLabel: 'boolean', fieldName: 'Is_Active' });
  });

  it('detects a relationship field pointing to another data type', () => {
    const result = generateErdData([PRODUCT_TYPE, ORDER_TYPE]);
    const orderEntity = result.entities.find((e) => e.id === 'Order')!;

    expect(orderEntity.relationships).toHaveLength(1);
    expect(orderEntity.relationships[0]).toEqual({
      targetId: 'Product',
      targetLabel: 'Product',
      fieldName: 'Product',
    });
    // The relationship field should not appear in primitiveFields
    expect(orderEntity.primitiveFields.map((f) => f.fieldName)).not.toContain('Product');
  });

  it('excludes system types as entities by default', () => {
    const result = generateErdData([SYSTEM_USER_TYPE, PRODUCT_TYPE]);
    const ids = result.entities.map((e) => e.id);
    expect(ids).not.toContain('User');
    expect(ids).toContain('Product');
  });

  it('includes system types when includeSystemTypes is true', () => {
    const result = generateErdData([SYSTEM_USER_TYPE, PRODUCT_TYPE], { includeSystemTypes: true });
    const ids = result.entities.map((e) => e.id);
    expect(ids).toContain('User');
    expect(ids).toContain('Product');
  });

  it('excludes relationship arrows to system types when includeSystemTypes is false', () => {
    const result = generateErdData([SYSTEM_USER_TYPE, TYPE_WITH_SYSTEM_REL], { includeSystemTypes: false });
    const postEntity = result.entities.find((e) => e.id === 'Post')!;
    // The "Author → User" relationship should be dropped since User is a system type
    expect(postEntity.relationships).toHaveLength(0);
  });

  it('includes relationship arrows to system types when includeSystemTypes is true', () => {
    const result = generateErdData([SYSTEM_USER_TYPE, TYPE_WITH_SYSTEM_REL], { includeSystemTypes: true });
    const postEntity = result.entities.find((e) => e.id === 'Post')!;
    expect(postEntity.relationships).toHaveLength(1);
    expect(postEntity.relationships[0].targetId).toBe('User');
  });

  it('sanitizes entity IDs with spaces in display names', () => {
    const result = generateErdData([TYPE_WITH_SPACES]);
    expect(result.entities[0].id).toBe('Blog_Post');
    expect(result.entities[0].label).toBe('Blog Post');
  });
});

// ---------------------------------------------------------------------------
// generateErd (string output)
// ---------------------------------------------------------------------------

describe('generateErd', () => {
  it('produces a fenced mermaid code block', () => {
    const output = generateErd([]);
    expect(output).toMatch(/^```mermaid\n/);
    expect(output).toMatch(/\n```$/);
  });

  it('starts with erDiagram directive', () => {
    const output = generateErd([]);
    expect(output).toContain('erDiagram');
  });

  it('renders a single entity with its fields', () => {
    const output = generateErd([PRODUCT_TYPE]);
    expect(output).toContain('Product {');
    expect(output).toContain('text Name');
    expect(output).toContain('number Price');
    expect(output).toContain('boolean Is_Active');
    expect(output).toContain('date Created_Date');
  });

  it('renders relationship arrows between two related types', () => {
    const output = generateErd([PRODUCT_TYPE, ORDER_TYPE]);
    // Should have a relationship line from Order to Product
    expect(output).toContain('Order ||--o{ Product : "Product"');
  });

  it('does not render relationship arrows when there are none', () => {
    const output = generateErd([PRODUCT_TYPE]);
    expect(output).not.toContain('||--o{');
  });

  it('produces a valid block even for an empty types array', () => {
    const output = generateErd([]);
    const lines = output.split('\n');
    expect(lines[0]).toBe('```mermaid');
    expect(lines[1]).toBe('erDiagram');
    expect(lines[lines.length - 1]).toBe('```');
  });
});

// ---------------------------------------------------------------------------
// wrapInMarkdownDocument
// ---------------------------------------------------------------------------

describe('wrapInMarkdownDocument', () => {
  it('includes the app name in the heading', () => {
    const doc = wrapInMarkdownDocument('my-app', 'version-test', '```mermaid\nerDiagram\n```');
    expect(doc).toContain('# Entity-Relationship Diagram — my-app');
  });

  it('includes the environment in the metadata line', () => {
    const doc = wrapInMarkdownDocument('my-app', 'version-live', '```mermaid\nerDiagram\n```');
    expect(doc).toContain('`version-live`');
  });

  it('embeds the ERD block in the document', () => {
    const block = '```mermaid\nerDiagram\n  Product {\n  }\n```';
    const doc = wrapInMarkdownDocument('app', 'version-test', block);
    expect(doc).toContain(block);
  });
});
