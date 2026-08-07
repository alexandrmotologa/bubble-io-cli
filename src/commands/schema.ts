import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { storage } from '../utils/storage.js';
import { BubbleMetaClient } from '../services/bubble-meta.js';
import { diffSchemas } from '../utils/schema-diff.js';

/**
 * Registers the `schema` sub-command with its sub-commands `list` and `diff`.
 *
 * Usage:
 *   bubble-io-cli schema list
 *   bubble-io-cli schema list --env version-live
 *   bubble-io-cli schema list --fields
 *   bubble-io-cli schema list --type Product
 *   bubble-io-cli schema list --json
 *   bubble-io-cli schema diff
 *   bubble-io-cli schema diff --env-a version-test --env-b version-live
 *   bubble-io-cli schema diff --json
 */
export function registerSchemaCommand(program: Command): void {
  const schema = program
    .command('schema')
    .description('Inspect your Bubble app schema using the Meta API');

  // ── schema list ─────────────────────────────────────────────────────────────
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

  // ── schema diff ─────────────────────────────────────────────────────────────
  schema
    .command('diff')
    .description('Compare schema between two environments and show structural differences')
    .option('--env-a <environment>', 'Source environment (left side)', 'version-test')
    .option('--env-b <environment>', 'Target environment (right side)', 'version-live')
    .option('-p, --profile <name>', 'Profile to use for credentials')
    .option('--json', 'Output diff as machine-readable JSON')
    .action(async (options: {
      envA: string;
      envB: string;
      profile?: string;
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

      const { appName, apiKey } = config;

      // Validate envs
      const validEnvs = ['version-test', 'version-live'];
      for (const env of [options.envA, options.envB]) {
        if (!validEnvs.includes(env)) {
          const msg = `Invalid environment "${env}". Use version-test or version-live.`;
          if (isJsonMode) { console.log(JSON.stringify({ success: false, error: msg })); } else { console.error(chalk.red(`❌ ${msg}`)); }
          process.exit(1);
        }
      }

      const spinner = isJsonMode ? null : ora({
        text: `Fetching schemas from ${chalk.bold(options.envA)} and ${chalk.bold(options.envB)}…`,
        color: 'cyan',
      }).start();

      try {
        const [clientA, clientB] = [
          new BubbleMetaClient(appName, apiKey, options.envA),
          new BubbleMetaClient(appName, apiKey, options.envB),
        ];

        const [typesA, typesB] = await Promise.all([
          clientA.getDataTypes(),
          clientB.getDataTypes(),
        ]);

        const result = diffSchemas(typesA, typesB, options.envA, options.envB);

        if (result.identical) {
          spinner?.succeed(chalk.green('Schemas are identical across both environments.'));
          if (isJsonMode) console.log(JSON.stringify({ success: true, identical: true, ...result }));
          return;
        }

        spinner?.succeed(chalk.yellow('Schema differences found'));

        if (isJsonMode) {
          console.log(JSON.stringify({ success: true, identical: false, ...result }));
          return;
        }

        console.log(chalk.cyan(`\n📊 Schema Diff — ${chalk.bold(appName)}\n`));
        console.log(chalk.dim(`  ${options.envA}  →  ${options.envB}\n`));

        // Added types
        if (result.addedTypes.length > 0) {
          console.log(chalk.bold('  New data types (in ' + options.envB + ' only):'));
          result.addedTypes.forEach((t) => console.log(`    ${chalk.green('+')} ${t}`));
          console.log();
        }

        // Removed types
        if (result.removedTypes.length > 0) {
          console.log(chalk.bold('  Removed data types (in ' + options.envA + ' only):'));
          result.removedTypes.forEach((t) => console.log(`    ${chalk.red('-')} ${t}`));
          console.log();
        }

        // Modified types (field-level)
        if (result.modifiedTypes.length > 0) {
          console.log(chalk.bold('  Modified data types:'));
          for (const mod of result.modifiedTypes) {
            console.log(`\n    ${chalk.yellow('~')} ${chalk.bold(mod.type)}`);
            for (const fc of mod.fieldChanges ?? []) {
              if (fc.severity === 'added') {
                console.log(`      ${chalk.green('+')} ${fc.field} ${chalk.dim('[' + (fc.after ?? '') + ']')}`);
              } else if (fc.severity === 'removed') {
                console.log(`      ${chalk.red('-')} ${fc.field} ${chalk.dim('[' + (fc.before ?? '') + ']')}`);
              } else {
                console.log(`      ${chalk.yellow('~')} ${fc.field}  ${chalk.dim(fc.before ?? '')} → ${chalk.cyan(fc.after ?? '')}`);
              }
            }
          }
          console.log();
        }

        // Summary
        const total = result.addedTypes.length + result.removedTypes.length + result.modifiedTypes.length;
        console.log(chalk.dim(`  ${total} type(s) differ between ${options.envA} and ${options.envB}\n`));

      } catch (error: unknown) {
        spinner?.fail(chalk.red('Schema diff failed'));
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
