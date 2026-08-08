/**
 * SQLite database provider for `bubble-io-cli export db --target sqlite`.
 *
 * Uses `sql.js` — a pure-JavaScript SQLite port compiled from WebAssembly.
 * Zero native compilation required; works on any platform without build tools.
 *
 * Data is loaded from / persisted to disk as a binary file.
 * Uses INSERT OR REPLACE to upsert records (idempotent re-runs).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import type { DbProvider, BubbleRecord } from './index.js';

/** Maps a JS value to a SQLite column type declaration. */
function toSqliteType(value: unknown): string {
  if (typeof value === 'number') return 'REAL';
  if (typeof value === 'boolean') return 'INTEGER';
  return 'TEXT';
}

/**
 * Sanitizes a Bubble field name into a valid SQLite column identifier.
 * Replaces spaces/hyphens with underscores; strips non-word characters.
 */
function sanitizeColumnName(name: string): string {
  return name.replace(/[\s\-]+/g, '_').replace(/[^\w]/g, '').toLowerCase();
}

/**
 * Serializes a value for storage in SQLite via sql.js.
 * Objects/arrays are JSON-stringified; booleans become 0/1; undefined → null.
 */
function serializeValue(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export class SqliteProvider implements DbProvider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private SQL: any = null;

  constructor(private readonly dbPath: string) {}

  async connect(): Promise<void> {
    try {
      const initSqlJs = (await import('sql.js')).default;
      // sql.js needs to locate its WASM file. When imported from node_modules
      // via dynamic import it resolves correctly from the package directory.
      this.SQL = await initSqlJs();

      if (existsSync(this.dbPath)) {
        // Load existing database from disk
        const fileBuffer = readFileSync(this.dbPath);
        this.db = new this.SQL.Database(fileBuffer);
      } else {
        // Create a new in-memory database (flushed to disk on disconnect)
        this.db = new this.SQL.Database();
      }

      // Enable WAL-equivalent: sql.js operates entirely in memory,
      // so we apply recommended pragmas for consistency.
      this.db.run('PRAGMA foreign_keys = ON;');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('Cannot find module')) {
        throw new Error(
          'SQLite provider requires sql.js.\n' +
          '   Install it with: npm install sql.js\n' +
          '   (and for TypeScript: npm install -D @types/sql.js)'
        );
      }
      throw err;
    }
  }

  async upsertTable(typeName: string, records: BubbleRecord[]): Promise<void> {
    if (!this.db) throw new Error('SqliteProvider: connect() was not called.');
    if (records.length === 0) return;

    const tableName = sanitizeColumnName(typeName);
    const firstRecord = records[0];

    // ── Build column definitions from the first record ──────────────────────
    const columns = Object.entries(firstRecord).map(([key, value]) => ({
      original: key,
      safe: sanitizeColumnName(key),
      type: toSqliteType(value),
    }));

    // ── CREATE TABLE IF NOT EXISTS ───────────────────────────────────────────
    const colDefs = columns
      .map((c) => `"${c.safe}" ${c.type}${c.safe === '_id' ? ' PRIMARY KEY' : ''}`)
      .join(',\n  ');

    this.db.run(`
      CREATE TABLE IF NOT EXISTS "${tableName}" (
        ${colDefs}
      );
    `);

    // ── Add any new columns that appeared after the first record ─────────────
    // sql.js pragma table_info returns rows as { columns: string[], values: unknown[][] }
    const tableInfoResult = this.db.exec(`PRAGMA table_info("${tableName}");`);
    const existingCols = new Set<string>();
    if (tableInfoResult.length > 0) {
      const nameColIndex = tableInfoResult[0].columns.indexOf('name');
      for (const row of tableInfoResult[0].values as unknown[][]) {
        existingCols.add(String(row[nameColIndex]));
      }
    }

    for (const col of columns) {
      if (!existingCols.has(col.safe)) {
        this.db.run(`ALTER TABLE "${tableName}" ADD COLUMN "${col.safe}" ${col.type};`);
      }
    }

    // ── Build INSERT OR REPLACE statement ────────────────────────────────────
    const colNames = columns.map((c) => `"${c.safe}"`).join(', ');
    const placeholders = columns.map(() => '?').join(', ');
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO "${tableName}" (${colNames}) VALUES (${placeholders})`
    );

    // ── Upsert all records inside a transaction (orders of magnitude faster) ─
    this.db.run('BEGIN TRANSACTION;');
    try {
      for (const record of records) {
        const values = columns.map((c) => serializeValue(record[c.original]));
        stmt.run(values);
      }
      this.db.run('COMMIT;');
    } catch (err) {
      this.db.run('ROLLBACK;');
      throw err;
    } finally {
      stmt.free();
    }
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      // Flush in-memory database to disk as a binary file
      const data: Uint8Array = this.db.export();
      writeFileSync(this.dbPath, Buffer.from(data));
      this.db.close();
      this.db = null;
    }
  }
}
