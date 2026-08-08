import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { readFileSync } from 'fs';
import { storage } from '../utils/storage.js';
import { BubbleApiClient } from '../services/bubble-api.js';
import {
  isRelationalDoc,
  runRelationalSeed,
  printRelationalSummary,
} from '../utils/relational-seeder.js';

/** Legacy single-type seed file format */
interface LegacySeedFile {
  type?: string;
  records: Record<string, unknown>[];
}

/**
 * Registers the `seed` sub-command.
 *
 * Supports two distinct input formats — auto-detected from the JSON file:
 *
 * ── LEGACY FORMAT (single data type) ────────────────────────────────────────
 *   { "type": "Product", "records": [ { "Name": "Widget", "Price": 9.99 } ] }
 *
 *   Usage:
 *     bubble-io-cli seed --file seeds/products.json
 *     bubble-io-cli seed --file seeds/users.json --type User --env version-test
 *
 * ── RELATIONAL FORMAT (multiple types with @ref cross-links) ─────────────────
 *   {
 *     "Category": [{ "_ref": "@cat_tech", "Name": "Technology" }],
 *     "Product":  [{ "_ref": "@prod_mac", "Name": "MacBook", "Category": "@cat_tech" }],
 *     "Price":    [{ "Amount": 1999, "Product": "@prod_mac" }]
 *   }
 *
 *   Usage:
 *     bubble-io-cli seed --file seeds/catalog.json
 *     bubble-io-cli seed --file seeds/catalog.json --dry-run
 *
 * Key features of relational format:
 *   - Unlimited nesting depth (N-levels) via DAG topological sort
 *   - Array references: "Sizes": ["@size_s", "@size_m"]
 *   - Self-referencing hierarchies (Category → SubCategory)
 *   - Automatic circular dependency resolution (Create + deferred PATCH)
 */
export function registerSeedCommand(program: Command): void {
  program
    .command('seed')
    .description(
      'Bulk-create records in Bubble from a local JSON seed file.\n' +
      'Supports both single-type (legacy) and multi-type relational formats.'
    )
    .requiredOption('-f, --file <path>', 'Path to the seed JSON file')
    .option('-t, --type <datatype>', 'Override the data type (legacy format only)')
    .option('-e, --env <environment>', 'Target environment: version-test or version-live', 'version-test')
    .option('-p, --profile <name>', 'Profile to use for credentials')
    .option('--concurrency <number>', 'Number of parallel create requests — legacy mode only (default: 5)', '5')
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

      // ── Validate credentials ───────────────────────────────────────────────
      const config = storage.getConfig(options.profile);
      if (!config) {
        const msg = 'No credentials configured. Run: bubble-io-cli config --app <name> --key <key>';
        if (isJsonMode) { console.log(JSON.stringify({ success: false, error: msg })); } else {
          console.error(chalk.red(`❌ ${msg}`));
        }
        process.exit(1);
      }

      // ── Validate environment ───────────────────────────────────────────────
      if (!['version-test', 'version-live'].includes(options.env)) {
        const msg = `Invalid environment "${options.env}". Use version-test or version-live.`;
        if (isJsonMode) { console.log(JSON.stringify({ success: false, error: msg })); } else { console.error(chalk.red(`❌ ${msg}`)); }
        process.exit(1);
      }

      // ── Read and parse seed file ───────────────────────────────────────────
      let parsed: unknown;
      try {
        const raw = readFileSync(options.file, 'utf-8');
        parsed = JSON.parse(raw);
      } catch (e) {
        const msg = `Could not read seed file: ${e instanceof Error ? e.message : String(e)}`;
        if (isJsonMode) { console.log(JSON.stringify({ success: false, error: msg })); } else { console.error(chalk.red(`❌ ${msg}`)); }
        process.exit(1);
      }

      const { appName, apiKey } = config;
      const client = new BubbleApiClient(appName, apiKey, options.env);

      // ── Route: RELATIONAL format ───────────────────────────────────────────
      if (isRelationalDoc(parsed)) {
        if (!isJsonMode) {
          console.log(
            chalk.cyan(`\n🔗 Connecting to `) +
            chalk.bold(`${appName}.bubbleapps.io`) +
            chalk.cyan(` [${options.env}]\n`)
          );
        }

        let result;
        try {
          result = await runRelationalSeed({
            doc: parsed,
            client,
            dryRun: Boolean(options.dryRun),
            silent: isJsonMode,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (isJsonMode) {
            console.log(JSON.stringify({ success: false, error: msg }));
          } else {
            console.error(chalk.red(`\n❌ ${msg}\n`));
          }
          process.exit(1);
        }

        if (isJsonMode) {
          console.log(JSON.stringify({
            success: result.success,
            format: 'relational',
            env: options.env,
            totalCreated: result.totalCreated,
            totalPatched: result.totalPatched,
            byType: result.byType,
            idMap: result.idMap,
            ...(result.errors.length > 0 && { errors: result.errors }),
          }));
        } else {
          if (!options.dryRun) printRelationalSummary(result);
        }

        if (!result.success) process.exit(1);
        return;
      }

      // ── Route: LEGACY format ───────────────────────────────────────────────
      const seedFile = parsed as LegacySeedFile;

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

      const concurrency = parseInt(options.concurrency, 10);
      if (isNaN(concurrency) || concurrency < 1 || concurrency > 20) {
        const msg = '--concurrency must be between 1 and 20.';
        if (isJsonMode) { console.log(JSON.stringify({ success: false, error: msg })); } else { console.error(chalk.red(`❌ ${msg}`)); }
        process.exit(1);
      }

      const total = seedFile.records.length;

      // ── Dry run (legacy) ───────────────────────────────────────────────────
      if (options.dryRun) {
        if (isJsonMode) {
          console.log(JSON.stringify({ success: true, dryRun: true, format: 'legacy', type: dataType, recordCount: total, env: options.env }));
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

      // ── Seed records (legacy) ──────────────────────────────────────────────
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
          format: 'legacy',
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
