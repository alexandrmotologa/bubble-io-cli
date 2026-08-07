import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import express, { Request, Response } from 'express';

/**
 * A Bubble backup file envelope (as produced by `bubble-io-cli backup`).
 */
interface BackupFile {
  meta?: {
    dataType?: string;
    app?: string;
    environment?: string;
  };
  data: Record<string, unknown>[];
}

/**
 * In-memory data store for the mock server.
 * Keyed by data type name (e.g. "Product", "User").
 */
interface MockStore {
  [dataType: string]: Record<string, unknown>[];
}

/**
 * Registers the `mock` sub-command.
 *
 * Starts a local HTTP server that exposes a Bubble-compatible Data API from a local
 * backup JSON file. Useful for offline development and integration testing without
 * hitting the live Bubble API.
 *
 * The mock server supports:
 *   GET  /api/1.1/obj/<type>?cursor=0&limit=100  — paginated list
 *   GET  /api/1.1/obj/<type>/:id                 — single record
 *   POST /api/1.1/obj/<type>                     — create (in-memory, not persisted)
 *   PATCH /api/1.1/obj/<type>/:id                — update (in-memory)
 *   DELETE /api/1.1/obj/<type>/:id               — delete (in-memory)
 *
 * Usage:
 *   bubble-io-cli mock --file ./backup-product-2026-08-01.json
 *   bubble-io-cli mock --file ./backup-product.json --port 4000
 *   bubble-io-cli mock --file ./backup-product.json --type Product --port 3333
 *   bubble-io-cli mock --multi --file product=./backup-product.json --file user=./backup-user.json
 */
export function registerMockCommand(program: Command): void {
  program
    .command('mock')
    .description('Start a local Bubble-compatible mock API server from backup JSON files')
    .requiredOption('-f, --file <path>', 'Path to a backup JSON file (or "Type=path" for multi-type loading)')
    .option('-p, --port <number>', 'Port to listen on', '3333')
    .option('-t, --type <datatype>', 'Override the data type name from the backup file')
    .option('--cors', 'Enable CORS headers (for browser-based testing)')
    .action(async (options: {
      file: string | string[];
      port: string;
      type?: string;
      cors?: boolean;
    }) => {
      const port = parseInt(options.port, 10);
      if (isNaN(port) || port < 1024 || port > 65535) {
        console.error(chalk.red(`❌ Invalid --port "${options.port}". Must be between 1024 and 65535.`));
        process.exit(1);
      }

      // ── Load backup file(s) into the in-memory store ──────────────────────
      const store: MockStore = {};

      const files = Array.isArray(options.file) ? options.file : [options.file];

      for (const fileEntry of files) {
        // Support "TypeName=./path/to/file.json" syntax for multi-type loading
        let filePath: string;
        let typeOverride: string | undefined;

        if (fileEntry.includes('=')) {
          const [typePart, pathPart] = fileEntry.split('=');
          typeOverride = typePart;
          filePath = pathPart;
        } else {
          filePath = fileEntry;
          typeOverride = options.type;
        }

        let raw: BackupFile;
        try {
          raw = JSON.parse(readFileSync(filePath, 'utf-8')) as BackupFile;
        } catch (e) {
          console.error(chalk.red(`❌ Could not read file "${filePath}": ${e instanceof Error ? e.message : String(e)}`));
          process.exit(1);
        }

        if (!Array.isArray(raw.data)) {
          console.error(chalk.red(`❌ File "${filePath}" is not a valid bubble-io-cli backup (missing "data" array).`));
          process.exit(1);
        }

        const dataType = typeOverride ?? raw.meta?.dataType;
        if (!dataType) {
          console.error(chalk.red(`❌ Could not determine data type from "${filePath}". Use --type or "Type=path" syntax.`));
          process.exit(1);
        }

        store[dataType] = raw.data.map((r, i) => ({
          ...r,
          _id: (r as Record<string, unknown>)['_id'] ?? `mock-${dataType}-${i}`,
        }));

        console.log(
          chalk.dim(`  📦 Loaded ${chalk.bold(String(store[dataType].length))} records for type `) +
          chalk.cyan(dataType)
        );
      }

      // ── Express app ────────────────────────────────────────────────────────
      const app = express();
      app.use(express.json());

      // Optional CORS headers
      if (options.cors) {
        app.use((_req: Request, res: Response, next) => {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          next();
        });
      }

      const BASE = '/api/1.1/obj';

      // GET /api/1.1/obj/:type  — paginated list (Bubble-compatible envelope)
      app.get(`${BASE}/:type`, (req: Request, res: Response) => {
        const { type } = req.params;
        const records = store[type] ?? store[type.toLowerCase()] ?? [];

        const cursor = parseInt(String(req.query['cursor'] ?? '0'), 10);
        const limit = Math.min(parseInt(String(req.query['limit'] ?? '100'), 10), 100);

        const page = records.slice(cursor, cursor + limit);
        const remaining = Math.max(0, records.length - cursor - limit);

        res.json({
          response: {
            cursor,
            count: page.length,
            remaining,
            results: page,
          },
        });
      });

      // GET /api/1.1/obj/:type/:id  — single record
      app.get(`${BASE}/:type/:id`, (req: Request, res: Response) => {
        const { type, id } = req.params;
        const records = store[type] ?? [];
        const record = records.find((r) => (r as Record<string, unknown>)['_id'] === id);

        if (!record) {
          res.status(404).json({ error: `Record "${id}" not found in type "${type}"` });
          return;
        }
        res.json({ response: record });
      });

      // POST /api/1.1/obj/:type  — create (in-memory)
      app.post(`${BASE}/:type`, (req: Request, res: Response) => {
        const { type } = req.params;
        if (!store[type]) store[type] = [];

        const newId = `mock-${type}-${Date.now()}`;
        const newRecord = { ...req.body, _id: newId, 'Created Date': new Date().toISOString() };
        store[type].push(newRecord as Record<string, unknown>);

        res.status(201).json({ id: newId });
      });

      // PATCH /api/1.1/obj/:type/:id  — update (in-memory)
      app.patch(`${BASE}/:type/:id`, (req: Request, res: Response) => {
        const { type, id } = req.params;
        const records = store[type] ?? [];
        const idx = records.findIndex((r) => (r as Record<string, unknown>)['_id'] === id);

        if (idx === -1) {
          res.status(404).json({ error: `Record "${id}" not found in type "${type}"` });
          return;
        }

        store[type][idx] = { ...store[type][idx], ...req.body, 'Modified Date': new Date().toISOString() };
        res.json({ status: 'ok' });
      });

      // DELETE /api/1.1/obj/:type/:id  — delete (in-memory)
      app.delete(`${BASE}/:type/:id`, (req: Request, res: Response) => {
        const { type, id } = req.params;
        const before = (store[type] ?? []).length;
        store[type] = (store[type] ?? []).filter((r) => (r as Record<string, unknown>)['_id'] !== id);

        if (store[type].length === before) {
          res.status(404).json({ error: `Record "${id}" not found in type "${type}"` });
          return;
        }
        res.json({ status: 'ok' });
      });

      // Health endpoint
      app.get('/health', (_req: Request, res: Response) => {
        const types = Object.entries(store).map(([t, r]) => ({ type: t, count: r.length }));
        res.json({ status: 'ok', mock: true, types });
      });

      // ── Start server ───────────────────────────────────────────────────────
      const server = app.listen(port, () => {
        console.log(chalk.cyan(`\n🫧  bubble-io-cli Mock Server\n`));
        console.log(`   ${chalk.bold('Status:  ')} ${chalk.green('Running')}`);
        console.log(`   ${chalk.bold('Port:    ')} ${chalk.cyan(String(port))}`);
        console.log(`   ${chalk.bold('Base URL:')} ${chalk.cyan(`http://localhost:${port}${BASE}`)}`);
        console.log(`   ${chalk.bold('CORS:    ')} ${options.cors ? chalk.green('enabled') : chalk.dim('disabled')}`);
        console.log();
        console.log(chalk.bold('   Loaded types:'));
        Object.entries(store).forEach(([t, r]) => {
          console.log(`     ${chalk.cyan('·')} ${chalk.bold(t)} — ${r.length} records`);
        });
        console.log();
        console.log(chalk.dim('   Routes:'));
        console.log(chalk.dim(`     GET    ${BASE}/:type?cursor=0&limit=100`));
        console.log(chalk.dim(`     GET    ${BASE}/:type/:id`));
        console.log(chalk.dim(`     POST   ${BASE}/:type`));
        console.log(chalk.dim(`     PATCH  ${BASE}/:type/:id`));
        console.log(chalk.dim(`     DELETE ${BASE}/:type/:id`));
        console.log(chalk.dim(`     GET    /health`));
        console.log();
        console.log(chalk.dim('   Press Ctrl+C to stop.\n'));
      });

      // Graceful shutdown
      const shutdown = (): void => {
        console.log(chalk.yellow('\n\nMock server stopped.\n'));
        server.close(() => process.exit(0));
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    });
}
