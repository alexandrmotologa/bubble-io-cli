import { describe, it, expect } from 'vitest';
import { runSchemaPreflight, formatPreflightReport } from '../src/utils/schema-preflight.js';
import type { BubbleDataType } from '../src/services/bubble-meta.js';
import type { RelationalSeedDoc } from '../src/utils/graph-resolver.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Simulates a minimal Bubble schema with Category, Product, Size, Price types */
function makeBubbleSchema(): BubbleDataType[] {
  return [
    {
      id: 'category_id',
      display: 'Category',
      fields: [
        { id: 'f1', display: 'Name', type: 'text' },
        { id: 'f2', display: 'Parent', type: 'Category' },
      ],
    },
    {
      id: 'product_id',
      display: 'Product',
      fields: [
        { id: 'f3', display: 'Name', type: 'text' },
        { id: 'f4', display: 'Category', type: 'Category' },
        { id: 'f5', display: 'Sizes', type: 'list of Size' },
        { id: 'f6', display: 'Price', type: 'number' },
      ],
    },
    {
      id: 'size_id',
      display: 'Size',
      fields: [
        { id: 'f7', display: 'Name', type: 'text' },
        { id: 'f8', display: 'Product', type: 'Product' },
      ],
    },
    {
      id: 'price_id',
      display: 'Price',
      fields: [
        { id: 'f9', display: 'Amount', type: 'number' },
        { id: 'f10', display: 'Currency', type: 'text' },
        { id: 'f11', display: 'Product', type: 'Product' },
        { id: 'f12', display: 'Size', type: 'Size' },
      ],
    },
  ];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runSchemaPreflight()', () => {
  describe('Type Existence', () => {
    it('should pass when all types in seed exist in Bubble schema', () => {
      const doc: RelationalSeedDoc = {
        Category: [{ _ref: '@cat_1', Name: 'Tech' }],
        Product: [{ _ref: '@prod_1', Name: 'Laptop', Category: '@cat_1' }],
      };
      const result = runSchemaPreflight(doc, makeBubbleSchema());
      expect(result.ok).toBe(true);
      const typeErrors = result.issues.filter((i) => !i.fieldName && i.severity === 'error');
      expect(typeErrors).toHaveLength(0);
    });

    it('should report error for a type that does not exist in Bubble', () => {
      const doc: RelationalSeedDoc = {
        Category: [{ _ref: '@cat_1', Name: 'Tech' }],
        NonExistentType: [{ Name: 'Ghost' }],
      };
      const result = runSchemaPreflight(doc, makeBubbleSchema());
      expect(result.ok).toBe(false);
      const missingType = result.issues.find((i) => i.typeName === 'NonExistentType' && !i.fieldName);
      expect(missingType).toBeDefined();
      expect(missingType!.severity).toBe('error');
    });

    it('should not validate fields if the parent type is missing', () => {
      const doc: RelationalSeedDoc = {
        MissingType: [{ SomeField: 'value' }],
      };
      const result = runSchemaPreflight(doc, makeBubbleSchema());
      // Only one issue: missing type (not a separate field issue)
      expect(result.issues).toHaveLength(1);
    });
  });

  describe('Field Existence', () => {
    it('should pass when all fields exist in Bubble schema', () => {
      const doc: RelationalSeedDoc = {
        Price: [{ Amount: 120, Currency: 'USD' }],
      };
      const result = runSchemaPreflight(doc, makeBubbleSchema());
      expect(result.ok).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should report error for a field that does not exist on the type', () => {
      const doc: RelationalSeedDoc = {
        Product: [{ _ref: '@prod_1', Name: 'Laptop', NonExistentField: 'value' }],
      };
      const result = runSchemaPreflight(doc, makeBubbleSchema());
      expect(result.ok).toBe(false);
      const missingField = result.issues.find(
        (i) => i.typeName === 'Product' && i.fieldName === 'NonExistentField'
      );
      expect(missingField).toBeDefined();
      expect(missingField!.severity).toBe('error');
    });
  });

  describe('Relational Field Type Validation (Thing / list of Thing)', () => {
    it('should pass when a @ref value matches the Bubble field type (single Thing link)', () => {
      const doc: RelationalSeedDoc = {
        Category: [{ _ref: '@cat_1', Name: 'Tech' }],
        Product: [{ _ref: '@prod_1', Name: 'Laptop', Category: '@cat_1' }],
      };
      const result = runSchemaPreflight(doc, makeBubbleSchema());
      expect(result.ok).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should warn when a @ref value points to a type that does not match the Bubble field type', () => {
      const doc: RelationalSeedDoc = {
        Size: [{ _ref: '@size_1', Name: 'Large' }],
        // Category.Parent should be "Category" type, but @size_1 is a Size
        Category: [{ _ref: '@cat_1', Name: 'Tech', Parent: '@size_1' }],
      };
      const result = runSchemaPreflight(doc, makeBubbleSchema());
      const mismatch = result.issues.find(
        (i) => i.typeName === 'Category' && i.fieldName === 'Parent' && i.severity === 'warning'
      );
      expect(mismatch).toBeDefined();
      expect(mismatch!.inferredType).toBe('Size');
      expect(mismatch!.actualType).toBe('Category');
    });

    it('should pass when an array of @refs matches "list of <Type>" in Bubble', () => {
      const doc: RelationalSeedDoc = {
        Size: [
          { _ref: '@size_s', Name: 'S' },
          { _ref: '@size_m', Name: 'M' },
        ],
        Product: [
          { _ref: '@prod_1', Name: 'Polo', Sizes: ['@size_s', '@size_m'] },
        ],
      };
      const result = runSchemaPreflight(doc, makeBubbleSchema());
      expect(result.ok).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should warn when an array of @refs points to wrong type (list mismatch)', () => {
      const doc: RelationalSeedDoc = {
        // Using Price refs in a "Sizes" field that expects "list of Size"
        Price: [{ _ref: '@price_1', Amount: 100 }],
        Product: [
          { _ref: '@prod_1', Name: 'Polo', Sizes: ['@price_1'] },
        ],
      };
      const result = runSchemaPreflight(doc, makeBubbleSchema());
      const mismatch = result.issues.find(
        (i) => i.typeName === 'Product' && i.fieldName === 'Sizes'
      );
      expect(mismatch).toBeDefined();
      expect(mismatch!.severity).toBe('warning');
      expect(mismatch!.inferredType).toBe('list of Price');
      expect(mismatch!.actualType).toBe('list of Size');
    });
  });

  describe('Primitive Field Type Validation', () => {
    it('should warn when a number value is used for a text field', () => {
      // Simulate a schema where "Price" field is "text" but we send a number
      const schemaWithWrongType: BubbleDataType[] = [
        {
          id: 'product_id',
          display: 'Product',
          fields: [
            { id: 'f1', display: 'Name', type: 'text' },
            { id: 'f2', display: 'Price', type: 'text' }, // Wrong: should be number
          ],
        },
      ];
      const doc: RelationalSeedDoc = {
        Product: [{ Name: 'Laptop', Price: 999 }],
      };
      const result = runSchemaPreflight(doc, schemaWithWrongType);
      const mismatch = result.issues.find(
        (i) => i.typeName === 'Product' && i.fieldName === 'Price'
      );
      expect(mismatch).toBeDefined();
      expect(mismatch!.severity).toBe('warning');
      expect(mismatch!.inferredType).toBe('number');
      expect(mismatch!.actualType).toBe('text');
    });

    it('should warn when a boolean value is used for a text field', () => {
      const schemaWithWrongType: BubbleDataType[] = [
        {
          id: 'product_id',
          display: 'Product',
          fields: [
            { id: 'f1', display: 'Active', type: 'text' }, // Wrong: should be boolean
          ],
        },
      ];
      const doc: RelationalSeedDoc = {
        Product: [{ Active: true }],
      };
      const result = runSchemaPreflight(doc, schemaWithWrongType);
      const mismatch = result.issues.find(
        (i) => i.typeName === 'Product' && i.fieldName === 'Active'
      );
      expect(mismatch).toBeDefined();
      expect(mismatch!.severity).toBe('warning');
      expect(mismatch!.inferredType).toBe('boolean');
    });

    it('should not warn when a number value matches a number field', () => {
      const doc: RelationalSeedDoc = {
        Price: [{ Amount: 120, Currency: 'USD' }],
      };
      const result = runSchemaPreflight(doc, makeBubbleSchema());
      const amountIssue = result.issues.find(
        (i) => i.typeName === 'Price' && i.fieldName === 'Amount'
      );
      expect(amountIssue).toBeUndefined();
    });
  });

  describe('Stats Reporting', () => {
    it('should report correct checkedTypes and checkedFields counts', () => {
      const doc: RelationalSeedDoc = {
        Category: [{ _ref: '@cat_1', Name: 'Tech' }],
        Product: [{ _ref: '@prod_1', Name: 'Laptop', Category: '@cat_1' }],
      };
      const result = runSchemaPreflight(doc, makeBubbleSchema());
      expect(result.checkedTypes).toBe(2);
      expect(result.checkedFields).toBe(3); // Name (Category), Name + Category (Product)
    });

    it('should return ok: true and zero issues for a perfectly valid doc', () => {
      const doc: RelationalSeedDoc = {
        Size: [
          { _ref: '@size_s', Name: 'S' },
        ],
        Product: [
          { _ref: '@prod_1', Name: 'Polo', Sizes: ['@size_s'] },
        ],
        Price: [
          { Amount: 100, Currency: 'RON', Size: '@size_s' },
        ],
      };
      const result = runSchemaPreflight(doc, makeBubbleSchema());
      expect(result.ok).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('formatPreflightReport()', () => {
    it('should include error details in the formatted report', () => {
      const doc: RelationalSeedDoc = {
        MissingType: [{ Name: 'test' }],
      };
      const result = runSchemaPreflight(doc, makeBubbleSchema());
      const report = formatPreflightReport(result);
      expect(report).toContain('Missing Type');
      expect(report).toContain('MissingType');
    });

    it('should show "All clear" when there are no issues', () => {
      const doc: RelationalSeedDoc = {
        Price: [{ Amount: 100, Currency: 'USD' }],
      };
      const result = runSchemaPreflight(doc, makeBubbleSchema());
      const report = formatPreflightReport(result);
      expect(report).toContain('All clear');
    });
  });
});
