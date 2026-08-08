/**
 * PostgreSQL database provider for `bubble-io-cli export db --target postgres`.
 *
 * Uses the `pg` package via dynamic import (optional peer dependency).
 * Automatically creates the target table if it does not exist, infers
 * column types from Bubble record values, and upserts via ON CONFLICT.
 */

import type { DbProvider, BubbleRecord } from './index.js';

/**
 * Maps a JavaScript value to a PostgreSQL column type.
 */
function toPgType(value: unknown): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'BIGINT' : 'DOUBLE PRECISION';
  }
  if (typeof value === 'boolean') return 'BOOLEAN';
  if (typeof value === 'object' && value !== null) return 'JSONB';
  // Bubble date strings are stored as TIMESTAMPTZ when they look like ISO dates
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return 'TIMESTAMPTZ';
  }
  return 'TEXT';
}

/**
 * Quotes and lowercases a Bubble field name for use as a PostgreSQL identifier.
 */
function pgIdent(name: string): string {
  return `"${name.replace(/"/g, '""').toLowerCase().replace(/\s+/g, '_')}"`;
}

/**
 * Sanitizes a Bubble type name for use as a PostgreSQL table name.
 */
function pgTableName(typeName: string): string {
  return `"bubble_${typeName.toLowerCase().replace(/\s+/g, '_').replace(/[^\w]/g, '')}"`;
}

/**
 * Serializes a value for PostgreSQL parameterized query.
 * Objects/arrays are passed as JSON strings (stored as JSONB).
 */
function serializeValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return value;
}

export class PostgresProvider implements DbProvider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any = null;

  constructor(private readonly connectionString: string) {}

  async connect(): Promise<void> {
    try {
      const { Client } = await import('pg');
      this.client = new Client({ connectionString: this.connectionString });
      await this.client.connect();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('Cannot find module')) {
        throw new Error(
          'PostgreSQL provider requires the pg package.\n' +
          '   Install it with: npm install pg\n' +
          '   (and for TypeScript: npm install -D @types/pg)'
        );
      }
      throw err;
    }
  }

  async upsertTable(typeName: string, records: BubbleRecord[]): Promise<void> {
    if (!this.client) throw new Error('PostgresProvider: connect() was not called.');
    if (records.length === 0) return;

    const table = pgTableName(typeName);
    const firstRecord = records[0];

    // ── Build column definitions from the first record ──────────────────────
    const columns = Object.entries(firstRecord).map(([key, value]) => ({
      original: key,
      quoted: pgIdent(key),
      type: toPgType(value),
    }));

    // ── CREATE TABLE IF NOT EXISTS ───────────────────────────────────────────
    const colDefs = columns
      .map((c) => `${c.quoted} ${c.type}${c.original === '_id' ? ' PRIMARY KEY' : ''}`)
      .join(',\n    ');

    await this.client.query(`
      CREATE TABLE IF NOT EXISTS ${table} (
        ${colDefs}
      );
    `);

    // ── Add any new columns via ALTER TABLE ADD COLUMN IF NOT EXISTS ─────────
    for (const col of columns) {
      await this.client.query(`
        ALTER TABLE ${table}
        ADD COLUMN IF NOT EXISTS ${col.quoted} ${col.type};
      `);
    }

    // ── Upsert all records in a single transaction ───────────────────────────
    await this.client.query('BEGIN');
    try {
      const colNames = columns.map((c) => c.quoted).join(', ');
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
      const updates = columns
        .filter((c) => c.original !== '_id')
        .map((c) => `${c.quoted} = EXCLUDED.${c.quoted}`)
        .join(', ');

      const sql = `
        INSERT INTO ${table} (${colNames})
        VALUES (${placeholders})
        ON CONFLICT ("_id") DO UPDATE SET ${updates};
      `;

      for (const record of records) {
        const values = columns.map((c) => serializeValue(record[c.original]));
        await this.client.query(sql, values);
      }

      await this.client.query('COMMIT');
    } catch (err) {
      await this.client.query('ROLLBACK');
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    await this.client?.end();
    this.client = null;
  }
}
