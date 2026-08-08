import type { Command } from 'commander';
import chalk from 'chalk';
import type { BubbleDataType } from '../services/bubble-meta.js';
import type { SchemaDiffResult } from './schema-diff.js';

// ─────────────────────────────────────────────────────────────────────────────
// Hook Context Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Context passed to the `init` hook.
 * Fired once at CLI startup, after all plugins are loaded and before any
 * command is parsed/executed.
 */
export interface InitHookContext {
  /** The root Commander program instance. */
  program: Command;
  /** Current version of bubble-io-cli. */
  version: string;
}

/**
 * Context passed to `beforeBackup` and `afterBackup` hooks.
 */
export interface BackupHookContext {
  /** Bubble app subdomain (e.g. "my-app"). */
  appName: string;
  /** The Bubble data type being backed up (e.g. "User", "Product"). */
  dataType: string;
  /** The target environment ("version-test" | "version-live"). */
  environment: string;
  /** Absolute path to the backup file written to disk. */
  filePath: string;
  /** Total number of records exported. */
  records: number;
  /** The export format ("json" | "csv"). */
  format: 'json' | 'csv';
  /** Whether the file was encrypted with AES-256-GCM. */
  encrypted: boolean;
  /** ISO timestamp of when the backup completed. */
  timestamp: string;
  /**
   * Total duration of the backup in milliseconds.
   * Only available in `afterBackup`.
   */
  durationMs?: number;
}

/**
 * Context passed to `beforeRestore` and `afterRestore` hooks.
 */
export interface RestoreHookContext {
  /** Bubble app subdomain. */
  appName: string;
  /** The Bubble data type being restored. */
  dataType: string;
  /** The target environment. */
  environment: string;
  /** Absolute path to the backup file being restored. */
  filePath: string;
  /** Restore mode ("create" | "upsert"). */
  mode: 'create' | 'upsert';
  /** Total number of records successfully restored. Only in `afterRestore`. */
  restoredCount?: number;
  /** Number of failed records. Only in `afterRestore`. */
  errors?: number;
}

/**
 * Context passed to the `onSchemaFetch` hook.
 */
export interface SchemaFetchHookContext {
  /** Bubble app subdomain. */
  appName: string;
  /** The environment from which the schema was fetched. */
  environment: string;
  /** The full list of data types returned by the Meta API. */
  types: BubbleDataType[];
}

/**
 * Context passed to the `onSchemaDiff` hook.
 */
export interface SchemaDiffHookContext {
  /** Bubble app subdomain. */
  appName: string;
  /** The "from" environment (source for comparison). */
  envA: string;
  /** The "to" environment (target for comparison). */
  envB: string;
  /** The full computed diff result. */
  diff: SchemaDiffResult;
}

/**
 * Context passed to `beforeExport` and `afterExport` hooks.
 */
export interface ExportHookContext {
  /** Bubble app subdomain. */
  appName: string;
  /** The Bubble data type being exported. */
  dataType: string;
  /** The source Bubble environment. */
  environment: string;
  /** The database target ("sqlite" | "postgres" | "bigquery"). */
  target: 'sqlite' | 'postgres' | 'bigquery';
  /** Number of records fetched from Bubble (populated before export). */
  records: number;
  /**
   * Target-specific destination info.
   * - SQLite: the .db file path
   * - PostgreSQL: the connection string (password masked)
   * - BigQuery: "project.dataset"
   */
  destination: string;
  /** Total duration in milliseconds. Only in `afterExport`. */
  durationMs?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin Hooks Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The complete set of lifecycle hooks a plugin can implement.
 * All hooks are optional — implement only what you need.
 *
 * @example
 * ```ts
 * import type { BubbleCLIPlugin } from 'bubble-io-cli/plugin';
 *
 * const plugin: BubbleCLIPlugin = {
 *   name: 'my-plugin',
 *   register(program) { /* optional custom commands *\/ },
 *   hooks: {
 *     async afterBackup(ctx) {
 *       console.log(`Backup done: ${ctx.records} records → ${ctx.filePath}`);
 *     },
 *   },
 * };
 * export default plugin;
 * ```
 */
export interface CLIPluginHooks {
  /**
   * Called once at startup after all plugins are loaded,
   * before any command is parsed or executed.
   */
  init?(ctx: InitHookContext): void | Promise<void>;

  /** Called immediately before the Bubble API fetch begins in `backup`. */
  beforeBackup?(ctx: BackupHookContext): void | Promise<void>;

  /**
   * Called after the backup file has been written to disk (and optionally
   * encrypted / uploaded to cloud). Ideal for S3 upload, notifications, etc.
   */
  afterBackup?(ctx: BackupHookContext): void | Promise<void>;

  /** Called immediately before records are written to Bubble in `restore`. */
  beforeRestore?(ctx: RestoreHookContext): void | Promise<void>;

  /**
   * Called after all records have been processed in `restore`.
   * `ctx.restoredCount` and `ctx.errors` are populated at this point.
   */
  afterRestore?(ctx: RestoreHookContext): void | Promise<void>;

  /**
   * Called after a successful `GET /meta/types` call (schema list, diff,
   * ERD generation, migration). Ideal for schema caching or analytics.
   */
  onSchemaFetch?(ctx: SchemaFetchHookContext): void | Promise<void>;

  /**
   * Called after the diff is computed between two environments
   * (`schema diff` command). Ideal for alerting on breaking schema changes.
   */
  onSchemaDiff?(ctx: SchemaDiffHookContext): void | Promise<void>;

  /** Called immediately before database export begins. */
  beforeExport?(ctx: ExportHookContext): void | Promise<void>;

  /**
   * Called after all records have been successfully written to the target
   * database. `ctx.durationMs` is populated at this point.
   */
  afterExport?(ctx: ExportHookContext): void | Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// PluginManager
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages lifecycle hook registrations and executes them safely.
 *
 * Hooks from multiple plugins run in registration order (FIFO).
 * If a hook throws, the error is caught, logged as a warning, and the
 * remaining hooks for that event continue to execute — a broken plugin
 * never blocks the CLI or other plugins.
 */
export class PluginManager {
  private readonly _listeners: Map<keyof CLIPluginHooks, Array<{ pluginName: string; fn: (...args: unknown[]) => unknown }>> = new Map();

  /**
   * Registers all hooks declared by a plugin.
   * Called internally by the plugin loader after each successful plugin load.
   *
   * @param pluginName - Name of the plugin (for warning messages)
   * @param hooks      - The partial hooks object from the plugin
   */
  registerHooks(pluginName: string, hooks: Partial<CLIPluginHooks>): void {
    const hookNames = Object.keys(hooks) as Array<keyof CLIPluginHooks>;
    for (const hookName of hookNames) {
      const fn = hooks[hookName];
      if (typeof fn !== 'function') continue;

      if (!this._listeners.has(hookName)) {
        this._listeners.set(hookName, []);
      }
      this._listeners.get(hookName)!.push({ pluginName, fn: fn as (...args: unknown[]) => unknown });
    }
  }

  /**
   * Executes all registered hooks for a given event, passing the provided
   * context. Hooks run sequentially in registration order.
   *
   * @param hookName - The lifecycle event name
   * @param context  - The typed context object for this event
   */
  async runHook<K extends keyof CLIPluginHooks>(
    hookName: K,
    context: Parameters<NonNullable<CLIPluginHooks[K]>>[0]
  ): Promise<void> {
    const listeners = this._listeners.get(hookName);
    if (!listeners || listeners.length === 0) return;

    for (const { pluginName, fn } of listeners) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await (fn as (ctx: typeof context) => void | Promise<void>)(context);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          chalk.yellow(`⚠  [plugin: ${pluginName}] Hook "${hookName}" threw an error: ${message}\n`)
        );
      }
    }
  }

  /**
   * Returns the number of registered listeners for a given hook.
   * Useful for testing.
   */
  listenerCount(hookName: keyof CLIPluginHooks): number {
    return this._listeners.get(hookName)?.length ?? 0;
  }

  /**
   * Clears all registered hooks. Used for testing only.
   * @internal
   */
  _reset(): void {
    this._listeners.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The shared PluginManager singleton used across all CLI commands.
 * Import and call `pluginManager.runHook(...)` from any command file.
 *
 * @example
 * ```ts
 * import { pluginManager } from '../utils/plugin-manager.js';
 *
 * await pluginManager.runHook('afterBackup', {
 *   appName, dataType, environment, filePath, records, format, encrypted, timestamp, durationMs,
 * });
 * ```
 */
export const pluginManager = new PluginManager();
