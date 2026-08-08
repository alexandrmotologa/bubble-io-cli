import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm, mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { BubbleDataType } from '../src/services/bubble-meta.js';
import {
  diffToMigrationChanges,
  sanitizeMigrationName,
  generateVersionTimestamp,
  loadSchemaLockfile,
  saveSchemaLockfile,
  generateMigration,
  listMigrations,
  readMigrationFile,
  SchemaLockfile,
} from '../src/utils/schema-migrations.js';

const TEST_MIGRATIONS_DIR = join(__dirname, '.tmp-migrations-test');

describe('Schema-as-Code & Migration Engine', () => {
  beforeEach(async () => {
    await rm(TEST_MIGRATIONS_DIR, { recursive: true, force: true });
    await mkdir(TEST_MIGRATIONS_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_MIGRATIONS_DIR, { recursive: true, force: true });
  });

  // ── diffToMigrationChanges ──────────────────────────────────────────────────

  describe('diffToMigrationChanges', () => {
    it('should detect ADD_TABLE with all its field definitions', () => {
      const prev: BubbleDataType[] = [];
      const curr: BubbleDataType[] = [
        {
          id: 'custom.product',
          display: 'Product',
          fields: [
            { id: 'name', display: 'Name', type: 'text' },
            { id: 'price', display: 'Price', type: 'number' },
          ],
        },
      ];

      const changes = diffToMigrationChanges(prev, curr);

      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({
        action: 'ADD_TABLE',
        table: 'Product',
        fields: [
          { id: 'name', display: 'Name', type: 'text', optionList: undefined },
          { id: 'price', display: 'Price', type: 'number', optionList: undefined },
        ],
      });
    });

    it('should detect REMOVE_TABLE', () => {
      const prev: BubbleDataType[] = [
        {
          id: 'custom.legacy_log',
          display: 'LegacyLog',
          fields: [{ id: 'message', display: 'Message', type: 'text' }],
        },
      ];
      const curr: BubbleDataType[] = [];

      const changes = diffToMigrationChanges(prev, curr);

      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({
        action: 'REMOVE_TABLE',
        table: 'LegacyLog',
      });
    });

    it('should detect ADD_FIELD, REMOVE_FIELD, and CHANGE_FIELD_TYPE within tables', () => {
      const prev: BubbleDataType[] = [
        {
          id: 'user',
          display: 'User',
          fields: [
            { id: 'email', display: 'Email', type: 'text' },
            { id: 'legacy_role', display: 'LegacyRole', type: 'text' },
            { id: 'status', display: 'Status', type: 'text' },
          ],
        },
      ];

      const curr: BubbleDataType[] = [
        {
          id: 'user',
          display: 'User',
          fields: [
            { id: 'email', display: 'Email', type: 'text' },
            { id: 'phone', display: 'Phone', type: 'text' }, // Added
            { id: 'status', display: 'Status', type: 'option_set' }, // Changed
            // legacy_role removed
          ],
        },
      ];

      const changes = diffToMigrationChanges(prev, curr);

      expect(changes).toHaveLength(3);

      const addField = changes.find((c) => c.action === 'ADD_FIELD');
      expect(addField).toEqual({
        action: 'ADD_FIELD',
        table: 'User',
        field: 'Phone',
        type: 'text',
        optionList: undefined,
      });

      const removeField = changes.find((c) => c.action === 'REMOVE_FIELD');
      expect(removeField).toEqual({
        action: 'REMOVE_FIELD',
        table: 'User',
        field: 'LegacyRole',
        previousType: 'text',
      });

      const changeField = changes.find((c) => c.action === 'CHANGE_FIELD_TYPE');
      expect(changeField).toEqual({
        action: 'CHANGE_FIELD_TYPE',
        table: 'User',
        field: 'Status',
        previousType: 'text',
        type: 'option_set',
      });
    });

    it('should return an empty array for identical schemas', () => {
      const schema: BubbleDataType[] = [
        {
          id: 'user',
          display: 'User',
          fields: [{ id: 'email', display: 'Email', type: 'text' }],
        },
      ];

      const changes = diffToMigrationChanges(schema, schema);
      expect(changes).toHaveLength(0);
    });

    it('should handle complex multi-table additions and deletions deterministically', () => {
      const prev: BubbleDataType[] = [
        { id: 'b_table', display: 'B_Table', fields: [{ id: 'f1', display: 'F1', type: 'text' }] },
        { id: 'a_table', display: 'A_Table', fields: [{ id: 'f1', display: 'F1', type: 'text' }] },
      ];
      const curr: BubbleDataType[] = [
        { id: 'c_table', display: 'C_Table', fields: [{ id: 'f1', display: 'F1', type: 'number' }] },
        { id: 'a_table', display: 'A_Table', fields: [{ id: 'f1', display: 'F1', type: 'text' }, { id: 'f2', display: 'F2', type: 'date' }] },
      ];

      const changes = diffToMigrationChanges(prev, curr);
      expect(changes.map((c) => `${c.action}:${c.table}`)).toEqual([
        'ADD_FIELD:A_Table',
        'REMOVE_TABLE:B_Table',
        'ADD_TABLE:C_Table',
      ]);
    });
  });

  // ── Helper Utilities ────────────────────────────────────────────────────────

  describe('sanitizeMigrationName', () => {
    it('should sanitize names to lower snake_case', () => {
      expect(sanitizeMigrationName('Add User Phone & Address!')).toBe('add_user_phone_address');
      expect(sanitizeMigrationName('---create_orders---')).toBe('create_orders');
      expect(sanitizeMigrationName('  ')).toBe('migration');
      expect(sanitizeMigrationName('Migration-2026_v2')).toBe('migration_2026_v2');
    });
  });

  describe('generateVersionTimestamp', () => {
    it('should generate 14-digit numeric timestamp string', () => {
      const date = new Date(Date.UTC(2026, 7, 8, 22, 45, 12)); // Aug 8, 2026, 22:45:12 UTC
      const ts = generateVersionTimestamp(date);
      expect(ts).toBe('20260808224512');
    });
  });

  // ── Lockfile Operations ─────────────────────────────────────────────────────

  describe('Lockfile management', () => {
    it('should return null when reading non-existent lockfile', async () => {
      const lockfile = await loadSchemaLockfile(join(TEST_MIGRATIONS_DIR, 'schema.lock.json'));
      expect(lockfile).toBeNull();
    });

    it('should save and load schema lockfile correctly', async () => {
      const lockfilePath = join(TEST_MIGRATIONS_DIR, 'schema.lock.json');
      const lockfileData: SchemaLockfile = {
        version: '1.0',
        lastMigration: '20260808220000_init_schema',
        updatedAt: new Date().toISOString(),
        app: 'my-test-app',
        environment: 'version-test',
        types: [
          {
            id: 'user',
            display: 'User',
            fields: [{ id: 'email', display: 'Email', type: 'text' }],
          },
        ],
      };

      await saveSchemaLockfile(lockfilePath, lockfileData);
      const loaded = await loadSchemaLockfile(lockfilePath);

      expect(loaded).toEqual(lockfileData);
    });
  });

  // ── generateMigration ───────────────────────────────────────────────────────

  describe('generateMigration', () => {
    it('should create snapshot baseline lockfile in snapshotOnly mode', async () => {
      const types: BubbleDataType[] = [
        {
          id: 'user',
          display: 'User',
          fields: [{ id: 'email', display: 'Email', type: 'text' }],
        },
      ];

      const result = await generateMigration({
        name: 'baseline',
        app: 'test-app',
        environment: 'version-test',
        migrationsDir: TEST_MIGRATIONS_DIR,
        currentTypes: types,
        snapshotOnly: true,
      });

      expect(result.isSnapshotOnly).toBe(true);
      expect(result.changesCount).toBe(0);

      const lockfile = await loadSchemaLockfile(result.lockfilePath);
      expect(lockfile).not.toBeNull();
      expect(lockfile?.types).toHaveLength(1);
      expect(lockfile?.lastMigration).toBeNull();
    });

    it('should generate first migration file and update lockfile from empty baseline', async () => {
      const types: BubbleDataType[] = [
        {
          id: 'product',
          display: 'Product',
          fields: [{ id: 'title', display: 'Title', type: 'text' }],
        },
      ];

      const result = await generateMigration({
        name: 'create_product_table',
        description: 'Initialize product data type',
        app: 'test-app',
        environment: 'version-test',
        migrationsDir: TEST_MIGRATIONS_DIR,
        currentTypes: types,
      });

      expect(result.identical).toBe(false);
      expect(result.changesCount).toBe(1);
      expect(result.filename).toMatch(/^\d{14}_create_product_table\.json$/);
      expect(result.filePath).toBeDefined();

      // Verify migration file
      const doc = await readMigrationFile(result.filePath!);
      expect(doc.name).toBe('create_product_table');
      expect(doc.description).toBe('Initialize product data type');
      expect(doc.app).toBe('test-app');
      expect(doc.environment).toBe('version-test');
      expect(doc.changes[0].action).toBe('ADD_TABLE');
      expect(doc.changes[0].table).toBe('Product');

      // Verify lockfile was updated
      const lockfile = await loadSchemaLockfile(result.lockfilePath);
      expect(lockfile?.types).toEqual(types);
      expect(lockfile?.lastMigration).toContain('create_product_table');
    });

    it('should detect identical schema and avoid generating empty file', async () => {
      const types: BubbleDataType[] = [
        {
          id: 'product',
          display: 'Product',
          fields: [{ id: 'title', display: 'Title', type: 'text' }],
        },
      ];

      // 1. Snapshot baseline
      await generateMigration({
        name: 'init',
        app: 'test-app',
        environment: 'version-test',
        migrationsDir: TEST_MIGRATIONS_DIR,
        currentTypes: types,
        snapshotOnly: true,
      });

      // 2. Generate against identical schema
      const result = await generateMigration({
        name: 'no_changes',
        app: 'test-app',
        environment: 'version-test',
        migrationsDir: TEST_MIGRATIONS_DIR,
        currentTypes: types,
      });

      expect(result.identical).toBe(true);
      expect(result.changesCount).toBe(0);
      expect(result.migration).toBeUndefined();
    });

    it('should generate migration directly comparing two environments (--from-env) without updating lockfile', async () => {
      const typesLive: BubbleDataType[] = [
        {
          id: 'user',
          display: 'User',
          fields: [{ id: 'email', display: 'Email', type: 'text' }],
        },
      ];

      const typesTest: BubbleDataType[] = [
        {
          id: 'user',
          display: 'User',
          fields: [
            { id: 'email', display: 'Email', type: 'text' },
            { id: 'phone', display: 'Phone', type: 'text' },
          ],
        },
      ];

      const result = await generateMigration({
        name: 'sync_test_to_live',
        app: 'test-app',
        environment: 'version-test',
        fromEnvironment: 'version-live',
        migrationsDir: TEST_MIGRATIONS_DIR,
        previousTypes: typesLive,
        currentTypes: typesTest,
      });

      expect(result.identical).toBe(false);
      expect(result.changesCount).toBe(1);
      expect(result.migration?.fromEnvironment).toBe('version-live');
      expect(result.migration?.changes[0]).toEqual({
        action: 'ADD_FIELD',
        table: 'User',
        field: 'Phone',
        type: 'text',
        optionList: undefined,
      });

      // Lockfile should not have been created for direct env diff
      const lockfile = await loadSchemaLockfile(result.lockfilePath);
      expect(lockfile).toBeNull();
    });
  });

  // ── listMigrations & readMigrationFile ──────────────────────────────────────

  describe('listMigrations and readMigrationFile', () => {
    it('should return empty list when no migrations exist', async () => {
      const list = await listMigrations(TEST_MIGRATIONS_DIR);
      expect(list).toEqual([]);
    });

    it('should list all migration files sorted chronologically and ignore lockfile and invalid files', async () => {
      // Create migration 1
      const m1 = {
        version: '20260808100000',
        name: 'init_schema',
        description: 'First migration',
        createdAt: '2026-08-08T10:00:00.000Z',
        app: 'app-test',
        environment: 'version-test',
        changes: [{ action: 'ADD_TABLE', table: 'User' }],
      };
      await writeFile(join(TEST_MIGRATIONS_DIR, '20260808100000_init_schema.json'), JSON.stringify(m1));

      // Create migration 2
      const m2 = {
        version: '20260808110000',
        name: 'add_user_phone',
        createdAt: '2026-08-08T11:00:00.000Z',
        app: 'app-test',
        environment: 'version-test',
        changes: [{ action: 'ADD_FIELD', table: 'User', field: 'Phone', type: 'text' }],
      };
      await writeFile(join(TEST_MIGRATIONS_DIR, '20260808110000_add_user_phone.json'), JSON.stringify(m2));

      // Create dummy lockfile & non-json file
      await writeFile(join(TEST_MIGRATIONS_DIR, 'schema.lock.json'), JSON.stringify({ version: '1.0', types: [] }));
      await writeFile(join(TEST_MIGRATIONS_DIR, 'README.txt'), 'Not a migration');

      const list = await listMigrations(TEST_MIGRATIONS_DIR);

      expect(list).toHaveLength(2);
      expect(list[0].version).toBe('20260808100000');
      expect(list[0].name).toBe('init_schema');
      expect(list[0].changesCount).toBe(1);

      expect(list[1].version).toBe('20260808110000');
      expect(list[1].name).toBe('add_user_phone');
      expect(list[1].changesCount).toBe(1);
    });

    it('should gracefully handle non-existent directory', async () => {
      const list = await listMigrations(join(TEST_MIGRATIONS_DIR, 'does-not-exist'));
      expect(list).toEqual([]);
    });
  });
});
