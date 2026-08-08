import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import Table from 'cli-table3';
import { storage } from '../utils/storage.js';
import { BubbleMetaClient } from '../services/bubble-meta.js';
import { diffSchemas } from '../utils/schema-diff.js';
import { generateErd, wrapInMarkdownDocument } from '../utils/schema-erd.js';
import {
  generateMigration,
  listMigrations,
  loadSchemaLockfile,
} from '../utils/schema-migrations.js';

/**
 * Registers the `schema` sub-command with its sub-commands `list`, `diff`, and `erd`.
 *
 * Usage:
 *   bubble-io-cli schema list
 *   bubble-io-cli schema list --env version-live
 *   bubble-io-cli schema list --fields
 *   bubble-io-cli schema list --type Product
 *   bubble-io-cli schema list --json
 *   bubble-io-cli schema diff
 *   bubble-io-cli schema diff --env-a version-test --env-b version-live
 *   bubble-io-cli schema diff --json
 *   bubble-io-cli schema erd
 *   bubble-io-cli schema erd --env version-live
 *   bubble-io-cli schema erd --output ./erd.md
 *   bubble-io-cli schema erd --include-system-types
 *   bubble-io-cli schema erd --raw
 */
export function registerSchemaCommand(program: Command): void {
  const schema = program
    .command('schema')
    .description('Inspect your Bubble app schema using the Meta API');

  // ── schema list ─────────────────────────────────────────────────────────────
  schema
    .command('list')
    .description('List all data types and their field definitions')
    .option('-e, --env <environment>', 'Target environment', 'version-test')
    .option('-p, --profile <name>', 'Profile to use for credentials')
    .option('-t, --type <datatype>', 'Show fields for a specific data type only')
    .option('--fields', 'Show all fields for each data type')
    .option('--json', 'Output as machine-readable JSON')
    .action(async (options: {
      env: string;
      profile?: string;
      type?: string;
      fields?: boolean;
      json?: boolean;
    }) => {
      const isJsonMode = Boolean(options.json);

      const config = storage.getConfig(options.profile);
      if (!config) {
        const msg = 'No credentials configured. Run: bubble-io-cli config --app <name> --key <key>';
        if (isJsonMode) { console.log(JSON.stringify({ success: false, error: msg })); } else {
          console.error(chalk.red(`❌ ${msg}`));
        }
        process.exit(1);
      }

      const spinner = isJsonMode ? null : ora({ text: 'Fetching schema from Bubble Meta API…', color: 'cyan' }).start();

      try {
        const meta = new BubbleMetaClient(config.appName, config.apiKey, options.env);
        let types = await meta.getDataTypes();

        if (options.type) {
          const lower = options.type.toLowerCase();
          types = types.filter((t) => t.display.toLowerCase() === lower || t.id.toLowerCase() === lower);
          if (types.length === 0) {
            spinner?.fail(chalk.red(`Data type "${options.type}" not found.`));
            process.exit(1);
          }
        }

        spinner?.succeed(chalk.green(`Found ${types.length} data type(s)`));

        if (isJsonMode) {
          console.log(JSON.stringify({ success: true, app: config.appName, env: options.env, types }));
          return;
        }

        console.log(chalk.cyan(`\n📐 Schema — ${chalk.bold(config.appName)} [${options.env}]\n`));

        for (const type of types) {
          console.log(`  ${chalk.bold(chalk.green(type.display))} ${chalk.dim(`(${type.id})`)}`);

          if (options.fields || options.type) {
            type.fields.forEach((field) => {
              const typeLabel = chalk.dim(`[${field.type}]`);
              console.log(`    ${chalk.cyan('·')} ${field.display} ${typeLabel}`);
            });
            console.log();
          }
        }

        if (!options.fields && !options.type) {
          console.log(chalk.dim(`\n  Run with --fields to see field definitions for all types.`));
          console.log(chalk.dim(`  Run with --type <name> to inspect a specific data type.\n`));
        }
      } catch (error: unknown) {
        spinner?.fail(chalk.red('Schema fetch failed'));
        const message = error instanceof Error ? error.message : String(error);
        if (isJsonMode) {
          console.log(JSON.stringify({ success: false, error: message }));
        } else {
          console.error(chalk.red(`\n❌ ${message}\n`));
          if (message.includes('403')) {
            console.error(chalk.dim('   → Enable the Meta API in your Bubble app: Settings → API → Enable Data API & check "Expose schema"\n'));
          }
        }
        process.exit(1);
      }
    });

  // ── schema diff ─────────────────────────────────────────────────────────────
  schema
    .command('diff')
    .description('Compare schema between two environments and show structural differences')
    .option('--env-a <environment>', 'Source environment (left side)', 'version-test')
    .option('--env-b <environment>', 'Target environment (right side)', 'version-live')
    .option('-p, --profile <name>', 'Profile to use for credentials')
    .option('--json', 'Output diff as machine-readable JSON')
    .action(async (options: {
      envA: string;
      envB: string;
      profile?: string;
      json?: boolean;
    }) => {
      const isJsonMode = Boolean(options.json);

      const config = storage.getConfig(options.profile);
      if (!config) {
        const msg = 'No credentials configured. Run: bubble-io-cli config --app <name> --key <key>';
        if (isJsonMode) { console.log(JSON.stringify({ success: false, error: msg })); } else {
          console.error(chalk.red(`❌ ${msg}`));
        }
        process.exit(1);
      }

      const { appName, apiKey } = config;

      // Validate envs
      const validEnvs = ['version-test', 'version-live'];
      for (const env of [options.envA, options.envB]) {
        if (!validEnvs.includes(env)) {
          const msg = `Invalid environment "${env}". Use version-test or version-live.`;
          if (isJsonMode) { console.log(JSON.stringify({ success: false, error: msg })); } else { console.error(chalk.red(`❌ ${msg}`)); }
          process.exit(1);
        }
      }

      const spinner = isJsonMode ? null : ora({
        text: `Fetching schemas from ${chalk.bold(options.envA)} and ${chalk.bold(options.envB)}…`,
        color: 'cyan',
      }).start();

      try {
        const [clientA, clientB] = [
          new BubbleMetaClient(appName, apiKey, options.envA),
          new BubbleMetaClient(appName, apiKey, options.envB),
        ];

        const [typesA, typesB] = await Promise.all([
          clientA.getDataTypes(),
          clientB.getDataTypes(),
        ]);

        const result = diffSchemas(typesA, typesB, options.envA, options.envB);

        if (result.identical) {
          spinner?.succeed(chalk.green('Schemas are identical across both environments.'));
          if (isJsonMode) console.log(JSON.stringify({ success: true, ...result }));
          return;
        }

        spinner?.succeed(chalk.yellow('Schema differences found'));

        if (isJsonMode) {
          console.log(JSON.stringify({ success: true, ...result }));
          return;
        }

        console.log(chalk.cyan(`\n📊 Schema Diff — ${chalk.bold(appName)}\n`));
        console.log(chalk.dim(`  ${options.envA}  →  ${options.envB}\n`));

        // Added types
        if (result.addedTypes.length > 0) {
          console.log(chalk.bold('  New data types (in ' + options.envB + ' only):'));
          result.addedTypes.forEach((t) => console.log(`    ${chalk.green('+')} ${t}`));
          console.log();
        }

        // Removed types
        if (result.removedTypes.length > 0) {
          console.log(chalk.bold('  Removed data types (in ' + options.envA + ' only):'));
          result.removedTypes.forEach((t) => console.log(`    ${chalk.red('-')} ${t}`));
          console.log();
        }

        // Modified types (field-level)
        if (result.modifiedTypes.length > 0) {
          console.log(chalk.bold('  Modified data types:'));
          for (const mod of result.modifiedTypes) {
            console.log(`\n    ${chalk.yellow('~')} ${chalk.bold(mod.type)}`);
            for (const fc of mod.fieldChanges ?? []) {
              if (fc.severity === 'added') {
                console.log(`      ${chalk.green('+')} ${fc.field} ${chalk.dim('[' + (fc.after ?? '') + ']')}`);
              } else if (fc.severity === 'removed') {
                console.log(`      ${chalk.red('-')} ${fc.field} ${chalk.dim('[' + (fc.before ?? '') + ']')}`);
              } else {
                console.log(`      ${chalk.yellow('~')} ${fc.field}  ${chalk.dim(fc.before ?? '')} → ${chalk.cyan(fc.after ?? '')}`);
              }
            }
          }
          console.log();
        }

        // Summary
        const total = result.addedTypes.length + result.removedTypes.length + result.modifiedTypes.length;
        console.log(chalk.dim(`  ${total} type(s) differ between ${options.envA} and ${options.envB}\n`));

      } catch (error: unknown) {
        spinner?.fail(chalk.red('Schema diff failed'));
        const message = error instanceof Error ? error.message : String(error);
        if (isJsonMode) {
          console.log(JSON.stringify({ success: false, error: message }));
        } else {
          console.error(chalk.red(`\n❌ ${message}\n`));
        }
        process.exit(1);
      }
    });

  // ── schema erd ──────────────────────────────────────────────────────────────
  schema
    .command('erd')
    .description('Generate a Mermaid.js Entity-Relationship Diagram from your Bubble schema')
    .option('-e, --env <environment>', 'Target environment', 'version-test')
    .option('-p, --profile <name>', 'Profile to use for credentials')
    .option('-o, --output <file>', 'Save the ERD to a markdown file (e.g. ./erd.md)')
    .option('--include-system-types', 'Include Bubble built-in types (User, FileObject, etc.) as entities')
    .option('--raw', 'Print the raw Mermaid code block only, without the markdown document wrapper')
    .action(async (options: {
      env: string;
      profile?: string;
      output?: string;
      includeSystemTypes?: boolean;
      raw?: boolean;
    }) => {
      const config = storage.getConfig(options.profile);
      if (!config) {
        const msg = 'No credentials configured. Run: bubble-io-cli config --app <name> --key <key>';
        console.error(chalk.red(`❌ ${msg}`));
        process.exit(1);
      }

      const spinner = ora({ text: 'Fetching schema from Bubble Meta API…', color: 'cyan' }).start();

      try {
        const meta = new BubbleMetaClient(config.appName, config.apiKey, options.env);
        const types = await meta.getDataTypes();

        spinner.succeed(chalk.green(`Fetched ${types.length} data type(s) — generating ERD…`));

        const erdBlock = generateErd(types, {
          includeSystemTypes: Boolean(options.includeSystemTypes),
        });

        if (options.output) {
          // ── Write to file ────────────────────────────────────────────────
          const content = options.raw
            ? erdBlock
            : wrapInMarkdownDocument(config.appName, options.env, erdBlock);

          await writeFile(options.output, content, 'utf-8');
          console.log(chalk.green(`\n✅ ERD saved to ${chalk.bold(options.output)}\n`));
          console.log(chalk.dim(`   Open it in VS Code or push to GitHub to render the diagram.\n`));
        } else {
          // ── Print to stdout ──────────────────────────────────────────────
          if (!options.raw) {
            console.log(chalk.cyan(`\n📊 Entity-Relationship Diagram — ${chalk.bold(config.appName)} [${options.env}]\n`));
          }
          console.log(erdBlock);
          if (!options.raw) {
            console.log(chalk.dim(`\n  Tip: save to a file with --output <file.md> to render on GitHub.\n`));
          }
        }
      } catch (error: unknown) {
        spinner.fail(chalk.red('ERD generation failed'));
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`\n❌ ${message}\n`));
        if (message.includes('403')) {
          console.error(chalk.dim('   → Enable the Meta API in your Bubble app: Settings → API → Enable Data API & check "Expose schema"\n'));
        }
        process.exit(1);
      }
    });

  // ── schema migrate:generate ──────────────────────────────────────────────────
  schema
    .command('migrate:generate')
    .alias('migrate')
    .description('Generate a Schema-as-Code database migration file or snapshot baseline')
    .option('-n, --name <name>', 'Short name/identifier for the migration', 'schema_update')
    .option('-d, --description <desc>', 'Optional description for the migration')
    .option('-e, --env <environment>', 'Target environment', 'version-test')
    .option('--from-env <environment>', 'Source environment to compare against directly (e.g. version-live)')
    .option('--dir <directory>', 'Directory for migration files and lockfile', './migrations')
    .option('--snapshot-only', 'Capture baseline schema snapshot in lockfile without creating a migration file')
    .option('-p, --profile <name>', 'Profile to use for credentials')
    .option('--json', 'Output result as machine-readable JSON')
    .action(async (options: {
      name: string;
      description?: string;
      env: string;
      fromEnv?: string;
      dir: string;
      snapshotOnly?: boolean;
      profile?: string;
      json?: boolean;
    }) => {
      const isJsonMode = Boolean(options.json);

      const config = storage.getConfig(options.profile);
      if (!config) {
        const msg = 'No credentials configured. Run: bubble-io-cli config --app <name> --key <key>';
        if (isJsonMode) {
          console.log(JSON.stringify({ success: false, error: msg }));
        } else {
          console.error(chalk.red(`❌ ${msg}`));
        }
        process.exit(1);
      }

      const spinner = isJsonMode
        ? null
        : ora({
            text: options.fromEnv
              ? `Comparing schemas between ${chalk.bold(options.fromEnv)} and ${chalk.bold(options.env)}…`
              : `Fetching live schema from ${chalk.bold(options.env)}…`,
            color: 'cyan',
          }).start();

      try {
        const metaTarget = new BubbleMetaClient(config.appName, config.apiKey, options.env);
        const currentTypes = await metaTarget.getDataTypes();

        let previousTypes: typeof currentTypes | undefined;
        if (options.fromEnv) {
          const metaSource = new BubbleMetaClient(config.appName, config.apiKey, options.fromEnv);
          previousTypes = await metaSource.getDataTypes();
        }

        const result = await generateMigration({
          name: options.name,
          description: options.description,
          app: config.appName,
          environment: options.env,
          migrationsDir: options.dir,
          currentTypes,
          previousTypes,
          fromEnvironment: options.fromEnv,
          snapshotOnly: Boolean(options.snapshotOnly),
        });

        if (result.isSnapshotOnly) {
          spinner?.succeed(chalk.green(`Baseline schema snapshot saved (${currentTypes.length} data types)`));
          if (isJsonMode) {
            console.log(JSON.stringify({ success: true, ...result }));
            return;
          }
          console.log(chalk.cyan(`\n📸 Baseline Schema Snapshot Created\n`));
          console.log(`  Lockfile: ${chalk.bold(result.lockfilePath)}`);
          console.log(`  Types:    ${chalk.green(currentTypes.length.toString())} data types indexed\n`);
          console.log(chalk.dim(`  Future schema changes will now be computed against this baseline.\n`));
          return;
        }

        if (result.identical) {
          spinner?.succeed(chalk.green('No schema changes detected'));
          if (isJsonMode) {
            console.log(JSON.stringify({ success: true, ...result }));
            return;
          }
          console.log(chalk.green(`\n✨ Schema is up to date — no changes detected against baseline.\n`));
          return;
        }

        spinner?.succeed(chalk.green(`Generated migration with ${result.changesCount} change(s)`));

        if (isJsonMode) {
          console.log(JSON.stringify({ success: true, ...result }));
          return;
        }

        console.log(chalk.cyan(`\n🚀 Schema Migration Generated — ${chalk.bold(result.filename ?? '')}\n`));
        console.log(`  File:        ${chalk.bold(result.filePath ?? '')}`);
        console.log(`  Environment: ${chalk.cyan(options.env)}${options.fromEnv ? chalk.dim(` (from ${options.fromEnv})`) : ''}`);
        console.log(`  Changes:     ${chalk.yellow(result.changesCount.toString())} operation(s)\n`);

        if (result.migration?.changes) {
          console.log(chalk.bold('  Operations Breakdown:'));
          for (const change of result.migration.changes) {
            switch (change.action) {
              case 'ADD_TABLE':
                console.log(`    ${chalk.green('➕ ADD_TABLE')}        ${chalk.bold(change.table)} ${chalk.dim(`(${change.fields?.length ?? 0} fields)`)}`);
                break;
              case 'REMOVE_TABLE':
                console.log(`    ${chalk.red('➖ REMOVE_TABLE')}     ${chalk.bold(change.table)}`);
                break;
              case 'ADD_FIELD':
                console.log(`    ${chalk.green('➕ ADD_FIELD')}        ${chalk.bold(change.table)}.${chalk.cyan(change.field)} ${chalk.dim(`[${change.type}]`)}`);
                break;
              case 'REMOVE_FIELD':
                console.log(`    ${chalk.red('➖ REMOVE_FIELD')}     ${chalk.bold(change.table)}.${chalk.dim(change.field)} ${chalk.dim(`[${change.previousType}]`)}`);
                break;
              case 'CHANGE_FIELD_TYPE':
                console.log(`    ${chalk.yellow('🔄 CHANGE_TYPE')}      ${chalk.bold(change.table)}.${chalk.cyan(change.field)} ${chalk.dim(change.previousType)} → ${chalk.green(change.type)}`);
                break;
            }
          }
          console.log();
        }

        if (!options.fromEnv) {
          console.log(chalk.dim(`  Updated lockfile: ${result.lockfilePath}\n`));
        }
      } catch (error: unknown) {
        spinner?.fail(chalk.red('Migration generation failed'));
        const message = error instanceof Error ? error.message : String(error);
        if (isJsonMode) {
          console.log(JSON.stringify({ success: false, error: message }));
        } else {
          console.error(chalk.red(`\n❌ ${message}\n`));
        }
        process.exit(1);
      }
    });

  // ── schema migrate:list ──────────────────────────────────────────────────────
  schema
    .command('migrate:list')
    .alias('migrate:status')
    .description('List recorded schema migrations and view lockfile baseline status')
    .option('--dir <directory>', 'Directory containing migrations and lockfile', './migrations')
    .option('--json', 'Output as machine-readable JSON')
    .action(async (options: { dir: string; json?: boolean }) => {
      const isJsonMode = Boolean(options.json);
      const migrationsDir = resolve(options.dir);
      const lockfilePath = join(migrationsDir, 'schema.lock.json');

      try {
        const [lockfile, migrations] = await Promise.all([
          loadSchemaLockfile(lockfilePath),
          listMigrations(migrationsDir),
        ]);

        if (isJsonMode) {
          console.log(JSON.stringify({
            success: true,
            directory: migrationsDir,
            lockfile,
            migrationsCount: migrations.length,
            migrations,
          }));
          return;
        }

        console.log(chalk.cyan(`\n📜 Schema Migrations History — ${chalk.bold(migrationsDir)}\n`));

        if (lockfile) {
          console.log(chalk.bold('  Lockfile Status:'));
          console.log(`    App:            ${chalk.cyan(lockfile.app)}`);
          console.log(`    Environment:    ${chalk.cyan(lockfile.environment)}`);
          console.log(`    Last Migration: ${lockfile.lastMigration ? chalk.green(lockfile.lastMigration) : chalk.dim('Baseline snapshot')}`);
          console.log(`    Types Tracked:  ${chalk.yellow(lockfile.types.length.toString())}`);
          console.log(`    Last Updated:   ${chalk.dim(lockfile.updatedAt)}\n`);
        } else {
          console.log(chalk.dim(`  Lockfile: No schema.lock.json found in ${migrationsDir}\n`));
        }

        if (migrations.length === 0) {
          console.log(chalk.yellow('  No migration files found.'));
          console.log(chalk.dim(`  Run ${chalk.bold('bubble-io-cli schema migrate:generate')} to record your first migration.\n`));
          return;
        }

        const table = new Table({
          head: [
            chalk.cyan('Version'),
            chalk.cyan('Name'),
            chalk.cyan('Env'),
            chalk.cyan('Changes'),
            chalk.cyan('Created At'),
            chalk.cyan('Filename'),
          ],
          style: { head: [], border: [] },
        });

        for (const m of migrations) {
          table.push([
            chalk.bold(m.version),
            m.name,
            chalk.dim(m.environment),
            chalk.yellow(m.changesCount.toString()),
            chalk.dim(new Date(m.createdAt).toLocaleString()),
            chalk.dim(m.filename),
          ]);
        }

        console.log(table.toString());
        console.log(chalk.dim(`\n  Total: ${migrations.length} migration(s) recorded.\n`));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (isJsonMode) {
          console.log(JSON.stringify({ success: false, error: message }));
        } else {
          console.error(chalk.red(`\n❌ ${message}\n`));
        }
        process.exit(1);
      }
    });
}
