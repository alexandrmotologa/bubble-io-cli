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
  // Simulate Configstore's nested object store (dot-notation keys map to nested objects)
  const store: Record<string, unknown> = {};

  function setNested(obj: Record<string, unknown>, keys: string[], value: unknown): void {
    const key = keys[0];
    if (keys.length === 1) {
      obj[key] = value;
    } else {
      if (typeof obj[key] !== 'object' || obj[key] === null) obj[key] = {};
      setNested(obj[key] as Record<string, unknown>, keys.slice(1), value);
    }
  }

  function getNested(obj: Record<string, unknown>, keys: string[]): unknown {
    const key = keys[0];
    if (keys.length === 1) return obj[key];
    if (typeof obj[key] !== 'object' || obj[key] === null) return undefined;
    return getNested(obj[key] as Record<string, unknown>, keys.slice(1));
  }

  function deleteNested(obj: Record<string, unknown>, keys: string[]): void {
    const key = keys[0];
    if (keys.length === 1) { delete obj[key]; return; }
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      deleteNested(obj[key] as Record<string, unknown>, keys.slice(1));
    }
  }

  // Use a class so `new Configstore()` works correctly in Vitest 4
  class MockConfigstore {
    set(key: string, value: unknown): void { setNested(store, key.split('.'), value); }
    get(key: string): unknown { return getNested(store, key.split('.')); }
    clear(): void { Object.keys(store).forEach((k) => delete store[k]); }
    delete(key: string): void { deleteNested(store, key.split('.')); }
  }

  return {
    default: MockConfigstore,
  };
});



// Import after mocks are set up
const { storage } = await import('../src/utils/storage');

describe('StorageManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.clearConfig('*');
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
    it('should remove stored values for the active profile', () => {
      storage.saveConfig({ appName: 'my-app', apiKey: 'key-abc' });
      storage.clearConfig();
      expect(storage.getConfig()).toBeNull();
      expect(storage.isConfigured()).toBe(false);
    });
  });

  describe('Multi-app profiles', () => {
    it('should save and retrieve config for a named profile', () => {
      storage.saveConfig({ appName: 'staging-app', apiKey: 'staging-key' }, 'staging');
      const cfg = storage.getConfig('staging');
      expect(cfg?.appName).toBe('staging-app');
      expect(cfg?.apiKey).toBe('staging-key');
    });

    it('should keep profiles independent', () => {
      storage.saveConfig({ appName: 'prod-app', apiKey: 'prod-key' }, 'prod');
      storage.saveConfig({ appName: 'dev-app', apiKey: 'dev-key' }, 'dev');
      expect(storage.getConfig('prod')?.appName).toBe('prod-app');
      expect(storage.getConfig('dev')?.appName).toBe('dev-app');
    });

    it('should set the active profile when saving', () => {
      storage.saveConfig({ appName: 'my-app', apiKey: 'key' }, 'staging');
      expect(storage.getActiveProfile()).toBe('staging');
    });

    it('should allow switching the active profile', () => {
      storage.saveConfig({ appName: 'app-a', apiKey: 'key-a' }, 'alpha');
      storage.saveConfig({ appName: 'app-b', apiKey: 'key-b' }, 'beta');
      storage.setActiveProfile('alpha');
      expect(storage.getActiveProfile()).toBe('alpha');
      expect(storage.getConfig()?.appName).toBe('app-a');
    });

    it('should list all saved profile names', () => {
      storage.saveConfig({ appName: 'x', apiKey: 'k1' }, 'one');
      storage.saveConfig({ appName: 'y', apiKey: 'k2' }, 'two');
      const profiles = storage.listProfiles();
      expect(profiles).toContain('one');
      expect(profiles).toContain('two');
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
