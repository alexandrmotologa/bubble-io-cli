import { readFile, writeFile, readdir, mkdir } from 'fs/promises';
import { join, resolve, basename } from 'path';
import { BubbleDataType, BubbleField } from '../services/bubble-meta.js';

/**
 * Supported migration change actions.
 */
export type MigrationAction =
  | 'ADD_TABLE'
  | 'REMOVE_TABLE'
  | 'ADD_FIELD'
  | 'REMOVE_FIELD'
  | 'CHANGE_FIELD_TYPE';

/**
 * A single discrete schema change within a migration.
 */
export interface MigrationChange {
  action: MigrationAction;
  table: string;
  field?: string;
  type?: string;
  previousType?: string;
  optionList?: string;
  fields?: Array<{
    id: string;
    display: string;
    type: string;
    optionList?: string;
  }>;
}

/**
 * A version-controlled JSON migration file document.
 */
export interface MigrationDocument {
  version: string;
  name: string;
  description?: string;
  createdAt: string;
  app: string;
  environment: string;
  fromEnvironment?: string | null;
  changes: MigrationChange[];
}

/**
 * Schema lockfile snapshot structure (`schema.lock.json`).
 */
export interface SchemaLockfile {
  version: string;
  lastMigration?: string | null;
  updatedAt: string;
  app: string;
  environment: string;
  types: BubbleDataType[];
}

/**
 * Entry summary when listing migrations.
 */
export interface MigrationListEntry {
  version: string;
  name: string;
  description?: string;
  createdAt: string;
  app: string;
  environment: string;
  fromEnvironment?: string | null;
  changesCount: number;
  filename: string;
  filePath: string;
}

/**
 * Options for generating a migration or snapshot.
 */
export interface GenerateMigrationOptions {
  name: string;
  description?: string;
  app: string;
  environment: string;
  migrationsDir?: string;
  currentTypes: BubbleDataType[];
  previousTypes?: BubbleDataType[];
  fromEnvironment?: string;
  snapshotOnly?: boolean;
}

/**
 * Result of generating a migration or snapshot.
 */
export interface GenerateMigrationResult {
  version?: string;
  filename?: string;
  filePath?: string;
  migration?: MigrationDocument;
  lockfilePath: string;
  changesCount: number;
  isSnapshotOnly: boolean;
  identical: boolean;
}

/**
 * Converts two schema snapshots into an ordered list of discrete MigrationChange objects.
 *
 * @param previousTypes - The baseline data types (e.g. from schema.lock.json or from-env)
 * @param currentTypes  - The current live data types
 */
export function diffToMigrationChanges(
  previousTypes: BubbleDataType[],
  currentTypes: BubbleDataType[]
): MigrationChange[] {
  const prevMap = new Map<string, BubbleDataType>(previousTypes.map((t) => [t.id, t]));
  const currMap = new Map<string, BubbleDataType>(currentTypes.map((t) => [t.id, t]));

  const allTypeIds = new Set([...prevMap.keys(), ...currMap.keys()]);
  const changes: MigrationChange[] = [];

  // Sort IDs for deterministic migration generation
  const sortedTypeIds = Array.from(allTypeIds).sort();

  for (const typeId of sortedTypeIds) {
    const prevType = prevMap.get(typeId);
    const currType = currMap.get(typeId);

    if (!prevType && currType) {
      // 1. ADD_TABLE
      changes.push({
        action: 'ADD_TABLE',
        table: currType.display || currType.id,
        fields: currType.fields.map((f) => ({
          id: f.id,
          display: f.display,
          type: f.type,
          optionList: f.optionList,
        })),
      });
      continue;
    }

    if (prevType && !currType) {
      // 2. REMOVE_TABLE
      changes.push({
        action: 'REMOVE_TABLE',
        table: prevType.display || prevType.id,
      });
      continue;
    }

    if (prevType && currType) {
      // 3. Table exists in both — analyze field level changes
      const tableName = currType.display || currType.id;
      const prevFieldMap = new Map<string, BubbleField>(prevType.fields.map((f) => [f.id, f]));
      const currFieldMap = new Map<string, BubbleField>(currType.fields.map((f) => [f.id, f]));

      const allFieldIds = Array.from(new Set([...prevFieldMap.keys(), ...currFieldMap.keys()])).sort();

      for (const fieldId of allFieldIds) {
        const pf = prevFieldMap.get(fieldId);
        const cf = currFieldMap.get(fieldId);

        if (!pf && cf) {
          changes.push({
            action: 'ADD_FIELD',
            table: tableName,
            field: cf.display || cf.id,
            type: cf.type,
            optionList: cf.optionList,
          });
        } else if (pf && !cf) {
          changes.push({
            action: 'REMOVE_FIELD',
            table: tableName,
            field: pf.display || pf.id,
            previousType: pf.type,
          });
        } else if (pf && cf && pf.type !== cf.type) {
          changes.push({
            action: 'CHANGE_FIELD_TYPE',
            table: tableName,
            field: cf.display || cf.id,
            previousType: pf.type,
            type: cf.type,
          });
        }
      }
    }
  }

  return changes;
}

/**
 * Sanitizes a migration name into snake_case.
 */
export function sanitizeMigrationName(name: string): string {
  const sanitized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return sanitized || 'migration';
}

/**
 * Generates a timestamp version string (e.g. `20260808224500`).
 */
export function generateVersionTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());

  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

/**
 * Loads the schema lockfile from the specified directory or file path.
 * Returns null if the lockfile does not exist.
 */
export async function loadSchemaLockfile(lockfilePath: string): Promise<SchemaLockfile | null> {
  try {
    const raw = await readFile(lockfilePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.types)) {
      return parsed as SchemaLockfile;
    }
    return null;
  } catch (err: unknown) {
    const isNotFound = err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT';
    if (isNotFound) {
      return null;
    }
    throw new Error(`Failed to read schema lockfile at ${lockfilePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Saves the schema lockfile to disk.
 */
export async function saveSchemaLockfile(lockfilePath: string, lockfile: SchemaLockfile): Promise<void> {
  const formatted = JSON.stringify(lockfile, null, 2) + '\n';
  await writeFile(lockfilePath, formatted, 'utf-8');
}

/**
 * Generates a migration file or updates the baseline schema lockfile.
 */
export async function generateMigration(options: GenerateMigrationOptions): Promise<GenerateMigrationResult> {
  const migrationsDir = resolve(options.migrationsDir || './migrations');
  await mkdir(migrationsDir, { recursive: true });

  const lockfilePath = join(migrationsDir, 'schema.lock.json');
  const sanitizedName = sanitizeMigrationName(options.name);
  const now = new Date();
  const version = generateVersionTimestamp(now);
  const filename = `${version}_${sanitizedName}.json`;
  const filePath = join(migrationsDir, filename);

  // ── Handle Snapshot Baseline Mode ──────────────────────────────────────────
  if (options.snapshotOnly) {
    const snapshotLockfile: SchemaLockfile = {
      version: '1.0',
      lastMigration: null,
      updatedAt: now.toISOString(),
      app: options.app,
      environment: options.environment,
      types: options.currentTypes,
    };

    await saveSchemaLockfile(lockfilePath, snapshotLockfile);

    return {
      lockfilePath,
      changesCount: 0,
      isSnapshotOnly: true,
      identical: false,
    };
  }

  // ── Determine Baseline Types ───────────────────────────────────────────────
  let baselineTypes: BubbleDataType[] = [];
  const isDirectEnvComparison = Boolean(options.fromEnvironment);

  if (isDirectEnvComparison && options.previousTypes) {
    baselineTypes = options.previousTypes;
  } else {
    const existingLockfile = await loadSchemaLockfile(lockfilePath);
    if (existingLockfile) {
      baselineTypes = existingLockfile.types;
    }
  }

  // ── Compute Schema Changes ─────────────────────────────────────────────────
  const changes = diffToMigrationChanges(baselineTypes, options.currentTypes);

  if (changes.length === 0) {
    return {
      lockfilePath,
      changesCount: 0,
      isSnapshotOnly: false,
      identical: true,
    };
  }

  // ── Create Migration Document ──────────────────────────────────────────────
  const migration: MigrationDocument = {
    version,
    name: sanitizedName,
    description: options.description?.trim() || undefined,
    createdAt: now.toISOString(),
    app: options.app,
    environment: options.environment,
    fromEnvironment: options.fromEnvironment || null,
    changes,
  };

  await writeFile(filePath, JSON.stringify(migration, null, 2) + '\n', 'utf-8');

  // Update lockfile ONLY when not doing a direct from-env comparison
  if (!isDirectEnvComparison) {
    const updatedLockfile: SchemaLockfile = {
      version: '1.0',
      lastMigration: `${version}_${sanitizedName}`,
      updatedAt: now.toISOString(),
      app: options.app,
      environment: options.environment,
      types: options.currentTypes,
    };
    await saveSchemaLockfile(lockfilePath, updatedLockfile);
  }

  return {
    version,
    filename,
    filePath,
    migration,
    lockfilePath,
    changesCount: changes.length,
    isSnapshotOnly: false,
    identical: false,
  };
}

/**
 * Reads and parses a single migration file.
 */
export async function readMigrationFile(filePath: string): Promise<MigrationDocument> {
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content) as MigrationDocument;
}

/**
 * Lists all migration files in the migrations directory in chronological order.
 */
export async function listMigrations(migrationsDir: string = './migrations'): Promise<MigrationListEntry[]> {
  const dir = resolve(migrationsDir);
  let files: string[] = [];

  try {
    files = await readdir(dir);
  } catch (err: unknown) {
    const isNotFound = err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT';
    if (isNotFound) {
      return [];
    }
    throw new Error(`Failed to list migrations directory at ${dir}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const migrationFiles = files.filter(
    (f) => f.endsWith('.json') && f !== 'schema.lock.json'
  );

  const entries: MigrationListEntry[] = [];

  for (const filename of migrationFiles) {
    const filePath = join(dir, filename);
    try {
      const doc = await readMigrationFile(filePath);
      if (doc && doc.version && Array.isArray(doc.changes)) {
        entries.push({
          version: doc.version,
          name: doc.name || basename(filename, '.json'),
          description: doc.description,
          createdAt: doc.createdAt,
          app: doc.app,
          environment: doc.environment,
          fromEnvironment: doc.fromEnvironment,
          changesCount: doc.changes.length,
          filename,
          filePath,
        });
      }
    } catch {
      // Ignore non-migration JSON or malformed files gracefully
    }
  }

  // Sort chronologically by version / filename
  return entries.sort((a, b) => a.version.localeCompare(b.version));
}
