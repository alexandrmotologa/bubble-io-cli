import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { storage } from '../utils/storage.js';
import { BubbleMetaClient } from '../services/bubble-meta.js';

/**
 * Registers the `schema` sub-command with its sub-commands `list` and `types`.
 *
 * Usage:
 *   bubble-io-cli schema list
 *   bubble-io-cli schema list --env version-live
 *   bubble-io-cli schema list --fields               (show fields for each type)
 *   bubble-io-cli schema list --type Product         (show fields for one type)
 *   bubble-io-cli schema list --json
 */
export function registerSchemaCommand(program: Command): void {
  const schema = program
    .command('schema')
    .description('Inspect your Bubble app schema using the Meta API');

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

        // Filter to a single type if --type is specified
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
}
