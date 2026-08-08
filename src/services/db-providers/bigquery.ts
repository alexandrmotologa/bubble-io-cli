/**
 * BigQuery database provider for `bubble-io-cli export db --target bigquery`.
 *
 * Uses `@google-cloud/bigquery` via dynamic import (optional peer dependency).
 * Automatically creates the target dataset and table if they do not exist.
 * Infers BigQuery schema from Bubble record values.
 * Uses streaming insert for simple, high-throughput writes.
 *
 * Authentication: uses Application Default Credentials (ADC) by default.
 * Optionally accepts a service account key file via --key-file.
 *
 * NOTE: @google-cloud/bigquery is a peerDependency (optional).
 * Install with: npm install @google-cloud/bigquery
 */

import type { DbProvider, BubbleRecord } from './index.js';

// ── BigQuery type definitions (subset we need) ────────────────────────────────

interface BQFieldSchema {
  name: string;
  type: 'STRING' | 'FLOAT64' | 'INT64' | 'BOOL' | 'TIMESTAMP' | 'JSON';
  mode: 'NULLABLE';
}

/**
 * Maps a JavaScript value to a BigQuery field type.
 */
function toBqType(value: unknown): BQFieldSchema['type'] {
  if (typeof value === 'boolean') return 'BOOL';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'INT64' : 'FLOAT64';
  }
  if (typeof value === 'object' && value !== null) return 'JSON';
  // Detect ISO 8601 date strings — store as TIMESTAMP
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/.test(value)) {
    return 'TIMESTAMP';
  }
  return 'STRING';
}

/**
 * Sanitizes a Bubble field name into a valid BigQuery column name.
 * BigQuery column names: letters, numbers, underscores; max 300 chars.
 */
function bqColumnName(name: string): string {
  return name
    .replace(/\s+/g, '_')
    .replace(/[^\w]/g, '')
    .toLowerCase()
    .slice(0, 300);
}

/**
 * Sanitizes a Bubble type name into a valid BigQuery table name.
 */
function bqTableName(typeName: string): string {
  return `bubble_${typeName.toLowerCase().replace(/\s+/g, '_').replace(/[^\w]/g, '')}`;
}

/**
 * Serializes a record for BigQuery streaming insert.
 * BigQuery expects dates as ISO strings; objects as JSON strings (for JSON type).
 */
function serializeRecord(
  record: BubbleRecord,
  columnMap: Map<string, string>
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [original, bqName] of columnMap.entries()) {
    const value = record[original];
    if (value === undefined || value === null) {
      row[bqName] = null;
    } else if (typeof value === 'object') {
      row[bqName] = JSON.stringify(value);
    } else {
      row[bqName] = value;
    }
  }
  return row;
}

export class BigQueryProvider implements DbProvider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private bq: any = null;

  constructor(
    private readonly projectId: string,
    private readonly datasetId: string,
    private readonly keyFile?: string
  ) {}

  async connect(): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bqModule = await import('@google-cloud/bigquery' as string) as any;
      const BigQuery = bqModule.BigQuery ?? bqModule.default?.BigQuery;
      this.bq = new BigQuery({
        projectId: this.projectId,
        ...(this.keyFile ? { keyFilename: this.keyFile } : {}),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('Cannot find module')) {
        throw new Error(
          'BigQuery provider requires @google-cloud/bigquery.\n' +
          '   Install it with: npm install @google-cloud/bigquery\n\n' +
          '   Authentication options:\n' +
          '   1. Application Default Credentials (ADC): gcloud auth application-default login\n' +
          '   2. Service account key file: bubble-io-cli export db --target bigquery --key-file ./key.json'
        );
      }
      throw err;
    }
  }

  async upsertTable(typeName: string, records: BubbleRecord[]): Promise<void> {
    if (!this.bq) throw new Error('BigQueryProvider: connect() was not called.');
    if (records.length === 0) return;

    const tableId = bqTableName(typeName);
    const firstRecord = records[0];

    // ── Build BigQuery schema ────────────────────────────────────────────────
    const columnMap = new Map<string, string>(); // originalName → bqName
    const schema: BQFieldSchema[] = [];

    for (const [key, value] of Object.entries(firstRecord)) {
      const bqName = bqColumnName(key);
      columnMap.set(key, bqName);
      schema.push({ name: bqName, type: toBqType(value), mode: 'NULLABLE' });
    }

    // ── Ensure dataset exists ────────────────────────────────────────────────
    const dataset = this.bq.dataset(this.datasetId);
    const [datasetExists] = await dataset.exists();
    if (!datasetExists) {
      await dataset.create({ location: 'US' });
    }

    // ── Ensure table exists (or create it) ───────────────────────────────────
    const table = dataset.table(tableId);
    const [tableExists] = await table.exists();

    if (!tableExists) {
      await table.create({ schema });
    } else {
      // ── Extend schema with any new columns ─────────────────────────────────
      const [metadata] = await table.getMetadata();
      const existingNames = new Set<string>(
        (metadata.schema?.fields as Array<{ name: string }> ?? []).map((f) => f.name)
      );

      const newFields = schema.filter((f) => !existingNames.has(f.name));
      if (newFields.length > 0) {
        metadata.schema.fields.push(...newFields);
        await table.setMetadata(metadata);
      }
    }

    // ── Stream insert in batches of 500 (BigQuery limit) ────────────────────
    const BATCH_SIZE = 500;
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const rows = batch.map((r) => ({
        // Use _id as the insertId for deduplication (best-effort)
        insertId: String(r['_id'] ?? `${Date.now()}-${i}`),
        json: serializeRecord(r, columnMap),
      }));
      await table.insert(rows, { skipInvalidRows: false, ignoreUnknownValues: false });
    }
  }

  async disconnect(): Promise<void> {
    // BigQuery HTTP client — no persistent connection to close
    this.bq = null;
  }
}
