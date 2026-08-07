import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { BubbleApiClient } from '../src/services/bubble-api';

// Mock the entire axios module
vi.mock('axios', async () => {
  const actual = await vi.importActual<typeof import('axios')>('axios');
  return {
    ...actual,
    default: {
      ...actual.default,
      create: vi.fn(),
    },
  };
});

describe('BubbleApiClient', () => {
  const mockGet = vi.fn();
  const mockInterceptors = {
    response: { use: vi.fn() },
    request: { use: vi.fn() },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(axios.create).mockReturnValue({
      get: mockGet,
      interceptors: mockInterceptors,
    } as unknown as ReturnType<typeof axios.create>);
  });

  describe('constructor', () => {
    it('should create an axios instance with the correct base URL', () => {
      new BubbleApiClient('my-app', 'test-key', 'version-test');

      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://my-app.bubbleapps.io/version-test/api/1.1/obj',
        })
      );
    });

    it('should set the Authorization header with the API key', () => {
      new BubbleApiClient('my-app', 'secret-key-123');

      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer secret-key-123',
          }),
        })
      );
    });

    it('should default to version-test environment', () => {
      const client = new BubbleApiClient('my-app', 'key');
      expect(client.env).toBe('version-test');
    });

    it('should accept version-live environment', () => {
      const client = new BubbleApiClient('my-app', 'key', 'version-live');
      expect(client.env).toBe('version-live');
    });
  });

  describe('getDataType()', () => {
    it('should call GET with the data type path', async () => {
      mockGet.mockResolvedValueOnce({
        data: {
          response: {
            cursor: 0,
            count: 2,
            remaining: 0,
            results: [{ _id: '1' }, { _id: '2' }],
          },
        },
      });

      const client = new BubbleApiClient('my-app', 'key');
      const result = await client.getDataType('Product');

      expect(mockGet).toHaveBeenCalledWith('/Product', { params: { cursor: 0, limit: 100 } });
      expect(result.results).toHaveLength(2);
      expect(result.count).toBe(2);
    });
  });

  describe('getAllRecords()', () => {
    it('should return all records when there is only one page', async () => {
      mockGet.mockResolvedValueOnce({
        data: {
          response: {
            cursor: 0,
            count: 3,
            remaining: 0,
            results: [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }],
          },
        },
      });

      const client = new BubbleApiClient('my-app', 'key');
      const result = await client.getAllRecords('User');

      expect(result.totalFetched).toBe(3);
      expect(result.results).toHaveLength(3);
    });

    it('should paginate across multiple pages', async () => {
      // First page: 2 results, 1 remaining
      mockGet.mockResolvedValueOnce({
        data: {
          response: {
            cursor: 0,
            count: 2,
            remaining: 1,
            results: [{ _id: '1' }, { _id: '2' }],
          },
        },
      });

      // Second page: 1 result, 0 remaining
      mockGet.mockResolvedValueOnce({
        data: {
          response: {
            cursor: 2,
            count: 1,
            remaining: 0,
            results: [{ _id: '3' }],
          },
        },
      });

      const client = new BubbleApiClient('my-app', 'key');
      const result = await client.getAllRecords('Order');

      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(result.totalFetched).toBe(3);
      expect(result.results.map((r: Record<string, unknown>) => r._id)).toEqual(['1', '2', '3']);
    });

    it('should handle an empty data type gracefully', async () => {
      mockGet.mockResolvedValueOnce({
        data: {
          response: { cursor: 0, count: 0, remaining: 0, results: [] },
        },
      });

      const client = new BubbleApiClient('my-app', 'key');
      const result = await client.getAllRecords('EmptyType');

      expect(result.totalFetched).toBe(0);
      expect(result.results).toEqual([]);
    });

    it('should stop fetching when maxRecords cap is reached mid-pagination', async () => {
      // Page 1: returns 100 records, 50 still remaining — but we only want 100 total
      mockGet.mockResolvedValueOnce({
        data: {
          response: {
            cursor: 0,
            count: 100,
            remaining: 50,
            results: Array.from({ length: 100 }, (_, i) => ({ _id: String(i) })),
          },
        },
      });

      const client = new BubbleApiClient('my-app', 'key');
      const result = await client.getAllRecords('Product', 100);

      // Should stop after first page — cap of 100 reached
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(result.totalFetched).toBe(100);
    });

    it('should request only the remaining quota on the last page when limit < pageSize', async () => {
      // We want only 25 records — the page request should ask for limit=25
      mockGet.mockResolvedValueOnce({
        data: {
          response: {
            cursor: 0,
            count: 25,
            remaining: 0,
            results: Array.from({ length: 25 }, (_, i) => ({ _id: String(i) })),
          },
        },
      });

      const client = new BubbleApiClient('my-app', 'key');
      const result = await client.getAllRecords('Order', 25);

      expect(mockGet).toHaveBeenCalledWith('/Order', { params: { cursor: 0, limit: 25 } });
      expect(result.totalFetched).toBe(25);
    });

    it('should fetch all records when maxRecords is not provided', async () => {
      mockGet.mockResolvedValueOnce({
        data: {
          response: { cursor: 0, count: 5, remaining: 0, results: Array.from({ length: 5 }, (_, i) => ({ _id: String(i) })) },
        },
      });

      const client = new BubbleApiClient('my-app', 'key');
      const result = await client.getAllRecords('User');

      // Default page size of 100 should be used when no cap given
      expect(mockGet).toHaveBeenCalledWith('/User', { params: { cursor: 0, limit: 100 } });
      expect(result.totalFetched).toBe(5);
    });
  });

  describe('app and env getters', () => {
    it('should expose the app name', () => {
      const client = new BubbleApiClient('test-app', 'key');
      expect(client.app).toBe('test-app');
    });
  });
});
