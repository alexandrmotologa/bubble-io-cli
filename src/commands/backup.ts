import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { join } from 'path';
import { storage } from '../utils/storage.js';
import { BubbleApiClient, BubbleConstraint } from '../services/bubble-api.js';
import { jsonToCsv } from '../utils/csv.js';

type ExportFormat = 'json' | 'csv';

/**
 * Registers the `backup` sub-command.
 *
 * Usage:
 *   bubble-io-cli backup --type Product
 *   bubble-io-cli backup --type User --env version-live
 *   bubble-io-cli backup --type Order --env version-live --output ./exports
 *   bubble-io-cli backup --type User --limit 100
 *   bubble-io-cli backup --type Product --format csv
 *   bubble-io-cli backup --type Order --constraint '[{"key":"status","constraint_type":"equals","value":"active"}]'
 *   bubble-io-cli backup --type User --since 2026-08-01
 */
export function registerBackupCommand(program: Command): void {
  program
    .command('backup')
    .description('Download and export all records from a Bubble data type to a local file')
    .requiredOption('-t, --type <datatype>', 'The Bubble data type name (e.g. User, Product, Order)')
    .option('-e, --env <environment>', 'Target environment: version-test or version-live', 'version-test')
    .option('-o, --output <dir>', 'Output directory for the backup file', '.')
    .option('-l, --limit <number>', 'Maximum number of records to fetch (omit to fetch all)')
    .option('-f, --format <type>', 'Output format: json or csv', 'json')
    .option('-c, --constraint <json>', 'JSON array of Bubble API constraints for server-side filtering')
    .option('--since <date>', 'Only export records modified after this date (ISO 8601, e.g. 2026-08-01)')
    .action(async (options: {
      type: string;
      env: string;
      output: string;
      limit?: string;
      format: string;
      constraint?: string;
      since?: string;
    }) => {
      // ── Validate stored config ───────────────────────────────────────────────
      const config = storage.getConfig();
      if (!config) {
        console.error(
          chalk.red('❌ No credentials configured.\n') +
          chalk.dim('   Run: bubble-io-cli config --app <name> --key <key>')
        );
        process.exit(1);
      }

      const { appName, apiKey } = config;
      const { type: dataType, env, output } = options;

      // ── Validate --format ────────────────────────────────────────────────────
      const validFormats: ExportFormat[] = ['json', 'csv'];
      const format = options.format as ExportFormat;
      if (!validFormats.includes(format)) {
        console.error(
          chalk.red(`❌ Invalid --format "${options.format}".`) +
          chalk.dim(`\n   Valid values: ${validFormats.join(', ')}`)
        );
        process.exit(1);
      }

      // ── Parse and validate --limit ───────────────────────────────────────────
      let maxRecords: number | undefined;
      if (options.limit !== undefined) {
        const parsed = parseInt(options.limit, 10);
        if (isNaN(parsed) || parsed <= 0) {
          console.error(
            chalk.red(`❌ Invalid --limit value "${options.limit}".`) +
            chalk.dim('\n   Must be a positive integer (e.g. --limit 100)')
          );
          process.exit(1);
        }
        maxRecords = parsed;
      }

      // ── Parse and validate --constraint ─────────────────────────────────────
      const constraints: BubbleConstraint[] = [];

      if (options.constraint !== undefined) {
        try {
          const parsed = JSON.parse(options.constraint) as unknown;
          if (!Array.isArray(parsed)) throw new Error('Must be a JSON array');
          constraints.push(...(parsed as BubbleConstraint[]));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(
            chalk.red(`❌ Invalid --constraint JSON: ${msg}\n`) +
            chalk.dim('   Example: --constraint \'[{"key":"status","constraint_type":"equals","value":"active"}]\'')
          );
          process.exit(1);
        }
      }

      // ── Parse --since (converts to a Modified Date constraint) ───────────────
      if (options.since !== undefined) {
        const sinceDate = new Date(options.since);
        if (isNaN(sinceDate.getTime())) {
          console.error(
            chalk.red(`❌ Invalid --since date "${options.since}".`) +
            chalk.dim('\n   Use ISO 8601 format, e.g. --since 2026-08-01')
          );
          process.exit(1);
        }
        constraints.push({
          key: 'Modified Date',
          constraint_type: 'greater than',
          value: sinceDate.toISOString(),
        });
      }

      // ── Validate environment value ───────────────────────────────────────────
      const validEnvs = ['version-test', 'version-live'];
      if (!validEnvs.includes(env)) {
        console.error(
          chalk.red(`❌ Invalid environment "${env}".`) +
          chalk.dim(`\n   Valid values: ${validEnvs.join(', ')}`)
        );
        process.exit(1);
      }

      // ── Start backup flow ────────────────────────────────────────────────────
      console.log(
        chalk.cyan(`\n🔗 Connecting to `) +
        chalk.bold(`${appName}.bubbleapps.io`) +
        chalk.cyan(` [${env}]\n`)
      );

      const activeConstraints = constraints.length > 0;
      const spinnerText = maxRecords !== undefined
        ? `Fetching up to ${chalk.bold(String(maxRecords))} records from ${chalk.bold(dataType)}…`
        : activeConstraints
          ? `Fetching filtered records from ${chalk.bold(dataType)}…`
          : `Fetching all records from ${chalk.bold(dataType)}…`;

      const spinner = ora({ text: spinnerText, color: 'cyan' }).start();

      try {
        const client = new BubbleApiClient(appName, apiKey, env);
        const result = await client.getAllRecords(
          dataType,
          maxRecords,
          activeConstraints ? constraints : undefined
        );

        spinner.succeed(
          chalk.green(`Fetched ${chalk.bold(String(result.totalFetched))} records from `) +
          chalk.bold(dataType)
        );

        // ── Build output file ──────────────────────────────────────────────────
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const ext = format === 'csv' ? 'csv' : 'json';
        const filename = `backup-${dataType.toLowerCase()}-${timestamp}.${ext}`;
        const filePath = join(output, filename);

        if (format === 'csv') {
          const csvContent = jsonToCsv(result.results as Record<string, unknown>[]);
          storage.saveJsonFile(filePath, csvContent);
          // saveJsonFile stringifies — for CSV we write raw text
          const { writeFileSync, existsSync, mkdirSync } = await import('fs');
          const { join: pathJoin } = await import('path');
          const dir = pathJoin(filePath, '..');
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          writeFileSync(filePath, csvContent, 'utf-8');
        } else {
          const backupPayload = {
            meta: {
              app: appName,
              environment: env,
              dataType,
              format,
              exportedAt: new Date().toISOString(),
              totalRecords: result.totalFetched,
              ...(maxRecords !== undefined && { limitedTo: maxRecords }),
              ...(activeConstraints && { constraints }),
              ...(options.since !== undefined && { since: options.since }),
            },
            data: result.results,
          };
          storage.saveJsonFile(filePath, backupPayload);
        }

        // ── Success output ─────────────────────────────────────────────────────
        console.log(chalk.green(`\n✅ Backup complete!`));
        console.log(`   ${chalk.bold('File:    ')} ${chalk.cyan(filePath)}`);
        console.log(`   ${chalk.bold('Records: ')} ${chalk.cyan(String(result.totalFetched))}`);
        console.log(`   ${chalk.bold('Type:    ')} ${chalk.cyan(dataType)}`);
        console.log(`   ${chalk.bold('Env:     ')} ${chalk.cyan(env)}`);
        console.log(`   ${chalk.bold('Format:  ')} ${chalk.cyan(format)}`);
        if (maxRecords !== undefined) {
          console.log(`   ${chalk.bold('Limit:   ')} ${chalk.yellow(String(maxRecords))} ${chalk.dim('(partial export)')}`);
        }
        if (options.since !== undefined) {
          console.log(`   ${chalk.bold('Since:   ')} ${chalk.yellow(options.since)} ${chalk.dim('(incremental)')}`);
        }
        if (activeConstraints && options.constraint !== undefined) {
          console.log(`   ${chalk.bold('Filter:  ')} ${chalk.yellow('active')} ${chalk.dim(`(${constraints.length - (options.since ? 1 : 0)} constraint(s))`)}`);
        }
        console.log();
      } catch (error: unknown) {
        spinner.fail(chalk.red('Backup failed'));
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`\n❌ ${message}\n`));
        process.exit(1);
      }
    });
}
