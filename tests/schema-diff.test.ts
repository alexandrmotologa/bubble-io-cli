import { describe, it, expect } from 'vitest';
import { diffSchemas } from '../src/utils/schema-diff';
import type { BubbleDataType } from '../src/services/bubble-meta';

const typeA: BubbleDataType = {
  id: 'product',
  display: 'Product',
  fields: [
    { id: 'name', display: 'Name', type: 'text' },
    { id: 'price', display: 'Price', type: 'number' },
    { id: 'stock', display: 'Stock', type: 'number' },
  ],
};

const typeB: BubbleDataType = {
  id: 'product',
  display: 'Product',
  fields: [
    { id: 'name', display: 'Name', type: 'text' },
    { id: 'price', display: 'Price', type: 'text' }, // type changed
    { id: 'category', display: 'Category', type: 'option' }, // added
    // stock removed
  ],
};

describe('diffSchemas()', () => {
  it('should return identical=true when both schemas are the same', () => {
    const result = diffSchemas([typeA], [typeA], 'version-test', 'version-live');
    expect(result.identical).toBe(true);
    expect(result.addedTypes).toHaveLength(0);
    expect(result.removedTypes).toHaveLength(0);
    expect(result.modifiedTypes).toHaveLength(0);
  });

  it('should detect a newly added data type', () => {
    const newType: BubbleDataType = { id: 'order', display: 'Order', fields: [] };
    const result = diffSchemas([typeA], [typeA, newType], 'version-test', 'version-live');
    expect(result.addedTypes).toContain('Order');
    expect(result.identical).toBe(false);
  });

  it('should detect a removed data type', () => {
    const result = diffSchemas([typeA, { id: 'user', display: 'User', fields: [] }], [typeA], 'version-test', 'version-live');
    expect(result.removedTypes).toContain('User');
    expect(result.identical).toBe(false);
  });

  it('should detect a changed field type', () => {
    const result = diffSchemas([typeA], [typeB], 'version-test', 'version-live');
    const mod = result.modifiedTypes.find((t) => t.type === 'Product');
    expect(mod).toBeDefined();
    const priceChange = mod?.fieldChanges?.find((f) => f.field === 'Price');
    expect(priceChange?.severity).toBe('changed');
    expect(priceChange?.before).toBe('number');
    expect(priceChange?.after).toBe('text');
  });

  it('should detect an added field', () => {
    const result = diffSchemas([typeA], [typeB], 'version-test', 'version-live');
    const mod = result.modifiedTypes.find((t) => t.type === 'Product');
    const added = mod?.fieldChanges?.find((f) => f.field === 'Category');
    expect(added?.severity).toBe('added');
    expect(added?.after).toBe('option');
  });

  it('should detect a removed field', () => {
    const result = diffSchemas([typeA], [typeB], 'version-test', 'version-live');
    const mod = result.modifiedTypes.find((t) => t.type === 'Product');
    const removed = mod?.fieldChanges?.find((f) => f.field === 'Stock');
    expect(removed?.severity).toBe('removed');
    expect(removed?.before).toBe('number');
  });

  it('should populate envA and envB correctly', () => {
    const result = diffSchemas([typeA], [typeA], 'version-test', 'version-live');
    expect(result.envA).toBe('version-test');
    expect(result.envB).toBe('version-live');
  });

  it('should handle empty schemas', () => {
    const result = diffSchemas([], [], 'version-test', 'version-live');
    expect(result.identical).toBe(true);
  });
});
