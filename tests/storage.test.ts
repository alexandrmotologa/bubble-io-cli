import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';

// Mock fs module and Configstore before importing storage
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('configstore', () => {
  const store = new Map<string, unknown>();
  return {
    default: vi.fn().mockImplementation(() => ({
      set: (key: string, value: unknown) => store.set(key, value),
      get: (key: string) => store.get(key),
      clear: () => store.clear(),
    })),
  };
});

// Import after mocks are set up
const { storage } = await import('../src/utils/storage');

describe('StorageManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.clearConfig();
  });

  describe('saveConfig() + getConfig()', () => {
    it('should save and retrieve configuration', () => {
      storage.saveConfig({ appName: 'test-app', apiKey: 'secret-123' });
      const config = storage.getConfig();

      expect(config).not.toBeNull();
      expect(config?.appName).toBe('test-app');
      expect(config?.apiKey).toBe('secret-123');
    });

    it('should return null when no config is set', () => {
      const config = storage.getConfig();
      expect(config).toBeNull();
    });
  });

  describe('isConfigured()', () => {
    it('should return false when no config is saved', () => {
      expect(storage.isConfigured()).toBe(false);
    });

    it('should return true after saving config', () => {
      storage.saveConfig({ appName: 'my-app', apiKey: 'key-abc' });
      expect(storage.isConfigured()).toBe(true);
    });
  });

  describe('clearConfig()', () => {
    it('should remove all stored values', () => {
      storage.saveConfig({ appName: 'my-app', apiKey: 'key-abc' });
      storage.clearConfig();
      expect(storage.getConfig()).toBeNull();
      expect(storage.isConfigured()).toBe(false);
    });
  });

  describe('saveJsonFile()', () => {
    it('should create directory and write file when dir does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const data = { foo: 'bar', count: 42 };
      storage.saveJsonFile('./output/backup.json', data);

      expect(mkdirSync).toHaveBeenCalledWith('output', { recursive: true });
      expect(writeFileSync).toHaveBeenCalledWith(
        './output/backup.json',
        JSON.stringify(data, null, 2),
        'utf-8'
      );
    });

    it('should not call mkdirSync if directory already exists', () => {
      vi.mocked(existsSync).mockReturnValue(true);

      storage.saveJsonFile('./output/backup.json', { items: [] });

      expect(mkdirSync).not.toHaveBeenCalled();
      expect(writeFileSync).toHaveBeenCalledTimes(1);
    });
  });

  describe('readJsonFile()', () => {
    it('should parse and return JSON content from a file', () => {
      const expected = { records: [{ id: 1 }], total: 1 };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(expected));

      const result = storage.readJsonFile<typeof expected>('./backup.json');

      expect(readFileSync).toHaveBeenCalledWith('./backup.json', 'utf-8');
      expect(result).toEqual(expected);
    });
  });
});
