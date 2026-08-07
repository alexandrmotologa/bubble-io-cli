import { Command } from 'commander';
import chalk from 'chalk';
import { storage } from '../utils/storage.js';

/**
 * Registers the `config` sub-command.
 *
 * Usage:
 *   bubble-io-cli config --app my-app --key secret_token
 *   bubble-io-cli config --show
 *   bubble-io-cli config --clear
 */
export function registerConfigCommand(program: Command): void {
  program
    .command('config')
    .description('Set and manage your Bubble.io API credentials stored locally')
    .option('-a, --app <name>', 'Your Bubble app subdomain (e.g. my-cool-app)')
    .option('-k, --key <apiKey>', 'Your private Bubble API key from the dashboard')
    .option('--show', 'Display the currently saved configuration')
    .option('--clear', 'Remove all stored credentials')
    .action((options: { app?: string; key?: string; show?: boolean; clear?: boolean }) => {
      // ── Show current config ──────────────────────────────────────────────────
      if (options.show) {
        const config = storage.getConfig();
        if (!config) {
          console.log(chalk.yellow('⚠  No configuration found. Run: bubble-io-cli config --app <name> --key <key>'));
          return;
        }
        console.log(chalk.cyan('\n📋 Current configuration:'));
        console.log(`   ${chalk.bold('App Name:')} ${chalk.green(config.appName)}`);
        console.log(`   ${chalk.bold('API Key: ')} ${chalk.green(maskKey(config.apiKey))}\n`);
        return;
      }

      // ── Clear config ─────────────────────────────────────────────────────────
      if (options.clear) {
        storage.clearConfig();
        console.log(chalk.green('✅ Configuration cleared successfully.'));
        return;
      }

      // ── Save config ──────────────────────────────────────────────────────────
      if (!options.app || !options.key) {
        console.error(
          chalk.red('❌ Both --app and --key are required.\n') +
          chalk.dim('   Example: bubble-io-cli config --app my-app --key your_secret_key')
        );
        process.exit(1);
      }

      storage.saveConfig({ appName: options.app, apiKey: options.key });

      console.log(chalk.green('\n✅ Configuration saved successfully!'));
      console.log(`   ${chalk.bold('App:')} ${chalk.cyan(options.app)}`);
      console.log(`   ${chalk.bold('Key:')} ${chalk.cyan(maskKey(options.key))}\n`);
    });
}

/**
 * Masks an API key for safe display, showing only the last 4 characters.
 */
function maskKey(key: string): string {
  if (key.length <= 4) return '****';
  return `${'*'.repeat(key.length - 4)}${key.slice(-4)}`;
}
