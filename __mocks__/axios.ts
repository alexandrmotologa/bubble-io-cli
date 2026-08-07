/**
 * Manual Axios mock for Vitest test suites.
 * Placed in __mocks__/ so it is auto-applied when vi.mock('axios') is called.
 */
import { vi } from 'vitest';

const mockAxiosInstance = {
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  },
};

const axios = {
  create: vi.fn(() => mockAxiosInstance),
  isAxiosError: vi.fn(() => false),
  isCancel: vi.fn(() => false),
  default: {
    create: vi.fn(() => mockAxiosInstance),
  },
};

export { mockAxiosInstance };
export default axios;
