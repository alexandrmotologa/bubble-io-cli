import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { storage } from '../utils/storage.js';
import { BubbleApiClient } from '../services/bubble-api.js';

/**
 * Registers the `health` sub-command.
 *
 * Checks API connectivity, validates credentials, and tests reachability
 * across one or both environments.
 *
 * Usage:
 *   bubble-io-cli health
 *   bubble-io-cli health --env version-live
 *   bubble-io-cli health --all
 *   bubble-io-cli health --type User
 *   bubble-io-cli health --json
 */
export function registerHealthCommand(program: Command): void {
  program
    .command('health')
    .description('Check API connectivity and credential validity for your Bubble app')
    .option('-e, --env <environment>', 'Environment to test: version-test or version-live', 'version-test')
    .option('--all', 'Test both version-test and version-live environments')
    .option('-t, --type <datatype>', 'Data type to ping (default: first available)', 'User')
    .option('-p, --profile <name>', 'Profile to use for credentials')
    .option('--json', 'Output results as machine-readable JSON')
    .action(async (options: {
      env: string;
      all?: boolean;
      type: string;
      profile?: string;
      json?: boolean;
    }) => {
      const isJsonMode = Boolean(options.json);

      const config = storage.getConfig(options.profile);
      if (!config) {
        const err = { success: false, error: 'No credentials configured. Run: bubble-io-cli config --app <name> --key <key>' };
        if (isJsonMode) { console.log(JSON.stringify(err)); } else {
          console.error(chalk.red('❌ No credentials configured.\n') + chalk.dim('   Run: bubble-io-cli config --app <name> --key <key>'));
        }
        process.exit(1);
      }

      const { appName, apiKey } = config;
      const envsToTest = options.all ? ['version-test', 'version-live'] : [options.env];

      if (!isJsonMode) {
        console.log(chalk.cyan(`\n🏥 Health check — ${chalk.bold(appName)}\n`));
      }

      const results: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

      for (const env of envsToTest) {
        const spinner = isJsonMode ? null : ora({ text: `Checking ${chalk.bold(env)}…`, color: 'cyan' }).start();
        const start = Date.now();

        try {
          const client = new BubbleApiClient(appName, apiKey, env);
          const ok = await client.ping(options.type);
          const latencyMs = Date.now() - start;

          results[env] = { ok, latencyMs };

          if (isJsonMode) continue;

          if (ok) {
            spinner?.succeed(
              chalk.green(`${env}`) +
              chalk.dim(` — reachable (${latencyMs}ms)`)
            );
          } else {
            spinner?.fail(chalk.red(`${env} — unreachable`));
          }
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          results[env] = { ok: false, latencyMs: Date.now() - start, error };
          spinner?.fail(chalk.red(`${env} — ${error}`));
        }
      }

      if (isJsonMode) {
        const allOk = Object.values(results).every((r) => r.ok);
        console.log(JSON.stringify({ success: allOk, app: appName, results }));
        if (!allOk) process.exit(1);
        return;
      }

      const allOk = Object.values(results).every((r) => r.ok);
      console.log();
      if (allOk) {
        console.log(chalk.green('✅ All environments healthy.\n'));
      } else {
        console.log(chalk.red('❌ One or more environments are unreachable.\n'));
        process.exit(1);
      }
    });
}
