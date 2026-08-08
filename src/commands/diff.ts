import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { readFileSync } from 'fs';
import { storage } from '../utils/storage.js';
import { BubbleApiClient } from '../services/bubble-api.js';

interface BackupFile {
  meta: {
    dataType: string;
    environment: string;
    exportedAt: string;
    totalRecords: number;
  };
  data: Record<string, unknown>[];
}

interface DiffResult {
  added: Record<string, unknown>[];    // In remote but not in backup
  removed: Record<string, unknown>[];  // In backup but not in remote
  modified: Array<{
    id: string;
    remote: Record<string, unknown>;
    local: Record<string, unknown>;
    changedFields: string[];
  }>;
}

/**
 * Registers the `diff` sub-command.
 *
 * Fetches the current live data from Bubble and compares it against a local
 * backup file, reporting records that were added, removed, or modified.
 *
 * Usage:
 *   bubble-io-cli diff --type Product --file backup-product-2026-08-07.json
 *   bubble-io-cli diff --type User --file backup-user.json --env version-live
 *   bubble-io-cli diff --type Order --file backup-order.json --fields status,total
 */
export function registerDiffCommand(program: Command): void {
  program
    .command('diff')
    .description('Compare live Bubble data against a local backup file and show what changed')
    .requiredOption('-f, --file <path>', 'Path to the local backup JSON file to compare against')
    .option('-t, --type <datatype>', 'Override the data type from the backup file')
    .option('-e, --env <environment>', 'Target environment: version-test or version-live', 'version-test')
    .option('--fields <list>', 'Comma-separated list of fields to compare (default: all fields)')
    .option('--summary', 'Show only the counts, not the full record details')
    .option('--limit <number>', 'Limit the number of records fetched from Bubble', parseInt)
    .option('--local-only', 'Compare only records present in the local backup file')
    .action(async (options: {
      file: string;
      type?: string;
      env: string;
      fields?: string;
      summary?: boolean;
      limit?: number;
      localOnly?: boolean;
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
        console.error(chalk.red('❌ Invalid backup file format. Expected { meta, data } structure.'));
        process.exit(1);
      }

      const dataType = options.type ?? backupFile.meta.dataType;
      const compareFields = options.fields?.split(',').map((f) => f.trim());
      const { appName, apiKey } = config;

      // ── Validate mutually exclusive options ─────────────────────────────────
      if (options.localOnly && options.limit !== undefined) {
        console.error(chalk.red('❌ --local-only and --limit cannot be used together.'));
        process.exit(1);
      }
      if (options.limit !== undefined && (isNaN(options.limit) || options.limit < 1)) {
        console.error(chalk.red('❌ --limit must be a positive integer.'));
        process.exit(1);
      }

      console.log(
        chalk.cyan(`\n🔍 Comparing ${chalk.bold(dataType)} — `) +
        chalk.dim(`local: ${backupFile.meta.exportedAt}\n`)
      );

      if (options.localOnly) {
        console.log(
          chalk.dim('  ℹ  Mode: --local-only (fetching only the backed-up record IDs)') + '\n' +
          chalk.dim('     Note: newly added records in Bubble will NOT be detected.') + '\n'
        );
      } else if (options.limit !== undefined) {
        console.log(chalk.dim(`  ℹ  Mode: limited fetch (max ${options.limit} records from remote)\n`));
      }

      const spinner = ora({
        text: `Fetching current remote data from ${chalk.bold(dataType)}…`,
        color: 'cyan',
      }).start();

      // ── Fetch remote records ─────────────────────────────────────────────────
      let remoteRecords: Record<string, unknown>[];
      const client = new BubbleApiClient(appName, apiKey, options.env);

      try {
        if (options.localOnly) {
          // Smart fetch: only query the specific IDs present in the backup file.
          // Chunked into groups of 50 to avoid URL length limits.
          const localIds = backupFile.data
            .map((r) => r['_id'] as string | undefined)
            .filter((id): id is string => !!id);

          if (localIds.length === 0) {
            spinner.fail(chalk.red('No valid record IDs found in the backup file.'));
            process.exit(1);
          }

          const CHUNK_SIZE = 50;
          remoteRecords = [];
          for (let i = 0; i < localIds.length; i += CHUNK_SIZE) {
            const chunk = localIds.slice(i, i + CHUNK_SIZE);
            const chunkResult = await client.getAllRecords<Record<string, unknown>>(dataType, undefined, [
              { key: '_id', constraint_type: 'in', value: chunk },
            ]);
            remoteRecords.push(...chunkResult.results);
          }

          spinner.succeed(
            chalk.green(`Fetched ${remoteRecords.length} of ${localIds.length} backed-up records from remote`)
          );
        } else {
          // Full paginated fetch, optionally capped by --limit.
          const result = await client.getAllRecords<Record<string, unknown>>(dataType, options.limit);
          remoteRecords = result.results;
          const limitNote = options.limit !== undefined ? ` (limit: ${options.limit})` : '';
          spinner.succeed(chalk.green(`Fetched ${result.totalFetched} remote records${limitNote}`));
        }
      } catch (error: unknown) {
        spinner.fail(chalk.red('Failed to fetch remote data'));
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`\n❌ ${message}\n`));
        process.exit(1);
      }

      // ── Build ID-keyed maps ──────────────────────────────────────────────────
      const localMap = new Map<string, Record<string, unknown>>();
      for (const record of backupFile.data) {
        const id = record['_id'] as string | undefined;
        if (id) localMap.set(id, record);
      }

      const remoteMap = new Map<string, Record<string, unknown>>();
      for (const record of remoteRecords) {
        const id = record['_id'] as string | undefined;
        if (id) remoteMap.set(id, record);
      }

      // ── Compute diff ─────────────────────────────────────────────────────────
      const diff: DiffResult = { added: [], removed: [], modified: [] };

      // Added: in remote, not in local
      if (!options.localOnly) {
        for (const [id, record] of remoteMap) {
          if (!localMap.has(id)) diff.added.push(record);
        }
      }

      // Removed: in local, not in remote (if fetching all data)
      if (!options.limit && !options.localOnly) {
        for (const [id, record] of localMap) {
          if (!remoteMap.has(id)) diff.removed.push(record);
        }
      }

      // Modified: in both, but fields differ
      for (const [id, remoteRecord] of remoteMap) {
        const localRecord = localMap.get(id);
        if (!localRecord) continue;

        const fieldsToCheck = compareFields ?? Object.keys(remoteRecord);
        const changedFields = fieldsToCheck.filter((field) => {
          // Skip system timestamps for modified check unless explicitly requested
          if (!compareFields && (field === 'Modified Date' || field === 'Created Date')) return false;
          return JSON.stringify(remoteRecord[field]) !== JSON.stringify(localRecord[field]);
        });

        if (changedFields.length > 0) {
          diff.modified.push({ id, remote: remoteRecord, local: localRecord, changedFields });
        }
      }

      // ── Print results ────────────────────────────────────────────────────────
      const total = diff.added.length + diff.removed.length + diff.modified.length;

      if (total === 0) {
        console.log(chalk.green('\n✅ No differences found. Local backup matches remote data.\n'));
        return;
      }

      console.log(chalk.bold(`\n📊 Diff Summary for ${dataType}:`));
      if (!options.localOnly) {
        console.log(`   ${chalk.green(`+ ${diff.added.length} added`)}`);
      }
      console.log(`   ${chalk.red(`- ${diff.removed.length} removed`)}`);
      console.log(`   ${chalk.yellow(`~ ${diff.modified.length} modified`)}`);
      console.log();

      if (options.summary) return;

      // ── Added records ────────────────────────────────────────────────────────
      if (diff.added.length > 0) {
        console.log(chalk.green(chalk.bold('─── Added Records ──────────────────────────────────')));
        diff.added.slice(0, 10).forEach((r) => {
          console.log(chalk.green(`  + ${r['_id'] ?? '(no id)'}`), chalk.dim(`  Created: ${r['Created Date'] ?? '?'}`));
        });
        if (diff.added.length > 10) console.log(chalk.dim(`  … and ${diff.added.length - 10} more`));
        console.log();
      }

      // ── Removed records ──────────────────────────────────────────────────────
      if (diff.removed.length > 0) {
        console.log(chalk.red(chalk.bold('─── Removed Records ────────────────────────────────')));
        diff.removed.slice(0, 10).forEach((r) => {
          console.log(chalk.red(`  - ${r['_id'] ?? '(no id)'}`));
        });
        if (diff.removed.length > 10) console.log(chalk.dim(`  … and ${diff.removed.length - 10} more`));
        console.log();
      }

      // ── Modified records ─────────────────────────────────────────────────────
      if (diff.modified.length > 0) {
        console.log(chalk.yellow(chalk.bold('─── Modified Records ───────────────────────────────')));
        diff.modified.slice(0, 10).forEach(({ id, changedFields, remote, local }) => {
          console.log(chalk.yellow(`  ~ ${id}`));
          changedFields.slice(0, 5).forEach((field) => {
            const oldVal = JSON.stringify(local[field] ?? null);
            const newVal = JSON.stringify(remote[field] ?? null);
            console.log(
              chalk.dim(`      ${field}: `) +
              chalk.red(truncate(oldVal, 40)) +
              chalk.dim(' → ') +
              chalk.green(truncate(newVal, 40))
            );
          });
          if (changedFields.length > 5) {
            console.log(chalk.dim(`      … and ${changedFields.length - 5} more field(s)`));
          }
        });
        if (diff.modified.length > 10) console.log(chalk.dim(`  … and ${diff.modified.length - 10} more records`));
        console.log();
      }

      console.log(chalk.bold(`Total changes: ${total}`) + chalk.dim(' (run with --summary for counts only)\n'));
    });
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
}
