# Plugin Authoring Guide — bubble-io-cli

> **Version**: 3.3.0+  
> This guide explains how to write, test, and distribute custom extension commands for `bubble-io-cli`.

---

## Table of Contents

1. [How Plugins Work](#1-how-plugins-work)
2. [Plugin Interface](#2-plugin-interface)
3. [Quick Start (Local Plugin)](#3-quick-start-local-plugin)
4. [TypeScript Template](#4-typescript-template)
5. [Publishing to npm](#5-publishing-to-npm)
6. [Available Commander Patterns](#6-available-commander-patterns)
7. [Discovery Rules](#7-discovery-rules)
8. [Commands Reference](#8-commands-reference)
9. [Best Practices](#9-best-practices)
10. [Examples](#10-examples)

---

## 1. How Plugins Work

At startup, `bubble-io-cli` scans two locations for plugin files and globally installed npm packages:

```
startup
  └── loadPlugins(program)
        ├── $CWD/.bubble-cli/plugins/*.js     ← project-scoped
        ├── $HOME/.bubble-cli/plugins/*.js    ← user-global
        └── npm root -g / bubble-io-cli-plugin-*  ← globally installed
```

Each discovered file is `require()`'d. If the export is a valid `BubbleCLIPlugin` object, its `register()` function is called with the root **Commander** `program` instance. Broken plugins are isolated — they cannot crash the CLI for other users.

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
   * Use this to register your commands.
   */
  register(program: import('commander').Command): void;
}
```

You can import this type from `bubble-io-cli/plugin` in your TypeScript project:

```typescript
import type { BubbleCLIPlugin } from 'bubble-io-cli/plugin';
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

bubble-io-cli hello Bubble
# → Hello, Bubble! 👋
```

Verify it's loaded:

```bash
bubble-io-cli plugin ext list
```

---

## 4. TypeScript Template

For a full TypeScript plugin with type safety:

```typescript
// src/index.ts
import { Command } from 'commander';
import type { BubbleCLIPlugin } from 'bubble-io-cli/plugin';

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
    "bubble-io-cli": ">=3.3.0"
  }
}
```

---

## 5. Publishing to npm

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

## 6. Available Commander Patterns

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

## 7. Discovery Rules

| Priority | Location | Description |
|---|---|---|
| 1 (highest) | `$CWD/.bubble-cli/plugins/` | Project-scoped plugins — committed to repo |
| 2 | `$HOME/.bubble-cli/plugins/` | User-global plugins — personal tools |
| 3 (lowest) | `npm root -g / bubble-io-cli-plugin-*` | Globally installed npm packages |

**File extensions supported**: `.js`, `.cjs`, `.mjs`

**Deduplication**: If the same resolved path appears in multiple discovery sources, it is only loaded once.

---

## 8. Commands Reference

```bash
# List all discovered CLI extension plugins
bubble-io-cli plugin ext list [--json]

# Show details about a specific plugin
bubble-io-cli plugin ext info <plugin-name> [--json]

# Force a fresh plugin discovery and reload
bubble-io-cli plugin ext reload [--json]
```

---

## 9. Best Practices

| ✅ Do | ❌ Avoid |
|---|---|
| Use unique, descriptive command names | Shadowing built-in commands (e.g., `config`, `backup`) |
| Handle errors gracefully with `chalk.red` | Throwing uncaught errors that crash the parent CLI |
| Expose a `--json` flag for machine-readable output | Mixing JSON and human output on the same flag |
| Use `ora` spinners for async operations | Blocking the event loop with sync operations |
| Add `peerDependencies` on `bubble-io-cli >= 3.3.0` | Bundling `commander` or `chalk` (use peerDeps) |
| Keep `register()` synchronous when possible | Running async work at module import time |

---

## 10. Examples

### Example: Data Export Command

```js
// ~/.bubble-cli/plugins/export-json.js
const fs = require('fs');

module.exports = {
  name: 'export-json',
  version: '1.0.0',
  description: 'Export Bubble data types to JSON files',

  register(program) {
    program
      .command('export-json <dataType>')
      .description('Export a Bubble data type to a JSON file')
      .option('-o, --output <path>', 'Output file', './export.json')
      .option('-p, --profile <name>', 'Config profile to use')
      .action(async (dataType, options) => {
        // Read config
        const { storage } = require('bubble-io-cli/dist/utils/storage.js');
        const config = storage.getConfig(options.profile);
        if (!config) {
          console.error('No credentials configured.');
          process.exit(1);
        }

        // Fetch data using bubble-io-cli's API client
        const { BubbleApiClient } = require('bubble-io-cli/dist/services/bubble-api.js');
        const client = new BubbleApiClient(config.appName, config.apiKey);
        const result = await client.getAllRecords(dataType);

        // Write to file
        fs.writeFileSync(options.output, JSON.stringify(result.results, null, 2));
        console.log(`✅ Exported ${result.totalFetched} records to ${options.output}`);
      });
  },
};
```

### Example: Webhook Trigger Command

```js
// ~/.bubble-cli/plugins/trigger-webhook.js
const https = require('https');

module.exports = {
  name: 'trigger-webhook',
  version: '1.0.0',
  description: 'Trigger a Bubble backend workflow via API',

  register(program) {
    program
      .command('trigger <workflowName>')
      .description('Trigger a Bubble API workflow by name')
      .option('-d, --data <json>', 'JSON payload to send', '{}')
      .action(async (workflowName, options) => {
        const payload = JSON.parse(options.data);
        console.log(`Triggering workflow: ${workflowName}...`);
        // Your HTTP trigger logic here
      });
  },
};
```
