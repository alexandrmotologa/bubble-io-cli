import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginManager } from '../src/utils/plugin-manager';
import type {
  BackupHookContext,
  RestoreHookContext,
  SchemaFetchHookContext,
  SchemaDiffHookContext,
  ExportHookContext,
  InitHookContext,
} from '../src/utils/plugin-manager';

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

function makeBackupCtx(overrides: Partial<BackupHookContext> = {}): BackupHookContext {
  return {
    appName: 'test-app',
    dataType: 'User',
    environment: 'version-test',
    filePath: '/tmp/backup-user.json',
    records: 42,
    format: 'json',
    encrypted: false,
    timestamp: '2026-08-08T00:00:00.000Z',
    ...overrides,
  };
}

function makeRestoreCtx(overrides: Partial<RestoreHookContext> = {}): RestoreHookContext {
  return {
    appName: 'test-app',
    dataType: 'User',
    environment: 'version-test',
    filePath: '/tmp/backup-user.json',
    mode: 'create',
    ...overrides,
  };
}

function makeSchemaFetchCtx(overrides: Partial<SchemaFetchHookContext> = {}): SchemaFetchHookContext {
  return {
    appName: 'test-app',
    environment: 'version-test',
    types: [{ id: 'User', display: 'User', fields: [] }],
    ...overrides,
  };
}

function makeSchemaDiffCtx(overrides: Partial<SchemaDiffHookContext> = {}): SchemaDiffHookContext {
  return {
    appName: 'test-app',
    envA: 'version-test',
    envB: 'version-live',
    diff: {
      identical: false,
      addedTypes: ['NewType'],
      removedTypes: [],
      modifiedTypes: [],
      envA: 'version-test',
      envB: 'version-live',
    },
    ...overrides,
  };
}

function makeExportCtx(overrides: Partial<ExportHookContext> = {}): ExportHookContext {
  return {
    appName: 'test-app',
    dataType: 'Product',
    environment: 'version-live',
    target: 'sqlite',
    records: 100,
    destination: './bubble.db',
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('PluginManager', () => {
  let manager: PluginManager;

  beforeEach(() => {
    manager = new PluginManager();
  });

  // ── registerHooks ────────────────────────────────────────────────────────────

  describe('registerHooks', () => {
    it('should register a single hook function', () => {
      const fn = vi.fn();
      manager.registerHooks('plugin-a', { afterBackup: fn });
      expect(manager.listenerCount('afterBackup')).toBe(1);
    });

    it('should register multiple hooks from the same plugin', () => {
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      manager.registerHooks('plugin-a', { beforeBackup: fn1, afterBackup: fn2 });
      expect(manager.listenerCount('beforeBackup')).toBe(1);
      expect(manager.listenerCount('afterBackup')).toBe(1);
    });

    it('should accumulate hooks from multiple plugins', () => {
      manager.registerHooks('plugin-a', { afterBackup: vi.fn() });
      manager.registerHooks('plugin-b', { afterBackup: vi.fn() });
      expect(manager.listenerCount('afterBackup')).toBe(2);
    });

    it('should skip non-function values silently', () => {
      // @ts-expect-error — intentional bad value for test
      manager.registerHooks('plugin-a', { afterBackup: 'not-a-function' });
      expect(manager.listenerCount('afterBackup')).toBe(0);
    });

    it('should handle empty hooks object without error', () => {
      expect(() => manager.registerHooks('plugin-a', {})).not.toThrow();
    });
  });

  // ── runHook — no listeners ───────────────────────────────────────────────────

  describe('runHook — no listeners', () => {
    it('should resolve without error when no listeners are registered', async () => {
      await expect(manager.runHook('afterBackup', makeBackupCtx())).resolves.toBeUndefined();
    });

    it('should resolve without error for any hook name with no listeners', async () => {
      await expect(manager.runHook('init', { program: {} as never, version: '4.5.0' })).resolves.toBeUndefined();
      await expect(manager.runHook('beforeRestore', makeRestoreCtx())).resolves.toBeUndefined();
      await expect(manager.runHook('onSchemaFetch', makeSchemaFetchCtx())).resolves.toBeUndefined();
    });
  });

  // ── runHook — single listener ────────────────────────────────────────────────

  describe('runHook — single listener', () => {
    it('should call the registered afterBackup hook with the correct context', async () => {
      const fn = vi.fn();
      manager.registerHooks('plugin-a', { afterBackup: fn });
      const ctx = makeBackupCtx({ records: 99 });

      await manager.runHook('afterBackup', ctx);

      expect(fn).toHaveBeenCalledOnce();
      expect(fn).toHaveBeenCalledWith(ctx);
    });

    it('should call the registered beforeBackup hook', async () => {
      const fn = vi.fn();
      manager.registerHooks('plugin-a', { beforeBackup: fn });
      const ctx = makeBackupCtx();

      await manager.runHook('beforeBackup', ctx);

      expect(fn).toHaveBeenCalledOnce();
      expect(fn).toHaveBeenCalledWith(ctx);
    });

    it('should call beforeRestore with correct context', async () => {
      const fn = vi.fn();
      manager.registerHooks('plugin-a', { beforeRestore: fn });
      const ctx = makeRestoreCtx({ mode: 'upsert' });

      await manager.runHook('beforeRestore', ctx);

      expect(fn).toHaveBeenCalledWith(ctx);
    });

    it('should call afterRestore with restoredCount and errors', async () => {
      const fn = vi.fn();
      manager.registerHooks('plugin-a', { afterRestore: fn });
      const ctx = makeRestoreCtx({ restoredCount: 10, errors: 2 });

      await manager.runHook('afterRestore', ctx);

      expect(fn).toHaveBeenCalledWith(ctx);
    });

    it('should call onSchemaFetch with types array', async () => {
      const fn = vi.fn();
      manager.registerHooks('plugin-a', { onSchemaFetch: fn });
      const ctx = makeSchemaFetchCtx();

      await manager.runHook('onSchemaFetch', ctx);

      expect(fn).toHaveBeenCalledWith(ctx);
    });

    it('should call onSchemaDiff with diff result', async () => {
      const fn = vi.fn();
      manager.registerHooks('plugin-a', { onSchemaDiff: fn });
      const ctx = makeSchemaDiffCtx();

      await manager.runHook('onSchemaDiff', ctx);

      expect(fn).toHaveBeenCalledWith(ctx);
    });

    it('should call beforeExport and afterExport with export context', async () => {
      const fnBefore = vi.fn();
      const fnAfter = vi.fn();
      manager.registerHooks('plugin-a', { beforeExport: fnBefore, afterExport: fnAfter });

      const beforeCtx = makeExportCtx();
      const afterCtx = makeExportCtx({ durationMs: 1500 });

      await manager.runHook('beforeExport', beforeCtx);
      await manager.runHook('afterExport', afterCtx);

      expect(fnBefore).toHaveBeenCalledWith(beforeCtx);
      expect(fnAfter).toHaveBeenCalledWith(afterCtx);
    });
  });

  // ── runHook — async hooks ────────────────────────────────────────────────────

  describe('runHook — async hooks', () => {
    it('should await an async hook before resolving', async () => {
      const results: string[] = [];
      const fn = async () => {
        await new Promise((r) => setTimeout(r, 1));
        results.push('done');
      };

      manager.registerHooks('plugin-a', { afterBackup: fn });
      await manager.runHook('afterBackup', makeBackupCtx());

      expect(results).toEqual(['done']);
    });
  });

  // ── runHook — multiple listeners (order) ─────────────────────────────────────

  describe('runHook — multiple listeners', () => {
    it('should call all registered hooks in registration (FIFO) order', async () => {
      const order: string[] = [];
      manager.registerHooks('plugin-a', { afterBackup: () => { order.push('a'); } });
      manager.registerHooks('plugin-b', { afterBackup: () => { order.push('b'); } });
      manager.registerHooks('plugin-c', { afterBackup: () => { order.push('c'); } });

      await manager.runHook('afterBackup', makeBackupCtx());

      expect(order).toEqual(['a', 'b', 'c']);
    });

    it('should call all hooks even when one returns a rejected promise', async () => {
      const order: string[] = [];
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      manager.registerHooks('plugin-a', { afterBackup: () => { order.push('a'); } });
      manager.registerHooks('plugin-b', { afterBackup: async () => { throw new Error('plugin-b failed'); } });
      manager.registerHooks('plugin-c', { afterBackup: () => { order.push('c'); } });

      await manager.runHook('afterBackup', makeBackupCtx());

      expect(order).toEqual(['a', 'c']);
      stderrSpy.mockRestore();
    });
  });

  // ── Error isolation ──────────────────────────────────────────────────────────

  describe('error isolation', () => {
    it('should not throw when a sync hook throws', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      manager.registerHooks('bad-plugin', {
        afterBackup: () => { throw new Error('sync crash'); },
      });

      await expect(manager.runHook('afterBackup', makeBackupCtx())).resolves.toBeUndefined();
      stderrSpy.mockRestore();
    });

    it('should write a warning to stderr when a hook throws', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      manager.registerHooks('bad-plugin', {
        afterBackup: () => { throw new Error('intentional hook error'); },
      });

      await manager.runHook('afterBackup', makeBackupCtx());

      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('intentional hook error')
      );
      stderrSpy.mockRestore();
    });

    it('should include the plugin name in the warning message', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      manager.registerHooks('my-problem-plugin', {
        onSchemaFetch: () => { throw new Error('oops'); },
      });

      await manager.runHook('onSchemaFetch', makeSchemaFetchCtx());

      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('my-problem-plugin')
      );
      stderrSpy.mockRestore();
    });
  });

  // ── listenerCount ────────────────────────────────────────────────────────────

  describe('listenerCount', () => {
    it('should return 0 for a hook with no listeners', () => {
      expect(manager.listenerCount('afterBackup')).toBe(0);
    });

    it('should return the correct count after registration', () => {
      manager.registerHooks('p1', { afterBackup: vi.fn() });
      manager.registerHooks('p2', { afterBackup: vi.fn() });
      expect(manager.listenerCount('afterBackup')).toBe(2);
    });
  });

  // ── _reset ───────────────────────────────────────────────────────────────────

  describe('_reset', () => {
    it('should clear all registered hooks', () => {
      manager.registerHooks('plugin-a', { afterBackup: vi.fn(), onSchemaFetch: vi.fn() });
      manager._reset();
      expect(manager.listenerCount('afterBackup')).toBe(0);
      expect(manager.listenerCount('onSchemaFetch')).toBe(0);
    });
  });

  // ── Init hook ────────────────────────────────────────────────────────────────

  describe('init hook', () => {
    it('should call the init hook with program and version', async () => {
      const fn = vi.fn();
      manager.registerHooks('plugin-a', { init: fn });

      const ctx: InitHookContext = { program: {} as never, version: '4.5.0' };
      await manager.runHook('init', ctx);

      expect(fn).toHaveBeenCalledWith(ctx);
      expect(fn.mock.calls[0]?.[0].version).toBe('4.5.0');
    });
  });
});
