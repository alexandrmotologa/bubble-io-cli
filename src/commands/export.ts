import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { storage } from '../utils/storage.js';
import { BubbleApiClient } from '../services/bubble-api.js';
import {
  getDbProvider,
  type DbProviderOptions,
} from '../services/db-providers/index.js';

/**
 * Registers the `export` command group with its `db` sub-command.
 *
 * Usage:
 *   # SQLite (zero-config, local file)
 *   bubble-io-cli export db --type User --target sqlite --db ./bubble.db
 *
 *   # PostgreSQL
 *   bubble-io-cli export db --type Product --target postgres \
 *     --connection-string "postgresql://user:pass@localhost:5432/mydb"
 *
 *   # BigQuery (uses Application Default Credentials by default)
 *   bubble-io-cli export db --type Order --target bigquery \
 *     --project my-gcp-project --dataset bubble_data
 *
 *   # BigQuery with a service account key file
 *   bubble-io-cli export db --type User --target bigquery \
 *     --project my-gcp-project --dataset bubble_data --key-file ./sa-key.json
 */
export function registerExportCommand(program: Command): void {
  const exportCmd = program
    .command('export')
    .description('Export Bubble data to an external database or storage target');

  // ── export db ─────────────────────────────────────────────────────────────
  exportCmd
    .command('db')
    .description('Export records from a Bubble data type directly into a database')
    .requiredOption('-t, --type <datatype>', 'The Bubble data type to export (e.g. User, Product)')
    .option('-e, --env <environment>', 'Target Bubble environment', 'version-test')
    .option('-p, --profile <name>', 'Named credential profile to use')
    .option('-l, --limit <number>', 'Maximum number of records to export (omit for all)')
    .requiredOption('--target <provider>', 'Database target: sqlite | postgres | bigquery')
    // ── SQLite options ────────────────────────────────────────────────────────
    .option('--db <path>', 'SQLite database file path (for --target sqlite)', './bubble.db')
    // ── PostgreSQL options ────────────────────────────────────────────────────
    .option(
      '--connection-string <url>',
      'PostgreSQL connection string (for --target postgres)',
    )
    // ── BigQuery options ──────────────────────────────────────────────────────
    .option('--project <id>', 'GCP project ID (for --target bigquery)')
    .option('--dataset <id>', 'BigQuery dataset ID (for --target bigquery)', 'bubble_data')
    .option('--key-file <path>', 'Path to service account key JSON (for --target bigquery)')
    .action(async (options: {
      type: string;
      env: string;
      profile?: string;
      limit?: string;
      target: string;
      db: string;
      connectionString?: string;
      project?: string;
      dataset: string;
      keyFile?: string;
    }) => {
      // ── Resolve credentials ──────────────────────────────────────────────
      const config = storage.getConfig(options.profile);
      if (!config) {
        console.error(
          chalk.red('❌ No credentials configured.\n') +
          chalk.dim('   Run: bubble-io-cli config --app <name> --key <key>')
        );
        process.exit(1);
      }

      // ── Validate --target ────────────────────────────────────────────────
      const supportedTargets = ['sqlite', 'postgres', 'bigquery'];
      if (!supportedTargets.includes(options.target)) {
        console.error(
          chalk.red(`❌ Unknown --target "${options.target}".\n`) +
          chalk.dim(`   Supported: ${supportedTargets.join(' | ')}\n`)
        );
        process.exit(1);
      }

      // ── Validate target-specific required options ─────────────────────────
      if (options.target === 'postgres' && !options.connectionString) {
        console.error(
          chalk.red('❌ --connection-string is required for --target postgres.\n') +
          chalk.dim('   Example: --connection-string "postgresql://user:pass@localhost:5432/mydb"\n')
        );
        process.exit(1);
      }
      if (options.target === 'bigquery' && !options.project) {
        console.error(
          chalk.red('❌ --project is required for --target bigquery.\n') +
          chalk.dim('   Example: --project my-gcp-project\n')
        );
        process.exit(1);
      }

      // ── Parse --limit ────────────────────────────────────────────────────
      let maxRecords: number | undefined;
      if (options.limit !== undefined) {
        const parsed = parseInt(options.limit, 10);
        if (isNaN(parsed) || parsed <= 0) {
          console.error(chalk.red(`❌ --limit must be a positive integer, got "${options.limit}"\n`));
          process.exit(1);
        }
        maxRecords = parsed;
      }

      // ── Build provider options ───────────────────────────────────────────
      let providerOpts: DbProviderOptions;
      switch (options.target) {
        case 'sqlite':
          providerOpts = { target: 'sqlite', db: options.db };
          break;
        case 'postgres':
          providerOpts = { target: 'postgres', connectionString: options.connectionString! };
          break;
        case 'bigquery':
          providerOpts = {
            target: 'bigquery',
            project: options.project!,
            dataset: options.dataset,
            keyFile: options.keyFile,
          };
          break;
        default:
          throw new Error(`Unhandled target: ${options.target}`);
      }

      const { appName, apiKey } = config;

      // ── Banner ───────────────────────────────────────────────────────────
      console.log(
        chalk.cyan(`\n🔗 Connecting to `) +
        chalk.bold(`${appName}.bubbleapps.io`) +
        chalk.cyan(` [${options.env}]\n`)
      );

      // ── Step 1: Fetch records from Bubble API ────────────────────────────
      const fetchSpinner = ora({
        text: maxRecords !== undefined
          ? `Fetching up to ${chalk.bold(String(maxRecords))} records from ${chalk.bold(options.type)}…`
          : `Fetching all records from ${chalk.bold(options.type)}…`,
        color: 'cyan',
      }).start();

      let records: Record<string, unknown>[];
      try {
        const client = new BubbleApiClient(appName, apiKey, options.env);
        const result = await client.getAllRecords(options.type, maxRecords);
        records = result.results as Record<string, unknown>[];
        fetchSpinner.succeed(
          chalk.green(`Fetched ${chalk.bold(String(result.totalFetched))} records from `) +
          chalk.bold(options.type)
        );
      } catch (err: unknown) {
        fetchSpinner.fail(chalk.red('Failed to fetch records from Bubble'));
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`\n❌ ${message}\n`));
        process.exit(1);
      }

      if (records.length === 0) {
        console.log(chalk.yellow(`\n⚠  No records found for type "${options.type}". Nothing to export.\n`));
        process.exit(0);
      }

      // ── Step 2: Connect to database ──────────────────────────────────────
      const connectSpinner = ora({
        text: `Connecting to ${chalk.bold(options.target)} database…`,
        color: 'cyan',
      }).start();

      let provider;
      try {
        provider = await getDbProvider(providerOpts);
        await provider.connect();
        connectSpinner.succeed(chalk.green(`Connected to ${chalk.bold(options.target)}`));
      } catch (err: unknown) {
        connectSpinner.fail(chalk.red(`Failed to connect to ${options.target}`));
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`\n❌ ${message}\n`));
        process.exit(1);
      }

      // ── Step 3: Upsert records into the database ─────────────────────────
      const upsertSpinner = ora({
        text: `Upserting ${chalk.bold(String(records.length))} records into ${chalk.bold(options.target)}…`,
        color: 'cyan',
      }).start();

      try {
        await provider.upsertTable(options.type, records);
        upsertSpinner.succeed(
          chalk.green(`Exported ${chalk.bold(String(records.length))} records → `) +
          chalk.bold(options.target)
        );
      } catch (err: unknown) {
        upsertSpinner.fail(chalk.red('Failed to write records to the database'));
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`\n❌ ${message}\n`));
        await provider.disconnect().catch(() => { /* ignore disconnect errors */ });
        process.exit(1);
      } finally {
        await provider.disconnect().catch(() => { /* ignore disconnect errors */ });
      }

      // ── Summary ──────────────────────────────────────────────────────────
      console.log(chalk.green('\n✅ Export complete!'));
      console.log(`   ${chalk.bold('Type:    ')} ${chalk.cyan(options.type)}`);
      console.log(`   ${chalk.bold('Env:     ')} ${chalk.cyan(options.env)}`);
      console.log(`   ${chalk.bold('Records: ')} ${chalk.cyan(String(records.length))}`);
      console.log(`   ${chalk.bold('Target:  ')} ${chalk.cyan(options.target)}`);

      switch (options.target) {
        case 'sqlite':
          console.log(`   ${chalk.bold('DB file: ')} ${chalk.cyan(options.db)}`);
          break;
        case 'postgres':
          // Mask password in the connection string for display
          console.log(
            `   ${chalk.bold('DB:      ')} ${chalk.cyan(
              (options.connectionString ?? '').replace(/:([^@/]+)@/, ':***@')
            )}`
          );
          break;
        case 'bigquery':
          console.log(`   ${chalk.bold('Project: ')} ${chalk.cyan(options.project ?? '')}`);
          console.log(`   ${chalk.bold('Dataset: ')} ${chalk.cyan(options.dataset)}`);
          break;
      }
      console.log();
    });
}
