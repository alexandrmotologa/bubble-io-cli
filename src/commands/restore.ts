import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { readFileSync } from 'fs';
import { storage } from '../utils/storage.js';
import { BubbleApiClient } from '../services/bubble-api.js';

type RestoreMode = 'create' | 'upsert';

interface BackupMeta {
  app: string;
  environment: string;
  dataType: string;
  exportedAt: string;
  totalRecords: number;
}

interface BackupFile {
  meta: BackupMeta;
  data: Record<string, unknown>[];
}

/**
 * Registers the `restore` sub-command.
 *
 * Reads a backup JSON file produced by `bubble-io-cli backup` and bulk-uploads
 * the records back to the Bubble Data API.
 *
 * Usage:
 *   bubble-io-cli restore --file backup-product-2026-08-07.json
 *   bubble-io-cli restore --file backup-user.json --env version-test --mode upsert
 *   bubble-io-cli restore --file backup-user.json --type Order  (override the data type)
 */
export function registerRestoreCommand(program: Command): void {
  program
    .command('restore')
    .description('Upload records from a local backup JSON file back to the Bubble Data API')
    .requiredOption('-f, --file <path>', 'Path to the backup JSON file to restore from')
    .option('-e, --env <environment>', 'Target environment: version-test or version-live', 'version-test')
    .option('-t, --type <datatype>', 'Override the data type from the backup file')
    .option(
      '-m, --mode <mode>',
      'Restore mode: create (new records only) | upsert (create + update by _id)',
      'create'
    )
    .option('--concurrency <number>', 'Number of parallel API requests (default: 5)', '5')
    .option('--dry-run', 'Simulate the restore without making any API calls')
    .action(async (options: {
      file: string;
      env: string;
      type?: string;
      mode: string;
      concurrency: string;
      dryRun?: boolean;
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

      // ── Validate mode ────────────────────────────────────────────────────────
      const validModes: RestoreMode[] = ['create', 'upsert'];
      const mode = options.mode as RestoreMode;
      if (!validModes.includes(mode)) {
        console.error(
          chalk.red(`❌ Invalid --mode "${options.mode}".`) +
          chalk.dim(`\n   Valid values: ${validModes.join(', ')}`)
        );
        process.exit(1);
      }

      // ── Validate concurrency ─────────────────────────────────────────────────
      const concurrency = parseInt(options.concurrency, 10);
      if (isNaN(concurrency) || concurrency < 1 || concurrency > 20) {
        console.error(chalk.red('❌ --concurrency must be a number between 1 and 20.'));
        process.exit(1);
      }

      // ── Validate environment ─────────────────────────────────────────────────
      const validEnvs = ['version-test', 'version-live'];
      if (!validEnvs.includes(options.env)) {
        console.error(
          chalk.red(`❌ Invalid environment "${options.env}".`) +
          chalk.dim(`\n   Valid values: ${validEnvs.join(', ')}`)
        );
        process.exit(1);
      }

      // ── Read and parse backup file ───────────────────────────────────────────
      let backupFile: BackupFile;
      try {
        const raw = readFileSync(options.file, 'utf-8');
        backupFile = JSON.parse(raw) as BackupFile;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(chalk.red(`❌ Could not read backup file: ${msg}`));
        process.exit(1);
      }

      if (!backupFile.meta || !Array.isArray(backupFile.data)) {
        console.error(
          chalk.red('❌ Invalid backup file format.') +
          chalk.dim('\n   File must be a JSON object with "meta" and "data" keys.')
        );
        process.exit(1);
      }

      const dataType = options.type ?? backupFile.meta.dataType;
      const { appName, apiKey } = config;
      const totalRecords = backupFile.data.length;

      // ── Dry run mode ─────────────────────────────────────────────────────────
      if (options.dryRun) {
        console.log(chalk.yellow('\n🧪 Dry run — no records will be created or updated.\n'));
        console.log(`   ${chalk.bold('File:    ')} ${chalk.cyan(options.file)}`);
        console.log(`   ${chalk.bold('Type:    ')} ${chalk.cyan(dataType)}`);
        console.log(`   ${chalk.bold('Env:     ')} ${chalk.cyan(options.env)}`);
        console.log(`   ${chalk.bold('Mode:    ')} ${chalk.cyan(mode)}`);
        console.log(`   ${chalk.bold('Records: ')} ${chalk.cyan(String(totalRecords))}\n`);
        console.log(chalk.green('✅ Dry run complete. Re-run without --dry-run to apply.'));
        return;
      }

      // ── Start restore flow ───────────────────────────────────────────────────
      console.log(
        chalk.cyan(`\n🔗 Connecting to `) +
        chalk.bold(`${appName}.bubbleapps.io`) +
        chalk.cyan(` [${options.env}]\n`)
      );

      const spinner = ora({
        text: `Restoring ${chalk.bold(String(totalRecords))} records to ${chalk.bold(dataType)} [mode: ${mode}]…`,
        color: 'cyan',
      }).start();

      const client = new BubbleApiClient(appName, apiKey, options.env);
      let created = 0;
      let updated = 0;
      let failed = 0;
      const errors: string[] = [];

      // Process in batches respecting the concurrency limit
      for (let i = 0; i < backupFile.data.length; i += concurrency) {
        const batch = backupFile.data.slice(i, i + concurrency);

        await Promise.all(
          batch.map(async (record) => {
            // Strip read-only Bubble fields before writing
            const { _id, 'Created Date': _cd, 'Modified Date': _md, ...writableData } = record as Record<string, unknown> & { _id?: string };

            try {
              if (mode === 'upsert' && _id) {
                await client.updateRecord(dataType, _id, writableData);
                updated++;
              } else {
                await client.createRecord(dataType, writableData);
                created++;
              }
            } catch (e) {
              failed++;
              const msg = e instanceof Error ? e.message : String(e);
              errors.push(`Record ${_id ?? '(new)'}: ${msg}`);
            }
          })
        );

        // Update spinner progress
        const done = Math.min(i + concurrency, totalRecords);
        spinner.text = `Restoring record ${done}/${totalRecords} to ${chalk.bold(dataType)}…`;
      }

      if (failed === 0) {
        spinner.succeed(chalk.green(`Restore complete — ${created} created, ${updated} updated`));
      } else {
        spinner.warn(chalk.yellow(`Restore finished with ${failed} error(s)`));
        errors.slice(0, 10).forEach((e) => console.error(chalk.dim(`   ⚠ ${e}`)));
        if (errors.length > 10) {
          console.error(chalk.dim(`   … and ${errors.length - 10} more`));
        }
      }

      console.log(`\n   ${chalk.bold('Type:    ')} ${chalk.cyan(dataType)}`);
      console.log(`   ${chalk.bold('Env:     ')} ${chalk.cyan(options.env)}`);
      console.log(`   ${chalk.bold('Mode:    ')} ${chalk.cyan(mode)}`);
      console.log(`   ${chalk.bold('Created: ')} ${chalk.green(String(created))}`);
      if (updated > 0) console.log(`   ${chalk.bold('Updated: ')} ${chalk.blue(String(updated))}`);
      if (failed > 0) console.log(`   ${chalk.bold('Failed:  ')} ${chalk.red(String(failed))}`);
      console.log();

      if (failed > 0) process.exit(1);
    });
}
