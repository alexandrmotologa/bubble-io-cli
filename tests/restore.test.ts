import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { BubbleApiClient } from '../src/services/bubble-api';

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

describe('BubbleApiClient — CRUD methods', () => {
  const mockGet = vi.fn();
  const mockPost = vi.fn();
  const mockPatch = vi.fn();
  const mockDelete = vi.fn();
  const mockInterceptors = { response: { use: vi.fn() }, request: { use: vi.fn() } };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(axios.create).mockReturnValue({
      get: mockGet,
      post: mockPost,
      patch: mockPatch,
      delete: mockDelete,
      interceptors: mockInterceptors,
    } as unknown as ReturnType<typeof axios.create>);
  });

  describe('createRecord()', () => {
    it('should POST to the correct endpoint and return the new id', async () => {
      mockPost.mockResolvedValueOnce({ data: { id: 'new-record-123' } });

      const client = new BubbleApiClient('my-app', 'key');
      const result = await client.createRecord('Product', { name: 'Widget', price: 9.99 });

      expect(mockPost).toHaveBeenCalledWith('/Product', { name: 'Widget', price: 9.99 });
      expect(result).toEqual({ id: 'new-record-123' });
    });
  });

  describe('updateRecord()', () => {
    it('should PATCH to the correct endpoint with id and data', async () => {
      mockPatch.mockResolvedValueOnce({ data: {} });

      const client = new BubbleApiClient('my-app', 'key');
      await client.updateRecord('Product', 'abc-123', { price: 19.99 });

      expect(mockPatch).toHaveBeenCalledWith('/Product/abc-123', { price: 19.99 });
    });
  });

  describe('deleteRecord()', () => {
    it('should DELETE the correct endpoint', async () => {
      mockDelete.mockResolvedValueOnce({ data: {} });

      const client = new BubbleApiClient('my-app', 'key');
      await client.deleteRecord('Product', 'abc-123');

      expect(mockDelete).toHaveBeenCalledWith('/Product/abc-123');
    });
  });

  describe('getAllRecords() with constraints', () => {
    it('should pass constraints as a JSON string query param', async () => {
      mockGet.mockResolvedValueOnce({
        data: {
          response: { cursor: 0, count: 1, remaining: 0, results: [{ _id: '1' }] },
        },
      });

      const client = new BubbleApiClient('my-app', 'key');
      const constraints = [{ key: 'status', constraint_type: 'equals' as const, value: 'active' }];
      await client.getAllRecords('Order', undefined, constraints);

      expect(mockGet).toHaveBeenCalledWith('/Order', {
        params: {
          cursor: 0,
          limit: 100,
          constraints: JSON.stringify(constraints),
        },
      });
    });

    it('should not include constraints param when no constraints provided', async () => {
      mockGet.mockResolvedValueOnce({
        data: {
          response: { cursor: 0, count: 1, remaining: 0, results: [{ _id: '1' }] },
        },
      });

      const client = new BubbleApiClient('my-app', 'key');
      await client.getAllRecords('Order');

      const callParams = mockGet.mock.calls[0][1].params;
      expect(callParams.constraints).toBeUndefined();
    });
  });
});
