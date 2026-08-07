import { Command } from 'commander';
import { readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

// ────────────────────────────────────────────────────────────────────────────
// Public contract — used by plugin authors
// ────────────────────────────────────────────────────────────────────────────

/**
 * The interface every bubble-io-cli plugin must implement.
 * Export this as the default export of your plugin module.
 *
 * @example
 * ```ts
 * import type { BubbleCLIPlugin } from 'bubble-io-cli/plugin';
 * const plugin: BubbleCLIPlugin = {
 *   name: 'my-plugin',
 *   version: '1.0.0',
 *   register(program) {
 *     program.command('my-cmd').description('My custom command').action(() => { ... });
 *   },
 * };
 * export default plugin;
 * ```
 */
export interface BubbleCLIPlugin {
  /** Unique plugin name — used for display and deduplication. */
  name: string;
  /** Semver version string (optional). */
  version?: string;
  /** Short description shown in `plugin ext list`. */
  description?: string;
  /**
   * Called once at startup with the root Commander `program` instance.
   * Use it to register new commands or extend existing sub-command groups.
   */
  register(program: Command): void;
}

/** Successful plugin load record. */
export interface PluginLoadSuccess {
  plugin: BubbleCLIPlugin;
  source: string;
  error?: undefined;
}

/** Failed plugin load record. */
export interface PluginLoadError {
  plugin?: undefined;
  source: string;
  error: string;
}

export type PluginLoadResult = PluginLoadSuccess | PluginLoadError;

/** Options for loadPlugins(). */
export interface LoadPluginsOptions {
  /** Extra directories to scan in addition to the defaults. */
  extraDirs?: string[];
  /** Suppress all console output (useful in --json mode). */
  silent?: boolean;
  /**
   * Override the module loader used to import plugin files.
   * Defaults to Node's built-in `require`. Used in unit tests for DI.
   */
  requireFn?: (id: string) => unknown;
  /**
   * Override path discovery entirely — return the list of absolute plugin
   * file paths to load. When provided, no filesystem scanning is performed.
   * Used in unit tests for DI.
   */
  discoverFn?: () => Promise<string[]>;
}

// ────────────────────────────────────────────────────────────────────────────
// Discovery helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Returns the default local plugin directories to scan:
 *  1. `$CWD/.bubble-cli/plugins/`  — project-scoped plugins (highest priority)
 *  2. `$HOME/.bubble-cli/plugins/` — user-global plugins
 */
function defaultPluginDirs(): string[] {
  const dirs: string[] = [];

  const cwdDir = join(process.cwd(), '.bubble-cli', 'plugins');
  if (existsSync(cwdDir)) dirs.push(cwdDir);

  const homeDir = join(homedir(), '.bubble-cli', 'plugins');
  if (existsSync(homeDir) && homeDir !== cwdDir) dirs.push(homeDir);

  return dirs;
}

/**
 * Discovers locally installed plugin files from a list of directories.
 * Scans for `.js`, `.cjs`, and `.mjs` files (one level deep — no recursion).
 */
async function discoverLocalPluginPaths(dirs: string[]): Promise<string[]> {
  const paths: string[] = [];

  for (const dir of dirs) {
    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        if (/\.(js|cjs|mjs)$/.test(entry)) {
          const full = join(dir, entry);
          const s = await stat(full);
          if (s.isFile()) paths.push(resolve(full));
        }
      }
    } catch {
      // Directory unreadable — silently skip
    }
  }

  return paths;
}

/**
 * Discovers globally installed npm packages whose name starts with
 * `bubble-io-cli-plugin-`.
 *
 * Runs `npm root -g` to locate the global node_modules directory,
 * then filters package names by the prefix convention.
 */
async function discoverGlobalPluginPaths(): Promise<string[]> {
  const paths: string[] = [];

  try {
    const npmRoot = execSync('npm root -g', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (!existsSync(npmRoot)) return paths;

    const entries = await readdir(npmRoot);
    for (const entry of entries) {
      if (entry.startsWith('bubble-io-cli-plugin-')) {
        const pkgDir = join(npmRoot, entry);
        const pkgJsonPath = join(pkgDir, 'package.json');
        if (existsSync(pkgJsonPath)) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const pkg = require(pkgJsonPath) as { main?: string };
            const main = pkg.main ?? 'index.js';
            const entryPath = resolve(join(pkgDir, main));
            if (existsSync(entryPath)) paths.push(entryPath);
          } catch {
            // Malformed package.json — skip
          }
        }
      }
    }
  } catch {
    // npm not available or global root unreadable — gracefully skip
  }

  return paths;
}

// ────────────────────────────────────────────────────────────────────────────
// Plugin validation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Validates that an unknown export has the minimum shape required by
 * the BubbleCLIPlugin interface.
 */
function validatePlugin(raw: unknown, source: string): { valid: true; plugin: BubbleCLIPlugin } | { valid: false; reason: string } {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, reason: `Plugin at "${source}" does not export an object.` };
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj['name'] !== 'string' || obj['name'].trim() === '') {
    return { valid: false, reason: `Plugin at "${source}" is missing a valid string "name" field.` };
  }

  if (typeof obj['register'] !== 'function') {
    return { valid: false, reason: `Plugin at "${source}" is missing a "register(program)" function.` };
  }

  return {
    valid: true,
    plugin: obj as unknown as BubbleCLIPlugin,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// In-memory registry (used by `plugin ext list`)
// ────────────────────────────────────────────────────────────────────────────

const _loaded: PluginLoadResult[] = [];

/** Returns all plugin load results from the last loadPlugins() call. */
export function getLoadedPlugins(): readonly PluginLoadResult[] {
  return _loaded;
}

// ────────────────────────────────────────────────────────────────────────────
// Main entry point
// ────────────────────────────────────────────────────────────────────────────

/**
 * Discovers and loads all plugins, registering each into the Commander program.
 *
 * Discovery order (highest priority first):
 *   1. `$CWD/.bubble-cli/plugins/*.js` — project-scoped local plugins
 *   2. `$HOME/.bubble-cli/plugins/*.js` — user-global local plugins
 *   3. Globally installed npm packages named `bubble-io-cli-plugin-*`
 *   4. Any `extraDirs` provided in options
 *
 * Each plugin is loaded in an isolated try/catch block — a broken plugin
 * will never crash the CLI or prevent other plugins from loading.
 *
 * @param program  - The root Commander instance
 * @param options  - Optional configuration
 * @returns        - Array of load results (success + errors)
 */
export async function loadPlugins(
  program: Command,
  options: LoadPluginsOptions = {}
): Promise<PluginLoadResult[]> {
  const { extraDirs = [], silent = false, requireFn, discoverFn } = options;

  // Reset registry on each call
  _loaded.length = 0;

  // Collect all plugin file paths to attempt loading
  let allPaths: string[];

  if (discoverFn) {
    // DI override: caller provides the exact list of paths (used in tests)
    allPaths = await discoverFn();
  } else {
    const localDirs = [...defaultPluginDirs(), ...extraDirs];
    const [localPaths, globalPaths] = await Promise.all([
      discoverLocalPluginPaths(localDirs),
      discoverGlobalPluginPaths(),
    ]);

    // Deduplicate (global packages might also be symlinked locally)
    const seen = new Set<string>();
    allPaths = [];
    for (const p of [...localPaths, ...globalPaths]) {
      if (!seen.has(p)) {
        seen.add(p);
        allPaths.push(p);
      }
    }
  }

  if (allPaths.length === 0) return _loaded;

  // The actual module loader — can be overridden for tests
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const load = requireFn ?? ((id: string) => require(id) as unknown);

  // Load each plugin with error isolation
  for (const pluginPath of allPaths) {
    try {
      const mod = load(pluginPath);
      // Support both `module.exports = plugin` and `module.exports.default = plugin`
      const raw = (mod && typeof mod === 'object' && 'default' in (mod as Record<string, unknown>))
        ? (mod as Record<string, unknown>)['default']
        : mod;

      const validation = validatePlugin(raw, pluginPath);

      if (!validation.valid) {
        if (!silent) {
          process.stderr.write(`⚠  bubble-io-cli plugin warning: ${validation.reason}\n`);
        }
        _loaded.push({ source: pluginPath, error: validation.reason });
        continue;
      }

      // Register the plugin into the Commander program tree
      validation.plugin.register(program);
      _loaded.push({ plugin: validation.plugin, source: pluginPath });

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const reason = `Failed to load plugin from "${pluginPath}": ${message}`;

      if (!silent) {
        process.stderr.write(`⚠  bubble-io-cli plugin error: ${reason}\n`);
      }

      _loaded.push({ source: pluginPath, error: reason });
    }
  }

  return _loaded;
}
