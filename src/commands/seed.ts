import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { readFileSync } from 'fs';
import { storage } from '../utils/storage.js';
import { BubbleApiClient } from '../services/bubble-api.js';

interface SeedFile {
  type?: string;
  records: Record<string, unknown>[];
}

/**
 * Registers the `seed` sub-command.
 *
 * Reads a JSON seed file and bulk-creates records in Bubble. Useful for
 * populating test environments with fixture data.
 *
 * Usage:
 *   bubble-io-cli seed --file seed-data.json
 *   bubble-io-cli seed --file seeds/products.json --type Product --env version-test
 *   bubble-io-cli seed --file seeds/users.json --concurrency 10 --dry-run
 *   bubble-io-cli seed --file seeds/orders.json --json
 *
 * Seed file format:
 *   { "type": "Product", "records": [ { "name": "Widget", "price": 9.99 }, ... ] }
 */
export function registerSeedCommand(program: Command): void {
  program
    .command('seed')
    .description('Bulk-create records in Bubble from a local JSON seed file')
    .requiredOption('-f, --file <path>', 'Path to the seed JSON file')
    .option('-t, --type <datatype>', 'Override the data type from the seed file')
    .option('-e, --env <environment>', 'Target environment: version-test or version-live', 'version-test')
    .option('-p, --profile <name>', 'Profile to use for credentials')
    .option('--concurrency <number>', 'Number of parallel create requests (default: 5)', '5')
    .option('--dry-run', 'Simulate without making any API calls — shows what would be created')
    .option('--json', 'Output results as machine-readable JSON')
    .action(async (options: {
      file: string;
      type?: string;
      env: string;
      profile?: string;
      concurrency: string;
      dryRun?: boolean;
      json?: boolean;
    }) => {
      const isJsonMode = Boolean(options.json);

      // ── Validate credentials ─────────────────────────────────────────────────
      const config = storage.getConfig(options.profile);
      if (!config) {
        const msg = 'No credentials configured. Run: bubble-io-cli config --app <name> --key <key>';
        if (isJsonMode) { console.log(JSON.stringify({ success: false, error: msg })); } else {
          console.error(chalk.red(`❌ ${msg}`));
        }
        process.exit(1);
      }

      // ── Validate concurrency ─────────────────────────────────────────────────
      const concurrency = parseInt(options.concurrency, 10);
      if (isNaN(concurrency) || concurrency < 1 || concurrency > 20) {
        const msg = '--concurrency must be between 1 and 20.';
        if (isJsonMode) { console.log(JSON.stringify({ success: false, error: msg })); } else { console.error(chalk.red(`❌ ${msg}`)); }
        process.exit(1);
      }

      // ── Validate environment ─────────────────────────────────────────────────
      if (!['version-test', 'version-live'].includes(options.env)) {
        const msg = `Invalid environment "${options.env}". Use version-test or version-live.`;
        if (isJsonMode) { console.log(JSON.stringify({ success: false, error: msg })); } else { console.error(chalk.red(`❌ ${msg}`)); }
        process.exit(1);
      }

      // ── Read and parse seed file ─────────────────────────────────────────────
      let seedFile: SeedFile;
      try {
        const raw = readFileSync(options.file, 'utf-8');
        seedFile = JSON.parse(raw) as SeedFile;
      } catch (e) {
        const msg = `Could not read seed file: ${e instanceof Error ? e.message : String(e)}`;
        if (isJsonMode) { console.log(JSON.stringify({ success: false, error: msg })); } else { console.error(chalk.red(`❌ ${msg}`)); }
        process.exit(1);
      }

      if (!Array.isArray(seedFile.records) || seedFile.records.length === 0) {
        const msg = 'Seed file must contain a "records" array with at least one record.';
        if (isJsonMode) { console.log(JSON.stringify({ success: false, error: msg })); } else { console.error(chalk.red(`❌ ${msg}`)); }
        process.exit(1);
      }

      const dataType = options.type ?? seedFile.type;
      if (!dataType) {
        const msg = 'Data type not found. Set "type" in the seed file or use --type.';
        if (isJsonMode) { console.log(JSON.stringify({ success: false, error: msg })); } else { console.error(chalk.red(`❌ ${msg}`)); }
        process.exit(1);
      }

      const { appName, apiKey } = config;
      const total = seedFile.records.length;

      // ── Dry run ──────────────────────────────────────────────────────────────
      if (options.dryRun) {
        if (isJsonMode) {
          console.log(JSON.stringify({ success: true, dryRun: true, type: dataType, recordCount: total, env: options.env }));
        } else {
          console.log(chalk.yellow('\n🧪 Dry run — no records will be created.\n'));
          console.log(`   ${chalk.bold('File:    ')} ${chalk.cyan(options.file)}`);
          console.log(`   ${chalk.bold('Type:    ')} ${chalk.cyan(dataType)}`);
          console.log(`   ${chalk.bold('Env:     ')} ${chalk.cyan(options.env)}`);
          console.log(`   ${chalk.bold('Records: ')} ${chalk.cyan(String(total))}`);
          console.log(chalk.green('\n✅ Dry run complete. Re-run without --dry-run to seed.\n'));
        }
        return;
      }

      // ── Seed records ─────────────────────────────────────────────────────────
      if (!isJsonMode) {
        console.log(
          chalk.cyan(`\n🌱 Seeding ${chalk.bold(String(total))} records into `) +
          chalk.bold(dataType) +
          chalk.cyan(` [${options.env}]\n`)
        );
      }

      const spinner = isJsonMode ? null : ora({
        text: `Creating records in ${chalk.bold(dataType)}…`,
        color: 'cyan',
      }).start();

      const client = new BubbleApiClient(appName, apiKey, options.env);
      let created = 0;
      let failed = 0;
      const errors: string[] = [];
      const createdIds: string[] = [];

      for (let i = 0; i < seedFile.records.length; i += concurrency) {
        const batch = seedFile.records.slice(i, i + concurrency);

        await Promise.all(
          batch.map(async (record, batchIdx) => {
            // Strip Bubble read-only fields if accidentally included in seed
            const { _id: _id, 'Created Date': _cd, 'Modified Date': _md, ...data } = record as Record<string, unknown> & { _id?: string };
            void _id; void _cd; void _md;

            try {
              const result = await client.createRecord(dataType, data);
              created++;
              createdIds.push(result.id);
            } catch (e) {
              failed++;
              errors.push(`Record ${i + batchIdx + 1}: ${e instanceof Error ? e.message : String(e)}`);
            }
          })
        );

        const done = Math.min(i + concurrency, total);
        if (spinner) spinner.text = `Creating record ${done}/${total} in ${chalk.bold(dataType)}…`;
      }

      if (failed === 0) {
        spinner?.succeed(chalk.green(`Seeded ${created} records into ${dataType}`));
      } else {
        spinner?.warn(chalk.yellow(`Seeding finished with ${failed} error(s)`));
        errors.slice(0, 10).forEach((e) => console.error(chalk.dim(`   ⚠ ${e}`)));
      }

      if (isJsonMode) {
        console.log(JSON.stringify({
          success: failed === 0,
          type: dataType,
          env: options.env,
          created,
          failed,
          ids: createdIds,
          ...(failed > 0 && { errors: errors.slice(0, 20) }),
        }));
      } else {
        console.log(`\n   ${chalk.bold('Type:    ')} ${chalk.cyan(dataType)}`);
        console.log(`   ${chalk.bold('Env:     ')} ${chalk.cyan(options.env)}`);
        console.log(`   ${chalk.bold('Created: ')} ${chalk.green(String(created))}`);
        if (failed > 0) console.log(`   ${chalk.bold('Failed:  ')} ${chalk.red(String(failed))}`);
        console.log();
      }

      if (failed > 0) process.exit(1);
    });
}
