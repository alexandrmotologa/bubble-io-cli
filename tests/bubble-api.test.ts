import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AxiosInstance } from 'axios';
import { BubbleApiClient } from '../src/services/bubble-api';

/**
 * Creates a minimal AxiosInstance stub for dependency injection.
 * This approach avoids module-level mocking of axios entirely,
 * which is unreliable in Vitest's vmForks pool with ESM packages.
 */
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

describe('BubbleApiClient', () => {
  let httpStub: AxiosInstance;

  beforeEach(() => {
    httpStub = makeHttpStub();
  });

  describe('constructor', () => {
    it('should expose the correct environment when provided', () => {
      const client = new BubbleApiClient('my-app', 'key', 'version-test', httpStub);
      expect(client.env).toBe('version-test');
    });

    it('should default to version-test environment', () => {
      const client = new BubbleApiClient('my-app', 'key', undefined, httpStub);
      expect(client.env).toBe('version-test');
    });

    it('should accept version-live environment', () => {
      const client = new BubbleApiClient('my-app', 'key', 'version-live', httpStub);
      expect(client.env).toBe('version-live');
    });

    it('should expose the app name', () => {
      const client = new BubbleApiClient('test-app', 'key', undefined, httpStub);
      expect(client.app).toBe('test-app');
    });
  });

  describe('getDataType()', () => {
    it('should call GET with the data type path', async () => {
      vi.mocked(httpStub.get).mockResolvedValueOnce({
        data: {
          response: {
            cursor: 0,
            count: 2,
            remaining: 0,
            results: [{ _id: '1' }, { _id: '2' }],
          },
        },
      });

      const client = new BubbleApiClient('my-app', 'key', 'version-test', httpStub);
      const result = await client.getDataType('Product');

      expect(httpStub.get).toHaveBeenCalledWith('/Product', { params: { cursor: 0, limit: 100 } });
      expect(result.results).toHaveLength(2);
      expect(result.count).toBe(2);
    });
  });

  describe('getAllRecords()', () => {
    it('should return all records when there is only one page', async () => {
      vi.mocked(httpStub.get).mockResolvedValueOnce({
        data: {
          response: {
            cursor: 0,
            count: 3,
            remaining: 0,
            results: [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }],
          },
        },
      });

      const client = new BubbleApiClient('my-app', 'key', 'version-test', httpStub);
      const result = await client.getAllRecords('User');

      expect(result.totalFetched).toBe(3);
      expect(result.results).toHaveLength(3);
    });

    it('should paginate across multiple pages', async () => {
      vi.mocked(httpStub.get)
        .mockResolvedValueOnce({
          data: {
            response: { cursor: 0, count: 2, remaining: 1, results: [{ _id: '1' }, { _id: '2' }] },
          },
        })
        .mockResolvedValueOnce({
          data: {
            response: { cursor: 2, count: 1, remaining: 0, results: [{ _id: '3' }] },
          },
        });

      const client = new BubbleApiClient('my-app', 'key', 'version-test', httpStub);
      const result = await client.getAllRecords('Order');

      expect(httpStub.get).toHaveBeenCalledTimes(2);
      expect(result.totalFetched).toBe(3);
      expect(result.results.map((r: Record<string, unknown>) => r._id)).toEqual(['1', '2', '3']);
    });

    it('should handle an empty data type gracefully', async () => {
      vi.mocked(httpStub.get).mockResolvedValueOnce({
        data: {
          response: { cursor: 0, count: 0, remaining: 0, results: [] },
        },
      });

      const client = new BubbleApiClient('my-app', 'key', 'version-test', httpStub);
      const result = await client.getAllRecords('EmptyType');

      expect(result.totalFetched).toBe(0);
      expect(result.results).toEqual([]);
    });

    it('should stop fetching when maxRecords cap is reached mid-pagination', async () => {
      vi.mocked(httpStub.get).mockResolvedValueOnce({
        data: {
          response: {
            cursor: 0,
            count: 100,
            remaining: 50,
            results: Array.from({ length: 100 }, (_, i) => ({ _id: String(i) })),
          },
        },
      });

      const client = new BubbleApiClient('my-app', 'key', 'version-test', httpStub);
      const result = await client.getAllRecords('Product', 100);

      expect(httpStub.get).toHaveBeenCalledTimes(1);
      expect(result.totalFetched).toBe(100);
    });

    it('should request only the remaining quota on the last page when limit < pageSize', async () => {
      vi.mocked(httpStub.get).mockResolvedValueOnce({
        data: {
          response: {
            cursor: 0,
            count: 25,
            remaining: 0,
            results: Array.from({ length: 25 }, (_, i) => ({ _id: String(i) })),
          },
        },
      });

      const client = new BubbleApiClient('my-app', 'key', 'version-test', httpStub);
      const result = await client.getAllRecords('Order', 25);

      expect(httpStub.get).toHaveBeenCalledWith('/Order', { params: { cursor: 0, limit: 25 } });
      expect(result.totalFetched).toBe(25);
    });

    it('should fetch all records when maxRecords is not provided', async () => {
      vi.mocked(httpStub.get).mockResolvedValueOnce({
        data: {
          response: {
            cursor: 0,
            count: 5,
            remaining: 0,
            results: Array.from({ length: 5 }, (_, i) => ({ _id: String(i) })),
          },
        },
      });

      const client = new BubbleApiClient('my-app', 'key', 'version-test', httpStub);
      const result = await client.getAllRecords('User');

      expect(httpStub.get).toHaveBeenCalledWith('/User', { params: { cursor: 0, limit: 100 } });
      expect(result.totalFetched).toBe(5);
    });
  });
});
