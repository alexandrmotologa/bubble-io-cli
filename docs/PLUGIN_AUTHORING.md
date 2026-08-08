# Plugin Authoring Guide — bubble-io-cli

> **Version**: 4.5.0+  
> This guide explains how to write, test, and distribute custom extension commands and lifecycle hooks for `bubble-io-cli`.

---

## Table of Contents

1. [How Plugins Work](#1-how-plugins-work)
2. [Plugin Interface](#2-plugin-interface)
3. [Quick Start (Local Plugin)](#3-quick-start-local-plugin)
4. [Lifecycle Hooks](#4-lifecycle-hooks)
5. [Hook Context Reference](#5-hook-context-reference)
6. [TypeScript Template](#6-typescript-template)
7. [Publishing to npm](#7-publishing-to-npm)
8. [Available Commander Patterns](#8-available-commander-patterns)
9. [Discovery Rules](#9-discovery-rules)
10. [Commands Reference](#10-commands-reference)
11. [Best Practices](#11-best-practices)
12. [Examples](#12-examples)

---

## 1. How Plugins Work

At startup, `bubble-io-cli` scans two locations for plugin files and globally installed npm packages:

```
startup
  └── loadPlugins(program)
        ├── $CWD/.bubble-cli/plugins/*.js     ← project-scoped
        ├── $HOME/.bubble-cli/plugins/*.js    ← user-global
        └── npm root -g / bubble-io-cli-plugin-*  ← globally installed
              │
              ▼
         plugin.register(program)    ← register custom commands
         plugin.hooks                ← register lifecycle hook listeners
              │
              ▼
         pluginManager.registerHooks(name, hooks)
```

Each discovered file is `require()`'d. If the export is a valid `BubbleCLIPlugin` object:
1. Its `register()` function is called with the root **Commander** `program` instance
2. Any `hooks` declared are registered in the `PluginManager` singleton

Lifecycle hooks fire **automatically** when the corresponding CLI command runs — no extra flags or configuration needed. Broken plugins are isolated — they cannot crash the CLI or prevent other plugins from loading.

---

## 2. Plugin Interface

```typescript
export interface BubbleCLIPlugin {
  /** Unique identifier for your plugin (e.g. 'my-analytics'). */
  name: string;

  /** Optional semver version string — shown in `plugin ext list`. */
  version?: string;

  /** Optional one-line description. */
  description?: string;

  /**
   * Called once at CLI startup with the root Commander program.
   * Use this to register your custom commands.
   * Can be a no-op `register(_program) {}` if you only use hooks.
   */
  register(program: import('commander').Command): void;

  /**
   * Optional lifecycle hooks — react to events from existing CLI commands
   * without modifying core source code.
   * All hooks are optional; implement only what you need.
   */
  hooks?: Partial<CLIPluginHooks>;
}
```

You can import these types from `bubble-io-cli/plugin` and `bubble-io-cli/hooks`:

```typescript
import type { BubbleCLIPlugin } from 'bubble-io-cli/plugin';
import type { CLIPluginHooks, BackupHookContext } from 'bubble-io-cli/hooks';
```

---

## 3. Quick Start (Local Plugin)

The fastest way to try a plugin is to place a `.js` file in your user-global plugin directory:

```bash
mkdir -p ~/.bubble-cli/plugins
```

Create `~/.bubble-cli/plugins/hello.js`:

```js
module.exports = {
  name: 'hello',
  version: '0.0.1',
  description: 'Greets the world',
  register(program) {
    program
      .command('hello [name]')
      .description('Say hello from a plugin')
      .action((name = 'World') => {
        console.log(`Hello, ${name}! 👋`);
      });
  },
};
```

Now run:

```bash
bubble-io-cli hello
# → Hello, World! 👋
```

Verify it's loaded:

```bash
bubble-io-cli plugin ext list
```

---

## 4. Lifecycle Hooks

Lifecycle hooks let your plugin react to events from existing CLI commands **without modifying the core source code**. This is the most powerful extensibility pattern.

### Available Hooks

| Hook | Fires when | Context type |
|---|---|---|
| `init` | CLI starts, after all plugins are loaded | `InitHookContext` |
| `beforeBackup` | Before Bubble API fetch in `backup` | `BackupHookContext` |
| `afterBackup` | After backup file is written to disk | `BackupHookContext` |
| `beforeRestore` | Before records are written in `restore` | `RestoreHookContext` |
| `afterRestore` | After all records are processed in `restore` | `RestoreHookContext` |
| `onSchemaFetch` | After `GET /meta/types` succeeds | `SchemaFetchHookContext` |
| `onSchemaDiff` | After diff is computed in `schema diff` | `SchemaDiffHookContext` |
| `beforeExport` | Before database connection in `export db` | `ExportHookContext` |
| `afterExport` | After records are written to the database | `ExportHookContext` |

### Hook Execution Rules

- Hooks run **sequentially** in registration order (FIFO across plugins)
- Hooks are **awaited** — async hooks are fully supported
- A hook that **throws** is caught and logged as a warning; other plugins' hooks continue
- Hooks are **entirely optional** — a plugin with no `hooks` field works exactly as before

### Minimal Hook Plugin

```js
// ~/.bubble-cli/plugins/logger.js
module.exports = {
  name: 'logger',
  version: '1.0.0',
  description: 'Logs backup events',
  register(_program) {},  // no custom commands
  hooks: {
    afterBackup(ctx) {
      console.log(`[logger] Backup done: ${ctx.records} records → ${ctx.filePath}`);
    },
  },
};
```

---

## 5. Hook Context Reference

### `InitHookContext`
```typescript
interface InitHookContext {
  program: Command;   // Root Commander instance
  version: string;   // e.g. "4.5.0"
}
```

### `BackupHookContext`
```typescript
interface BackupHookContext {
  appName: string;            // Bubble app subdomain
  dataType: string;           // e.g. "User", "Product"
  environment: string;        // "version-test" | "version-live"
  filePath: string;           // Absolute path to the backup file
  records: number;            // Total records exported
  format: 'json' | 'csv';    // Export format
  encrypted: boolean;         // Whether AES-256-GCM encryption was applied
  timestamp: string;          // ISO timestamp of completion
  durationMs?: number;        // Only in afterBackup: total duration in ms
}
```

### `RestoreHookContext`
```typescript
interface RestoreHookContext {
  appName: string;
  dataType: string;
  environment: string;
  filePath: string;           // Path to the backup file being restored
  mode: 'create' | 'upsert';
  restoredCount?: number;     // Only in afterRestore: total records processed
  errors?: number;            // Only in afterRestore: failed record count
}
```

### `SchemaFetchHookContext`
```typescript
interface SchemaFetchHookContext {
  appName: string;
  environment: string;
  types: BubbleDataType[];    // Full schema from Meta API
}
```

### `SchemaDiffHookContext`
```typescript
interface SchemaDiffHookContext {
  appName: string;
  envA: string;               // Source environment
  envB: string;               // Target environment
  diff: SchemaDiffResult;     // Full computed diff
}
```

### `ExportHookContext`
```typescript
interface ExportHookContext {
  appName: string;
  dataType: string;
  environment: string;
  target: 'sqlite' | 'postgres' | 'bigquery';
  records: number;
  destination: string;        // SQLite path, masked PG connection, or "project.dataset"
  durationMs?: number;        // Only in afterExport
}
```

---

## 6. TypeScript Template

For a full TypeScript plugin with type safety:

```typescript
// src/index.ts
import { Command } from 'commander';
import type { BubbleCLIPlugin } from 'bubble-io-cli/plugin';
import type { BackupHookContext, SchemaDiffHookContext } from 'bubble-io-cli/hooks';

const plugin: BubbleCLIPlugin = {
  name: 'my-plugin',
  version: '1.0.0',
  description: 'My custom bubble-io-cli extension',

  register(program: Command): void {
    program
      .command('my-cmd')
      .description('My custom command')
      .option('-v, --verbose', 'Enable verbose output')
      .action((options: { verbose?: boolean }) => {
        if (options.verbose) {
          console.log('[verbose] Running my-cmd...');
        }
        console.log('✅ my-cmd executed!');
      });
  },

  hooks: {
    async afterBackup(ctx: BackupHookContext): Promise<void> {
      console.log(`[my-plugin] Backup complete: ${ctx.records} records`);
      // e.g. upload ctx.filePath to cloud storage
    },

    async onSchemaDiff(ctx: SchemaDiffHookContext): Promise<void> {
      if (!ctx.diff.identical) {
        console.log(`[my-plugin] Schema changes detected between ${ctx.envA} and ${ctx.envB}`);
      }
    },
  },
};

export default plugin;
```

Compile to CommonJS (`tsconfig.json`):

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2020",
    "outDir": "dist",
    "declaration": true
  }
}
```

`package.json`:

```json
{
  "name": "bubble-io-cli-plugin-my-plugin",
  "version": "1.0.0",
  "main": "dist/index.js",
  "peerDependencies": {
    "bubble-io-cli": ">=4.5.0"
  }
}
```

---

## 7. Publishing to npm

To make your plugin auto-discoverable when installed globally, the package name **must** follow this convention:

```
bubble-io-cli-plugin-<your-name>
```

### Steps

```bash
# 1. Build your plugin
npm run build

# 2. Test locally before publishing
npm link
bubble-io-cli plugin ext list  # Should show your plugin

# 3. Publish to npm
npm publish --access public
```

### Users install it with:

```bash
npm install -g bubble-io-cli-plugin-your-name
```

After installation, the plugin is automatically discovered the next time `bubble-io-cli` runs.

---

## 8. Available Commander Patterns

Inside `register(program)`, you have full access to the Commander API.

### Add a top-level command

```js
register(program) {
  program
    .command('export-csv <dataType>')
    .description('Export a Bubble data type to CSV')
    .option('-o, --output <file>', 'Output file path', 'export.csv')
    .action(async (dataType, options) => {
      // your logic here
    });
}
```

### Add a sub-command group

```js
register(program) {
  const analytics = program.command('analytics').description('Analytics tools');

  analytics
    .command('events')
    .description('List tracked events')
    .action(() => { /* ... */ });

  analytics
    .command('funnel')
    .description('Show conversion funnel')
    .action(() => { /* ... */ });
}
```

### Access stored credentials

```js
import { storage } from 'bubble-io-cli/dist/utils/storage.js';

register(program) {
  program.command('my-cmd').action(() => {
    const config = storage.getConfig();
    if (!config) {
      console.error('No credentials. Run: bubble-io-cli config --app <name> --key <key>');
      process.exit(1);
    }
    console.log(`Connected to: ${config.appName}`);
  });
}
```

---

## 9. Discovery Rules

| Priority | Location | Description |
|---|---|---|
| 1 (highest) | `$CWD/.bubble-cli/plugins/` | Project-scoped plugins — committed to repo |
| 2 | `$HOME/.bubble-cli/plugins/` | User-global plugins — personal tools |
| 3 (lowest) | `npm root -g / bubble-io-cli-plugin-*` | Globally installed npm packages |

**File extensions supported**: `.js`, `.cjs`, `.mjs`

**Deduplication**: If the same resolved path appears in multiple discovery sources, it is only loaded once.

---

## 10. Commands Reference

```bash
# List all discovered CLI extension plugins
bubble-io-cli plugin ext list [--json]

# Show details about a specific plugin
bubble-io-cli plugin ext info <plugin-name> [--json]

# Force a fresh plugin discovery and reload
bubble-io-cli plugin ext reload [--json]
```

---

## 11. Best Practices

| ✅ Do | ❌ Avoid |
|---|---|
| Use unique, descriptive command names | Shadowing built-in commands (e.g., `config`, `backup`) |
| Handle errors gracefully with `chalk.red` | Throwing uncaught errors that crash the parent CLI |
| Expose a `--json` flag for machine-readable output | Mixing JSON and human output on the same flag |
| Use `ora` spinners for async operations | Blocking the event loop with sync operations |
| Add `peerDependencies` on `bubble-io-cli >= 4.5.0` | Bundling `commander` or `chalk` (use peerDeps) |
| Keep `register()` synchronous when possible | Running async work at module import time |
| Handle hook errors gracefully — don't re-throw | Letting hook errors propagate (they get swallowed anyway) |
| Use `ctx.durationMs` only in `after*` hooks | Reading `durationMs` in `before*` hooks (it's undefined there) |

---

## 12. Examples

The `examples/` directory in the repository contains two full plugin examples:

### [`examples/plugin-s3-backup/index.js`](../examples/plugin-s3-backup/index.js)

Demonstrates the `afterBackup` hook to automatically upload every backup file to an S3 bucket using the AWS CLI.

### [`examples/plugin-slack-notifier/index.js`](../examples/plugin-slack-notifier/index.js)

Demonstrates four hooks (`afterBackup`, `afterRestore`, `onSchemaDiff`, `afterExport`) to send rich Slack notifications for each event using Node.js built-in `https`.

### Inline: Schema Change Alert

```js
// ~/.bubble-cli/plugins/schema-alert.js
module.exports = {
  name: 'schema-alert',
  version: '1.0.0',
  description: 'Alerts when breaking schema changes are detected',
  register(_program) {},
  hooks: {
    async onSchemaDiff(ctx) {
      const breaking = ctx.diff.removedTypes.length + ctx.diff.modifiedTypes.length;
      if (breaking > 0) {
        console.warn(`\n⚠️  [schema-alert] ${breaking} BREAKING change(s) detected between ${ctx.envA} → ${ctx.envB}`);
        // In CI/CD: could also call process.exit(1) to block deployments
      }
    },
  },
};
```

### Inline: Database Export Logger

```js
// ~/.bubble-cli/plugins/export-logger.js
const fs = require('fs');

module.exports = {
  name: 'export-logger',
  version: '1.0.0',
  description: 'Appends export events to a local audit log',
  register(_program) {},
  hooks: {
    afterExport(ctx) {
      const entry = JSON.stringify({
        event: 'export',
        ...ctx,
        at: new Date().toISOString(),
      }) + '\n';
      fs.appendFileSync('./bubble-audit.log', entry, 'utf-8');
    },
  },
};
```
