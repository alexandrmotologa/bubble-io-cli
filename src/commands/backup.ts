import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { join } from 'path';
import { storage } from '../utils/storage.js';
import { BubbleApiClient } from '../services/bubble-api.js';

/**
 * Registers the `backup` sub-command.
 *
 * Usage:
 *   bubble-io-cli backup --type Product
 *   bubble-io-cli backup --type User --env version-live
 *   bubble-io-cli backup --type Order --env version-live --output ./exports
 *   bubble-io-cli backup --type User --limit 100
 */
export function registerBackupCommand(program: Command): void {
  program
    .command('backup')
    .description('Download and export all records from a Bubble data type to a local JSON file')
    .requiredOption('-t, --type <datatype>', 'The Bubble data type name (e.g. User, Product, Order)')
    .option('-e, --env <environment>', 'Target environment: version-test or version-live', 'version-test')
    .option('-o, --output <dir>', 'Output directory for the backup file', '.')
    .option('-l, --limit <number>', 'Maximum number of records to fetch (omit to fetch all)')
    .action(async (options: { type: string; env: string; output: string; limit?: string }) => {
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

      const spinner = ora({
        text: maxRecords !== undefined
          ? `Fetching up to ${chalk.bold(String(maxRecords))} records from ${chalk.bold(dataType)}…`
          : `Fetching all records from ${chalk.bold(dataType)}…`,
        color: 'cyan',
      }).start();

      try {
        const client = new BubbleApiClient(appName, apiKey, env);
        const result = await client.getAllRecords(dataType, maxRecords);

        spinner.succeed(
          chalk.green(`Fetched ${chalk.bold(String(result.totalFetched))} records from `) +
          chalk.bold(dataType)
        );

        // ── Build backup file ──────────────────────────────────────────────────
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `backup-${dataType.toLowerCase()}-${timestamp}.json`;
        const filePath = join(output, filename);

        const backupPayload = {
          meta: {
            app: appName,
            environment: env,
            dataType,
            exportedAt: new Date().toISOString(),
            totalRecords: result.totalFetched,
            ...(maxRecords !== undefined && { limitedTo: maxRecords }),
          },
          data: result.results,
        };

        storage.saveJsonFile(filePath, backupPayload);

        console.log(chalk.green(`\n✅ Backup complete!`));
        console.log(`   ${chalk.bold('File:    ')} ${chalk.cyan(filePath)}`);
        console.log(`   ${chalk.bold('Records: ')} ${chalk.cyan(String(result.totalFetched))}`);
        console.log(`   ${chalk.bold('Type:    ')} ${chalk.cyan(dataType)}`);
        console.log(`   ${chalk.bold('Env:     ')} ${chalk.cyan(env)}`);
        if (maxRecords !== undefined) {
          console.log(`   ${chalk.bold('Limit:   ')} ${chalk.yellow(String(maxRecords))} ${chalk.dim('(partial export)')}`);
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
