import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AxiosInstance } from 'axios';
import { BubbleApiClient } from '../src/services/bubble-api';

/**
 * Creates a minimal AxiosInstance stub for dependency injection.
 * Avoids all module-level axios mocking — reliable across all Vitest pool modes.
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

describe('BubbleApiClient — CRUD methods', () => {
  let httpStub: AxiosInstance;

  beforeEach(() => {
    httpStub = makeHttpStub();
  });

  describe('createRecord()', () => {
    it('should POST to the correct endpoint and return the new id', async () => {
      vi.mocked(httpStub.post).mockResolvedValueOnce({ data: { id: 'new-record-123' } });

      const client = new BubbleApiClient('my-app', 'key', 'version-test', httpStub);
      const result = await client.createRecord('Product', { name: 'Widget', price: 9.99 });

      expect(httpStub.post).toHaveBeenCalledWith('/Product', { name: 'Widget', price: 9.99 });
      expect(result).toEqual({ id: 'new-record-123' });
    });
  });

  describe('updateRecord()', () => {
    it('should PATCH to the correct endpoint with id and data', async () => {
      vi.mocked(httpStub.patch).mockResolvedValueOnce({ data: {} });

      const client = new BubbleApiClient('my-app', 'key', 'version-test', httpStub);
      await client.updateRecord('Product', 'abc-123', { price: 19.99 });

      expect(httpStub.patch).toHaveBeenCalledWith('/Product/abc-123', { price: 19.99 });
    });
  });

  describe('deleteRecord()', () => {
    it('should DELETE the correct endpoint', async () => {
      vi.mocked(httpStub.delete).mockResolvedValueOnce({ data: {} });

      const client = new BubbleApiClient('my-app', 'key', 'version-test', httpStub);
      await client.deleteRecord('Product', 'abc-123');

      expect(httpStub.delete).toHaveBeenCalledWith('/Product/abc-123');
    });
  });

  describe('getAllRecords() with constraints', () => {
    it('should pass constraints as a JSON string query param', async () => {
      vi.mocked(httpStub.get).mockResolvedValueOnce({
        data: {
          response: { cursor: 0, count: 1, remaining: 0, results: [{ _id: '1' }] },
        },
      });

      const client = new BubbleApiClient('my-app', 'key', 'version-test', httpStub);
      const constraints = [{ key: 'status', constraint_type: 'equals' as const, value: 'active' }];
      await client.getAllRecords('Order', undefined, constraints);

      expect(httpStub.get).toHaveBeenCalledWith('/Order', {
        params: {
          cursor: 0,
          limit: 100,
          constraints: JSON.stringify(constraints),
        },
      });
    });

    it('should not include constraints param when no constraints provided', async () => {
      vi.mocked(httpStub.get).mockResolvedValueOnce({
        data: {
          response: { cursor: 0, count: 1, remaining: 0, results: [{ _id: '1' }] },
        },
      });

      const client = new BubbleApiClient('my-app', 'key', 'version-test', httpStub);
      await client.getAllRecords('Order');

      const callParams = (httpStub.get as ReturnType<typeof vi.fn>).mock.calls[0][1].params;
      expect(callParams.constraints).toBeUndefined();
    });
  });
});
