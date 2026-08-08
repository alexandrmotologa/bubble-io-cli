/**
 * DbProvider interface and factory for the `export db` command.
 *
 * Each provider implements a unified interface so the export command
 * can work with any database target without knowing its internals.
 */

/** A single Bubble record — arbitrary key/value pairs. */
export type BubbleRecord = Record<string, unknown>;

/**
 * Common interface that every database provider must implement.
 * Providers are responsible for connection lifecycle and data upsert.
 */
export interface DbProvider {
  /** Establish the connection to the target database. */
  connect(): Promise<void>;

  /**
   * Ensure the target table/dataset exists and upsert all records.
   * The provider infers the schema from the first batch of records.
   *
   * @param typeName  Bubble data type name (becomes the table name)
   * @param records   Array of Bubble records fetched from the API
   */
  upsertTable(typeName: string, records: BubbleRecord[]): Promise<void>;

  /** Close the connection and release any resources. */
  disconnect(): Promise<void>;
}

// ── Provider option shapes ────────────────────────────────────────────────────

export interface SqliteProviderOptions {
  target: 'sqlite';
  /** Absolute or relative path to the SQLite database file */
  db: string;
}

export interface PostgresProviderOptions {
  target: 'postgres';
  /** Full PostgreSQL connection string, e.g. postgresql://user:pass@host/db */
  connectionString: string;
}

export interface BigQueryProviderOptions {
  target: 'bigquery';
  /** GCP project ID */
  project: string;
  /** BigQuery dataset ID (will be created if it does not exist) */
  dataset: string;
  /** Optional path to a service account key JSON file */
  keyFile?: string;
}

export type DbProviderOptions =
  | SqliteProviderOptions
  | PostgresProviderOptions
  | BigQueryProviderOptions;

/**
 * Factory function — resolves and returns the correct DbProvider implementation.
 * Providers for optional heavy dependencies (pg, BigQuery) use dynamic import
 * so the core CLI bundle stays lightweight.
 */
export async function getDbProvider(opts: DbProviderOptions): Promise<DbProvider> {
  switch (opts.target) {
    case 'sqlite': {
      const { SqliteProvider } = await import('./sqlite.js');
      return new SqliteProvider(opts.db);
    }
    case 'postgres': {
      const { PostgresProvider } = await import('./postgres.js');
      return new PostgresProvider(opts.connectionString);
    }
    case 'bigquery': {
      const { BigQueryProvider } = await import('./bigquery.js');
      return new BigQueryProvider(opts.project, opts.dataset, opts.keyFile);
    }
    default: {
      // TypeScript exhaustiveness guard
      const exhaustive: never = opts;
      throw new Error(`Unknown DB target: ${JSON.stringify(exhaustive)}`);
    }
  }
}
