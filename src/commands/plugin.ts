import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { readFileSync } from 'fs';
import { BubblePluginClient, PluginDefinitionFile } from '../services/bubble-plugin.js';
import { storage } from '../utils/storage.js';

/**
 * Registers the `plugin` sub-command group.
 *
 * Requires a Bubble Plugin Editor API token (different from the Data API key).
 * Set via environment variable: BUBBLE_PLUGIN_TOKEN
 *
 * Usage:
 *   bubble-io-cli plugin list
 *   bubble-io-cli plugin list --json
 *   bubble-io-cli plugin get <pluginId>
 *   bubble-io-cli plugin deploy --file plugin.json
 *   bubble-io-cli plugin deploy --file plugin.json --id existing-plugin-id
 */
export function registerPluginCommand(program: Command): void {
  const plugin = program
    .command('plugin')
    .description('Manage Bubble plugins via the Plugin Editor API (requires BUBBLE_PLUGIN_TOKEN env var)');

  // ── plugin list ─────────────────────────────────────────────────────────────
  plugin
    .command('list')
    .description('List all plugins for the current Bubble app')
    .option('-p, --profile <name>', 'Profile to use for credentials')
    .option('--json', 'Output as machine-readable JSON')
    .action(async (options: { profile?: string; json?: boolean }) => {
      const isJsonMode = Boolean(options.json);
      const { appName } = resolveCredentials(options.profile, isJsonMode);
      const pluginToken = resolvePluginToken(isJsonMode);
      const client = new BubblePluginClient(appName, pluginToken);

      const spinner = isJsonMode ? null : ora({ text: 'Fetching plugins…', color: 'cyan' }).start();

      try {
        const plugins = await client.listPlugins();
        spinner?.succeed(chalk.green(`Found ${plugins.length} plugin(s)`));

        if (isJsonMode) {
          console.log(JSON.stringify({ success: true, app: appName, plugins }));
          return;
        }

        if (plugins.length === 0) {
          console.log(chalk.yellow('\n⚠  No plugins found for this app.\n'));
          return;
        }

        console.log(chalk.cyan(`\n🔌 Plugins — ${chalk.bold(appName)}\n`));
        plugins.forEach((p) => {
          console.log(`  ${chalk.bold(chalk.green(p.name))} ${chalk.dim(`(${p.id})`)}`);
          if (p.description) console.log(`    ${chalk.dim(p.description)}`);
          if (p.version) console.log(`    ${chalk.dim('v' + p.version)}`);
          if (p.actions?.length) {
            console.log(`    ${chalk.dim(`${p.actions.length} action(s)`)}`);
          }
          console.log();
        });
      } catch (error: unknown) {
        spinner?.fail(chalk.red('Failed to list plugins'));
        handleError(error, isJsonMode);
      }
    });

  // ── plugin get ──────────────────────────────────────────────────────────────
  plugin
    .command('get <pluginId>')
    .description('Get the full definition of a specific plugin by ID')
    .option('-p, --profile <name>', 'Profile to use for credentials')
    .option('--json', 'Output as machine-readable JSON')
    .action(async (pluginId: string, options: { profile?: string; json?: boolean }) => {
      const isJsonMode = Boolean(options.json);
      const { appName } = resolveCredentials(options.profile, isJsonMode);
      const pluginToken = resolvePluginToken(isJsonMode);
      const client = new BubblePluginClient(appName, pluginToken);

      const spinner = isJsonMode ? null : ora({ text: `Fetching plugin ${pluginId}…`, color: 'cyan' }).start();

      try {
        const pluginData = await client.getPlugin(pluginId);
        spinner?.succeed(chalk.green(`Plugin "${pluginData.name}" loaded`));

        if (isJsonMode) {
          console.log(JSON.stringify({ success: true, plugin: pluginData }));
          return;
        }

        console.log(chalk.cyan(`\n🔌 Plugin: ${chalk.bold(pluginData.name)}\n`));
        console.log(`   ${chalk.bold('ID:         ')} ${chalk.dim(pluginData.id)}`);
        if (pluginData.version) console.log(`   ${chalk.bold('Version:    ')} ${chalk.cyan(pluginData.version)}`);
        if (pluginData.description) console.log(`   ${chalk.bold('Description:')} ${pluginData.description}`);
        if (pluginData.actions?.length) {
          console.log(`\n   ${chalk.bold('Actions:')}`);
          pluginData.actions.forEach((a) => {
            console.log(`     ${chalk.cyan('·')} ${a.name} ${chalk.dim(`(${a.id})`)}`);
            if (a.description) console.log(`       ${chalk.dim(a.description)}`);
          });
        }
        console.log();
      } catch (error: unknown) {
        spinner?.fail(chalk.red('Failed to fetch plugin'));
        handleError(error, isJsonMode);
      }
    });

  // ── plugin deploy ───────────────────────────────────────────────────────────
  plugin
    .command('deploy')
    .description('Deploy a plugin definition from a local JSON file to your Bubble app')
    .requiredOption('-f, --file <path>', 'Path to the plugin definition JSON file')
    .option('--id <pluginId>', 'Update an existing plugin by ID (omit to create a new plugin)')
    .option('-p, --profile <name>', 'Profile to use for credentials')
    .option('--dry-run', 'Validate the file and show what would be deployed without making API calls')
    .option('--json', 'Output results as machine-readable JSON')
    .action(async (options: {
      file: string;
      id?: string;
      profile?: string;
      dryRun?: boolean;
      json?: boolean;
    }) => {
      const isJsonMode = Boolean(options.json);
      const { appName } = resolveCredentials(options.profile, isJsonMode);

      // ── Read and validate plugin definition file ─────────────────────────────
      let definition: PluginDefinitionFile;
      try {
        definition = JSON.parse(readFileSync(options.file, 'utf-8')) as PluginDefinitionFile;
      } catch (e) {
        const msg = `Could not read plugin file: ${e instanceof Error ? e.message : String(e)}`;
        if (isJsonMode) { console.log(JSON.stringify({ success: false, error: msg })); } else { console.error(chalk.red(`❌ ${msg}`)); }
        process.exit(1);
      }

      if (!definition.name || !Array.isArray(definition.actions)) {
        const msg = 'Plugin file must contain "name" and "actions" fields.';
        if (isJsonMode) { console.log(JSON.stringify({ success: false, error: msg })); } else { console.error(chalk.red(`❌ ${msg}`)); }
        process.exit(1);
      }

      // ── Dry run ──────────────────────────────────────────────────────────────
      if (options.dryRun) {
        if (isJsonMode) {
          console.log(JSON.stringify({ success: true, dryRun: true, plugin: definition, mode: options.id ? 'update' : 'create' }));
        } else {
          console.log(chalk.yellow('\n🧪 Dry run — plugin will NOT be deployed.\n'));
          console.log(`   ${chalk.bold('Name:    ')} ${chalk.cyan(definition.name)}`);
          console.log(`   ${chalk.bold('Mode:    ')} ${options.id ? chalk.yellow('Update') : chalk.green('Create new')}`);
          if (options.id) console.log(`   ${chalk.bold('ID:      ')} ${chalk.dim(options.id)}`);
          console.log(`   ${chalk.bold('Actions: ')} ${chalk.cyan(String(definition.actions.length))}`);
          definition.actions.forEach((a) => console.log(`     ${chalk.dim('·')} ${a.name}`));
          console.log(chalk.green('\n✅ Dry run complete. Re-run without --dry-run to deploy.\n'));
        }
        return;
      }

      const pluginToken = resolvePluginToken(isJsonMode);
      const client = new BubblePluginClient(appName, pluginToken);
      const action = options.id ? 'Updating' : 'Creating';

      const spinner = isJsonMode ? null : ora({ text: `${action} plugin "${definition.name}"…`, color: 'cyan' }).start();

      try {
        const resultId = await client.deployPlugin(definition, options.id);
        spinner?.succeed(chalk.green(`Plugin "${definition.name}" ${options.id ? 'updated' : 'created'} successfully`));

        if (isJsonMode) {
          console.log(JSON.stringify({ success: true, id: resultId, name: definition.name, mode: options.id ? 'update' : 'create' }));
          return;
        }

        console.log(`\n   ${chalk.bold('Plugin:')} ${chalk.cyan(definition.name)}`);
        console.log(`   ${chalk.bold('ID:    ')} ${chalk.cyan(resultId)}\n`);
      } catch (error: unknown) {
        spinner?.fail(chalk.red('Plugin deploy failed'));
        handleError(error, isJsonMode);
      }
    });
}

/** Resolve app credentials or exit with a clear error. */
function resolveCredentials(profile: string | undefined, isJsonMode: boolean): { appName: string; apiKey: string } {
  const config = storage.getConfig(profile);
  if (!config) {
    const msg = 'No credentials configured. Run: bubble-io-cli config --app <name> --key <key>';
    if (isJsonMode) { console.log(JSON.stringify({ success: false, error: msg })); } else {
      console.error(chalk.red(`❌ ${msg}`));
    }
    process.exit(1);
  }
  return config;
}

/** Resolve BUBBLE_PLUGIN_TOKEN or exit with a clear error. */
function resolvePluginToken(isJsonMode: boolean): string {
  const token = process.env['BUBBLE_PLUGIN_TOKEN'];
  if (!token) {
    const msg =
      'BUBBLE_PLUGIN_TOKEN environment variable is required for plugin commands.\n' +
      '   Get your token: Bubble Editor → Plugins → Plugin Editor → Settings → API token';
    if (isJsonMode) { console.log(JSON.stringify({ success: false, error: msg })); } else {
      console.error(chalk.red(`❌ ${msg.split('\n')[0]}`));
      console.error(chalk.dim(`   ${msg.split('\n')[1]}`));
    }
    process.exit(1);
  }
  return token;
}

/** Print a clean error and exit. */
function handleError(error: unknown, isJsonMode: boolean): void {
  const message = error instanceof Error ? error.message : String(error);
  if (isJsonMode) {
    console.log(JSON.stringify({ success: false, error: message }));
  } else {
    console.error(chalk.red(`\n❌ ${message}\n`));
  }
  process.exit(1);
}
