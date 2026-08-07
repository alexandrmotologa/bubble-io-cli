import { Command } from 'commander';
import chalk from 'chalk';
import ora, { Ora } from 'ora';
import { join } from 'path';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { storage } from '../utils/storage.js';
import { BubbleApiClient, BubbleConstraint } from '../services/bubble-api.js';
import { jsonToCsv } from '../utils/csv.js';
import { encrypt } from '../utils/encryption.js';
import { uploadToCloud } from '../utils/cloud-upload.js';

type ExportFormat = 'json' | 'csv';

interface BackupOptions {
  type: string;
  env: string;
  output: string;
  limit?: string;
  format: string;
  constraint?: string;
  since?: string;
  watch?: boolean;
  interval: string;
  destination?: string;
  encrypt?: boolean;
}

interface BackupRunResult {
  file: string;
  records: number;
  type: string;
  env: string;
  format: ExportFormat;
  timestamp: string;
}

/**
 * Core backup logic — runs once per invocation (or per watch cycle).
 * Returns a result object for --json output and watch mode status logging.
 */
async function runBackupOnce(
  options: BackupOptions,
  client: BubbleApiClient,
  constraints: BubbleConstraint[],
  maxRecords: number | undefined,
  format: ExportFormat,
  passphrase: string | undefined,
  isJsonMode: boolean
): Promise<BackupRunResult> {
  const { type: dataType, env, output, since } = options;
  const activeConstraints = constraints.length > 0;

  // ── Spinner (suppressed in --json mode) ────────────────────────────────────
  let spinner: Ora | null = null;
  if (!isJsonMode) {
    const spinnerText = maxRecords !== undefined
      ? `Fetching up to ${chalk.bold(String(maxRecords))} records from ${chalk.bold(dataType)}…`
      : activeConstraints
        ? `Fetching filtered records from ${chalk.bold(dataType)}…`
        : `Fetching all records from ${chalk.bold(dataType)}…`;
    spinner = ora({ text: spinnerText, color: 'cyan' }).start();
  }

  // ── Fetch data from Bubble API ──────────────────────────────────────────────
  const result = await client.getAllRecords(
    dataType,
    maxRecords,
    activeConstraints ? constraints : undefined
  );

  spinner?.succeed(
    chalk.green(`Fetched ${chalk.bold(String(result.totalFetched))} records from `) +
    chalk.bold(dataType)
  );

  // ── Build output filename ───────────────────────────────────────────────────
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const ext = passphrase ? 'enc' : format === 'csv' ? 'csv' : 'json';
  const filename = `backup-${dataType.toLowerCase()}-${timestamp}.${ext}`;
  const filePath = join(output, filename);

  // ── Ensure output directory exists ─────────────────────────────────────────
  if (!existsSync(output)) {
    mkdirSync(output, { recursive: true });
  }

  // ── Serialize content ───────────────────────────────────────────────────────
  let fileContent: string;
  if (format === 'csv') {
    fileContent = jsonToCsv(result.results as Record<string, unknown>[]);
  } else {
    const backupPayload = {
      meta: {
        app: client.app,
        environment: env,
        dataType,
        format,
        exportedAt: new Date().toISOString(),
        totalRecords: result.totalFetched,
        ...(maxRecords !== undefined && { limitedTo: maxRecords }),
        ...(activeConstraints && { constraints }),
        ...(since !== undefined && { since }),
      },
      data: result.results,
    };
    fileContent = JSON.stringify(backupPayload, null, 2);
  }

  // ── Optionally encrypt content ─────────────────────────────────────────────
  const finalContent = passphrase ? encrypt(fileContent, passphrase) : fileContent;
  writeFileSync(filePath, finalContent, 'utf-8');

  // ── Optionally upload to cloud ─────────────────────────────────────────────
  if (options.destination) {
    const uploadSpinner = isJsonMode ? null : ora(`Uploading to ${options.destination}…`).start();
    try {
      const remoteKey = options.destination.endsWith('/')
        ? `${options.destination}${filename}`
        : `${options.destination}/${filename}`;
      await uploadToCloud(filePath, remoteKey);
      uploadSpinner?.succeed(chalk.green(`Uploaded to ${remoteKey}`));
    } catch (e) {
      uploadSpinner?.fail(chalk.red('Cloud upload failed'));
      throw e;
    }
  }

  return {
    file: filePath,
    records: result.totalFetched,
    type: dataType,
    env,
    format,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Registers the `backup` sub-command.
 *
 * Usage:
 *   bubble-io-cli backup --type Product
 *   bubble-io-cli backup --type User --env version-live
 *   bubble-io-cli backup --type Order --format csv
 *   bubble-io-cli backup --type Product --limit 100
 *   bubble-io-cli backup --type Order --constraint '[{"key":"status","constraint_type":"equals","value":"active"}]'
 *   bubble-io-cli backup --type User --since 2026-08-01
 *   bubble-io-cli backup --type Product --watch --interval 3600
 *   bubble-io-cli backup --type User --destination s3://my-bucket/backups
 *   bubble-io-cli backup --type Order --encrypt          (reads passphrase from BUBBLE_BACKUP_PASSPHRASE)
 *   bubble-io-cli backup --type Product --json           (machine-readable output for CI/CD)
 */
export function registerBackupCommand(program: Command): void {
  program
    .command('backup')
    .description('Download and export records from a Bubble data type to a local file')
    .requiredOption('-t, --type <datatype>', 'The Bubble data type name (e.g. User, Product, Order)')
    .option('-e, --env <environment>', 'Target environment: version-test or version-live', 'version-test')
    .option('-o, --output <dir>', 'Output directory for the backup file', '.')
    .option('-l, --limit <number>', 'Maximum number of records to fetch (omit to fetch all)')
    .option('-f, --format <type>', 'Output format: json or csv', 'json')
    .option('-c, --constraint <json>', 'JSON array of Bubble constraints for server-side filtering')
    .option('--since <date>', 'Only export records modified after this date (ISO 8601)')
    .option('--watch', 'Continuously back up at a set interval (use with --interval)')
    .option('--interval <seconds>', 'Seconds between watch-mode backups', '3600')
    .option('--destination <url>', 'Cloud upload destination: s3://bucket/path or gs://bucket/path')
    .option('--encrypt', 'Encrypt the backup file using AES-256-GCM (reads passphrase from BUBBLE_BACKUP_PASSPHRASE env var)')
    .option('--json', 'Output results as machine-readable JSON (suppresses colors and spinners)')
    .action(async (options: BackupOptions & { json?: boolean }) => {
      const isJsonMode = Boolean(options.json);

      // ── Validate stored config ─────────────────────────────────────────────
      const config = storage.getConfig();
      if (!config) {
        const err = { success: false, error: 'No credentials configured. Run: bubble-io-cli config --app <name> --key <key>' };
        if (isJsonMode) { console.log(JSON.stringify(err)); } else {
          console.error(chalk.red('❌ No credentials configured.\n') + chalk.dim('   Run: bubble-io-cli config --app <name> --key <key>'));
        }
        process.exit(1);
      }

      const { appName, apiKey } = config;

      // ── Validate --format ──────────────────────────────────────────────────
      const validFormats: ExportFormat[] = ['json', 'csv'];
      const format = options.format as ExportFormat;
      if (!validFormats.includes(format)) {
        const msg = `Invalid --format "${options.format}". Valid values: ${validFormats.join(', ')}`;
        if (isJsonMode) { console.log(JSON.stringify({ success: false, error: msg })); } else { console.error(chalk.red(`❌ ${msg}`)); }
        process.exit(1);
      }

      // ── Parse --limit ──────────────────────────────────────────────────────
      let maxRecords: number | undefined;
      if (options.limit !== undefined) {
        const parsed = parseInt(options.limit, 10);
        if (isNaN(parsed) || parsed <= 0) {
          const msg = `Invalid --limit "${options.limit}". Must be a positive integer.`;
          if (isJsonMode) { console.log(JSON.stringify({ success: false, error: msg })); } else { console.error(chalk.red(`❌ ${msg}`)); }
          process.exit(1);
        }
        maxRecords = parsed;
      }

      // ── Parse --constraint ─────────────────────────────────────────────────
      const constraints: BubbleConstraint[] = [];
      if (options.constraint !== undefined) {
        try {
          const parsed = JSON.parse(options.constraint) as unknown;
          if (!Array.isArray(parsed)) throw new Error('Must be a JSON array');
          constraints.push(...(parsed as BubbleConstraint[]));
        } catch (e) {
          const msg = `Invalid --constraint JSON: ${e instanceof Error ? e.message : String(e)}`;
          if (isJsonMode) { console.log(JSON.stringify({ success: false, error: msg })); } else { console.error(chalk.red(`❌ ${msg}`)); }
          process.exit(1);
        }
      }

      // ── Parse --since ──────────────────────────────────────────────────────
      if (options.since !== undefined) {
        const sinceDate = new Date(options.since);
        if (isNaN(sinceDate.getTime())) {
          const msg = `Invalid --since date "${options.since}". Use ISO 8601 format, e.g. 2026-08-01`;
          if (isJsonMode) { console.log(JSON.stringify({ success: false, error: msg })); } else { console.error(chalk.red(`❌ ${msg}`)); }
          process.exit(1);
        }
        constraints.push({ key: 'Modified Date', constraint_type: 'greater than', value: sinceDate.toISOString() });
      }

      // ── Validate --env ─────────────────────────────────────────────────────
      const validEnvs = ['version-test', 'version-live'];
      if (!validEnvs.includes(options.env)) {
        const msg = `Invalid environment "${options.env}". Valid values: ${validEnvs.join(', ')}`;
        if (isJsonMode) { console.log(JSON.stringify({ success: false, error: msg })); } else { console.error(chalk.red(`❌ ${msg}`)); }
        process.exit(1);
      }

      // ── Resolve encryption passphrase ──────────────────────────────────────
      let passphrase: string | undefined;
      if (options.encrypt) {
        passphrase = process.env['BUBBLE_BACKUP_PASSPHRASE'];
        if (!passphrase) {
          const msg = '--encrypt requires the BUBBLE_BACKUP_PASSPHRASE environment variable to be set.';
          if (isJsonMode) { console.log(JSON.stringify({ success: false, error: msg })); } else { console.error(chalk.red(`❌ ${msg}`)); }
          process.exit(1);
        }
      }

      // ── Validate watch --interval ──────────────────────────────────────────
      const intervalSeconds = parseInt(options.interval, 10);
      if (options.watch && (isNaN(intervalSeconds) || intervalSeconds < 10)) {
        const msg = '--interval must be >= 10 seconds.';
        if (isJsonMode) { console.log(JSON.stringify({ success: false, error: msg })); } else { console.error(chalk.red(`❌ ${msg}`)); }
        process.exit(1);
      }

      const client = new BubbleApiClient(appName, apiKey, options.env);

      // ── Banner (single run, non-JSON mode) ────────────────────────────────
      if (!isJsonMode && !options.watch) {
        console.log(
          chalk.cyan(`\n🔗 Connecting to `) +
          chalk.bold(`${appName}.bubbleapps.io`) +
          chalk.cyan(` [${options.env}]\n`)
        );
      }

      // ── Watch mode ─────────────────────────────────────────────────────────
      if (options.watch) {
        if (!isJsonMode) {
          console.log(
            chalk.cyan(`\n👁  Watch mode — `) +
            chalk.bold(`${options.type}`) +
            chalk.dim(` every ${intervalSeconds}s  (Ctrl+C to stop)\n`)
          );
        }

        process.on('SIGINT', () => {
          if (!isJsonMode) console.log(chalk.yellow('\n\nWatch mode stopped.\n'));
          process.exit(0);
        });

        const runCycle = async (): Promise<void> => {
          try {
            const result = await runBackupOnce(options, client, constraints, maxRecords, format, passphrase, isJsonMode);
            if (isJsonMode) {
              console.log(JSON.stringify({ success: true, ...result }));
            } else {
              console.log(chalk.green(`✅  ${result.records} records → ${result.file}`));
              console.log(chalk.dim(`    Next run in ${intervalSeconds}s…\n`));
            }
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            if (isJsonMode) {
              console.log(JSON.stringify({ success: false, error: message, timestamp: new Date().toISOString() }));
            } else {
              console.error(chalk.red(`❌ ${message}`));
            }
          }
          setTimeout(() => void runCycle(), intervalSeconds * 1000);
        };

        await runCycle();
        return; // keep process alive — SIGINT handler will exit
      }

      // ── Single-run mode ────────────────────────────────────────────────────
      try {
        const result = await runBackupOnce(options, client, constraints, maxRecords, format, passphrase, isJsonMode);

        if (isJsonMode) {
          console.log(JSON.stringify({ success: true, ...result }));
          return;
        }

        // Human-readable success output
        console.log(chalk.green(`\n✅ Backup complete!`));
        console.log(`   ${chalk.bold('File:    ')} ${chalk.cyan(result.file)}`);
        console.log(`   ${chalk.bold('Records: ')} ${chalk.cyan(String(result.records))}`);
        console.log(`   ${chalk.bold('Type:    ')} ${chalk.cyan(result.type)}`);
        console.log(`   ${chalk.bold('Env:     ')} ${chalk.cyan(result.env)}`);
        console.log(`   ${chalk.bold('Format:  ')} ${chalk.cyan(result.format)}`);
        if (maxRecords !== undefined) console.log(`   ${chalk.bold('Limit:   ')} ${chalk.yellow(String(maxRecords))} ${chalk.dim('(partial export)')}`);
        if (options.since !== undefined) console.log(`   ${chalk.bold('Since:   ')} ${chalk.yellow(options.since)} ${chalk.dim('(incremental)')}`);
        if (options.encrypt) console.log(`   ${chalk.bold('Encrypt: ')} ${chalk.yellow('AES-256-GCM')} ${chalk.dim('(.enc file)')}`);
        if (options.destination) console.log(`   ${chalk.bold('Cloud:   ')} ${chalk.cyan(options.destination)}`);
        console.log();
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
