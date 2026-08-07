import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { loadPlugins, getLoadedPlugins } from '../src/utils/plugin-loader';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Returns a fresh Commander instance for each test. */
function makeProgram(): Command {
  return new Command().exitOverride();
}

/** Returns a minimal valid BubbleCLIPlugin shape. */
function makePlugin(overrides: Record<string, unknown> = {}) {
  return {
    name: 'test-plugin',
    version: '1.0.0',
    description: 'A test plugin',
    register: vi.fn(),
    ...overrides,
  };
}

/**
 * Creates the DI options for loadPlugins().
 * - `discoverFn`: returns a fixed list of pseudo-paths
 * - `requireFn`:  returns the provided module for matching paths, throws for others
 */
function makeOpts(paths: string[], moduleMap: Record<string, unknown>) {
  return {
    silent: true,
    discoverFn: async () => paths,
    requireFn: (id: string) => {
      if (id in moduleMap) return moduleMap[id];
      throw new Error(`Module not found: ${id}`);
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('plugin-loader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── No plugins discovered ──────────────────────────────────────────────────

  describe('when no plugin paths are discovered', () => {
    it('should return an empty array when discoverFn returns []', async () => {
      const results = await loadPlugins(makeProgram(), {
        silent: true,
        discoverFn: async () => [],
      });
      expect(results).toEqual([]);
    });

    it('getLoadedPlugins() should reflect the empty registry', async () => {
      await loadPlugins(makeProgram(), { silent: true, discoverFn: async () => [] });
      expect(getLoadedPlugins()).toEqual([]);
    });
  });

  // ── Valid plugin loading ───────────────────────────────────────────────────

  describe('when a valid plugin is loaded', () => {
    it('should call plugin.register() with the Commander program', async () => {
      const plugin = makePlugin();
      const program = makeProgram();
      const opts = makeOpts(['/fake/hello.js'], { '/fake/hello.js': plugin });

      await loadPlugins(program, opts);

      expect(plugin.register).toHaveBeenCalledWith(program);
      expect(plugin.register).toHaveBeenCalledTimes(1);
    });

    it('should record a success result with the correct source path', async () => {
      const plugin = makePlugin({ name: 'path-checker' });
      const opts = makeOpts(['/fake/path-checker.js'], { '/fake/path-checker.js': plugin });

      const results = await loadPlugins(makeProgram(), opts);

      const success = results.find((r) => r.plugin?.name === 'path-checker');
      expect(success).toBeDefined();
      expect(success?.source).toBe('/fake/path-checker.js');
    });

    it('should store the result in getLoadedPlugins() registry', async () => {
      const plugin = makePlugin({ name: 'registry-check' });
      const opts = makeOpts(['/fake/registry.js'], { '/fake/registry.js': plugin });

      await loadPlugins(makeProgram(), opts);

      const stored = getLoadedPlugins();
      expect(stored).toHaveLength(1);
      expect(stored[0]?.plugin?.name).toBe('registry-check');
    });

    it('should support module.exports.default (ESM-style default export)', async () => {
      const plugin = makePlugin({ name: 'esm-default' });
      // Wraps plugin in { default: plugin } to simulate ESM interop
      const opts = makeOpts(['/fake/esm.js'], { '/fake/esm.js': { default: plugin } });

      const results = await loadPlugins(makeProgram(), opts);

      expect(results[0]?.plugin?.name).toBe('esm-default');
    });
  });

  // ── Invalid plugin shapes ──────────────────────────────────────────────────

  describe('validation — invalid plugin shapes', () => {
    it('should record an error if the plugin is missing a name field', async () => {
      const plugin = makePlugin({ name: undefined });
      const opts = makeOpts(['/fake/no-name.js'], { '/fake/no-name.js': plugin });

      const results = await loadPlugins(makeProgram(), opts);

      const err = results.find((r) => r.error !== undefined);
      expect(err).toBeDefined();
      expect(err?.error).toMatch(/name/i);
    });

    it('should record an error if the plugin has an empty name string', async () => {
      const plugin = makePlugin({ name: '   ' });
      const opts = makeOpts(['/fake/empty-name.js'], { '/fake/empty-name.js': plugin });

      const results = await loadPlugins(makeProgram(), opts);

      const err = results.find((r) => r.error !== undefined);
      expect(err).toBeDefined();
    });

    it('should record an error if the plugin is missing a register() function', async () => {
      const plugin = makePlugin({ register: undefined });
      const opts = makeOpts(['/fake/no-reg.js'], { '/fake/no-reg.js': plugin });

      const results = await loadPlugins(makeProgram(), opts);

      const err = results.find((r) => r.error !== undefined);
      expect(err).toBeDefined();
      expect(err?.error).toMatch(/register/i);
    });

    it('should record an error if the module exports null', async () => {
      const opts = makeOpts(['/fake/null-export.js'], { '/fake/null-export.js': null });

      const results = await loadPlugins(makeProgram(), opts);

      const err = results.find((r) => r.error !== undefined);
      expect(err).toBeDefined();
    });

    it('should record an error if register is not a function', async () => {
      const plugin = makePlugin({ register: 'not-a-function' });
      const opts = makeOpts(['/fake/bad-reg.js'], { '/fake/bad-reg.js': plugin });

      const results = await loadPlugins(makeProgram(), opts);

      const err = results.find((r) => r.error !== undefined);
      expect(err?.error).toMatch(/register/i);
    });
  });

  // ── Error isolation ────────────────────────────────────────────────────────

  describe('error isolation', () => {
    it('should isolate a throwing plugin and still load a valid one', async () => {
      const goodPlugin = makePlugin({ name: 'good-plugin' });

      const opts = {
        silent: true,
        discoverFn: async () => ['/fake/broken.js', '/fake/good.js'],
        requireFn: (id: string) => {
          if (id === '/fake/broken.js') throw new Error('syntax error in plugin');
          if (id === '/fake/good.js') return goodPlugin;
          throw new Error(`Unknown: ${id}`);
        },
      };

      const results = await loadPlugins(makeProgram(), opts);

      const errors    = results.filter((r) => r.error !== undefined);
      const successes = results.filter((r) => r.plugin !== undefined);

      expect(errors).toHaveLength(1);
      expect(successes).toHaveLength(1);
      expect(successes[0]?.plugin?.name).toBe('good-plugin');
    });

    it('should include the error message in the failed result', async () => {
      const opts = {
        silent: true,
        discoverFn: async () => ['/fake/throws.js'],
        requireFn: () => { throw new Error('intentional failure'); },
      };

      const results = await loadPlugins(makeProgram(), opts);

      expect(results[0]?.error).toMatch(/intentional failure/);
    });
  });

  // ── Multiple plugins ───────────────────────────────────────────────────────

  describe('multiple plugins', () => {
    it('should load all valid plugins and call register on each', async () => {
      const pluginA = makePlugin({ name: 'alpha' });
      const pluginB = makePlugin({ name: 'beta' });
      const program = makeProgram();

      const opts = makeOpts(
        ['/fake/alpha.js', '/fake/beta.js'],
        { '/fake/alpha.js': pluginA, '/fake/beta.js': pluginB }
      );

      const results = await loadPlugins(program, opts);

      expect(results).toHaveLength(2);
      expect(pluginA.register).toHaveBeenCalledWith(program);
      expect(pluginB.register).toHaveBeenCalledWith(program);
    });

    it('should reset the registry on each loadPlugins() call', async () => {
      const plugin = makePlugin({ name: 'reset-test' });
      const opts = makeOpts(['/fake/plugin.js'], { '/fake/plugin.js': plugin });

      await loadPlugins(makeProgram(), opts);
      await loadPlugins(makeProgram(), opts);

      // Registry should only contain ONE entry, not two (reset between calls)
      expect(getLoadedPlugins()).toHaveLength(1);
    });
  });
});
