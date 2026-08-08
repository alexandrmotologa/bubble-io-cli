import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AxiosInstance } from 'axios';
import {
  resolveGraph,
  substituteRefs,
  type RelationalSeedDoc,
} from '../src/utils/graph-resolver.js';
import {
  isRelationalDoc,
  runRelationalSeed,
} from '../src/utils/relational-seeder.js';
import { BubbleApiClient } from '../src/services/bubble-api.js';

function makeHttpStub() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  } as unknown as AxiosInstance;
}

describe('Graph Resolver & Relational Seeder', () => {
  describe('resolveGraph()', () => {
    it('should topologically sort simple dependencies (Parent -> Child)', () => {
      const doc: RelationalSeedDoc = {
        Product: [
          { _ref: '@prod_1', name: 'Laptop', category: '@cat_1' },
        ],
        Category: [
          { _ref: '@cat_1', name: 'Tech' },
        ],
      };

      const plan = resolveGraph(doc);
      expect(plan.sortedNodes.map((n) => n.ref)).toEqual(['@cat_1', '@prod_1']);
      expect(plan.deferredPatches).toHaveLength(0);
    });

    it('should handle multi-level hierarchies (Category -> Product -> Price)', () => {
      const doc: RelationalSeedDoc = {
        Price: [
          { amount: 100, product: '@prod_1' },
        ],
        Product: [
          { _ref: '@prod_1', name: 'Laptop', category: '@cat_1' },
        ],
        Category: [
          { _ref: '@cat_1', name: 'Tech' },
        ],
      };

      const plan = resolveGraph(doc);
      const typesInOrder = plan.sortedNodes.map((n) => n.typeName);
      expect(typesInOrder).toEqual(['Category', 'Product', 'Price']);
      expect(plan.deferredPatches).toHaveLength(0);
    });

    it('should handle self-referencing trees (Parent Category -> Child Category)', () => {
      const doc: RelationalSeedDoc = {
        Category: [
          { _ref: '@cat_child', name: 'Laptops', parent: '@cat_root' },
          { _ref: '@cat_root', name: 'Tech' },
        ],
      };

      const plan = resolveGraph(doc);
      expect(plan.sortedNodes.map((n) => n.ref)).toEqual(['@cat_root', '@cat_child']);
      expect(plan.deferredPatches).toHaveLength(0);
    });

    it('should resolve circular dependencies with deferred patches', () => {
      const doc: RelationalSeedDoc = {
        Product: [
          { _ref: '@prod_1', name: 'Laptop', size: '@size_1' },
        ],
        Size: [
          { _ref: '@size_1', name: '14 inch', product: '@prod_1' },
        ],
      };

      const plan = resolveGraph(doc);
      expect(plan.deferredPatches.length).toBeGreaterThan(0);
      expect(plan.sortedNodes).toHaveLength(2);
    });

    it('should throw when an unknown @ref is referenced', () => {
      const doc: RelationalSeedDoc = {
        Product: [
          { name: 'Laptop', category: '@unknown_cat' },
        ],
      };

      expect(() => resolveGraph(doc)).toThrowError(/references unknown alias/);
    });

    it('should throw on duplicate _ref definition', () => {
      const doc: RelationalSeedDoc = {
        Category: [
          { _ref: '@cat_1', name: 'Tech' },
          { _ref: '@cat_1', name: 'Books' },
        ],
      };

      expect(() => resolveGraph(doc)).toThrowError(/Duplicate _ref alias/);
    });
  });

  describe('substituteRefs()', () => {
    const idMap = new Map<string, string>([
      ['@cat_1', 'bubble_id_cat_123'],
      ['@size_1', 'bubble_id_size_456'],
    ]);

    it('should substitute single string ref', () => {
      expect(substituteRefs('@cat_1', idMap)).toBe('bubble_id_cat_123');
    });

    it('should leave non-ref strings untouched', () => {
      expect(substituteRefs('Laptop', idMap)).toBe('Laptop');
    });

    it('should substitute arrays of refs', () => {
      const input = ['@cat_1', '@size_1'];
      expect(substituteRefs(input, idMap)).toEqual(['bubble_id_cat_123', 'bubble_id_size_456']);
    });

    it('should substitute refs inside objects', () => {
      const input = {
        name: 'Product A',
        cat: '@cat_1',
        sizes: ['@size_1'],
        num: 42,
      };
      expect(substituteRefs(input, idMap)).toEqual({
        name: 'Product A',
        cat: 'bubble_id_cat_123',
        sizes: ['bubble_id_size_456'],
        num: 42,
      });
    });
  });

  describe('isRelationalDoc()', () => {
    it('should return false for legacy doc structure', () => {
      expect(isRelationalDoc({ type: 'Product', records: [{ name: 'A' }] })).toBe(false);
    });

    it('should return true for relational map structure', () => {
      const doc = {
        Product: [{ name: 'A' }],
        Category: [{ name: 'B' }],
      };
      expect(isRelationalDoc(doc)).toBe(true);
    });
  });

  describe('runRelationalSeed() execution flow', () => {
    let httpStub: AxiosInstance;

    beforeEach(() => {
      httpStub = makeHttpStub();
    });

    it('should execute creations in order and replace refs with new IDs', async () => {
      vi.mocked(httpStub.post)
        .mockResolvedValueOnce({ data: { id: 'bubble_cat_999' } })
        .mockResolvedValueOnce({ data: { id: 'bubble_prod_888' } });

      const client = new BubbleApiClient('test-app', 'api-key', 'version-test', httpStub);

      const doc: RelationalSeedDoc = {
        Product: [
          { _ref: '@prod_1', name: 'MacBook', category: '@cat_1' },
        ],
        Category: [
          { _ref: '@cat_1', name: 'Computers' },
        ],
      };

      const result = await runRelationalSeed({
        doc,
        client,
        silent: true,
      });

      expect(result.success).toBe(true);
      expect(result.totalCreated).toBe(2);
      expect(result.idMap['@cat_1']).toBe('bubble_cat_999');
      expect(result.idMap['@prod_1']).toBe('bubble_prod_888');

      expect(httpStub.post).toHaveBeenNthCalledWith(1, '/Category', { name: 'Computers' });
      expect(httpStub.post).toHaveBeenNthCalledWith(2, '/Product', { name: 'MacBook', category: 'bubble_cat_999' });
    });

    it('should execute deferred patches for circular dependencies', async () => {
      vi.mocked(httpStub.post)
        .mockResolvedValueOnce({ data: { id: 'bubble_size_111' } })
        .mockResolvedValueOnce({ data: { id: 'bubble_prod_222' } });

      vi.mocked(httpStub.patch).mockResolvedValueOnce({ data: { id: 'bubble_size_111' } });

      const client = new BubbleApiClient('test-app', 'api-key', 'version-test', httpStub);

      const doc: RelationalSeedDoc = {
        Product: [
          { _ref: '@prod_1', name: 'MacBook', size: '@size_1' },
        ],
        Size: [
          { _ref: '@size_1', name: '14 inch', product: '@prod_1' },
        ],
      };

      const result = await runRelationalSeed({
        doc,
        client,
        silent: true,
      });

      expect(result.success).toBe(true);
      expect(result.totalCreated).toBe(2);
      expect(result.totalPatched).toBe(1);
      expect(httpStub.patch).toHaveBeenCalledWith('/Size/bubble_size_111', {
        product: 'bubble_prod_222',
      });
    });
  });
});
