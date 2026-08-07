import { Command } from 'commander';
import chalk from 'chalk';
import { storage } from '../utils/storage.js';

/**
 * Registers the `config` sub-command.
 *
 * Usage:
 *   bubble-io-cli config --app my-app --key TOKEN
 *   bubble-io-cli config --app staging-app --key TOKEN --profile staging
 *   bubble-io-cli config --show
 *   bubble-io-cli config --show --profile staging
 *   bubble-io-cli config --list
 *   bubble-io-cli config --use staging
 *   bubble-io-cli config --clear
 *   bubble-io-cli config --clear --profile staging
 *   bubble-io-cli config --clear --all
 */
export function registerConfigCommand(program: Command): void {
  program
    .command('config')
    .description('Set and manage your Bubble.io API credentials stored locally')
    .option('-a, --app <name>', 'Your Bubble app subdomain (e.g. my-cool-app)')
    .option('-k, --key <apiKey>', 'Your private Bubble API key from the dashboard')
    .option('-p, --profile <name>', 'Named profile to save/load credentials (default: "default")')
    .option('--show', 'Display the currently saved configuration (for current or --profile)')
    .option('--list', 'List all stored profiles')
    .option('--use <profile>', 'Switch the active profile')
    .option('--clear', 'Remove stored credentials for the current or --profile')
    .option('--all', 'Combined with --clear: remove ALL profiles and reset')
    .action((options: {
      app?: string;
      key?: string;
      profile?: string;
      show?: boolean;
      list?: boolean;
      use?: string;
      clear?: boolean;
      all?: boolean;
    }) => {
      // ── List all profiles ──────────────────────────────────────────────────
      if (options.list) {
        const profiles = storage.listProfiles();
        const active = storage.getActiveProfile();

        if (profiles.length === 0) {
          console.log(chalk.yellow('⚠  No profiles found. Run: bubble-io-cli config --app <name> --key <key>'));
          return;
        }

        console.log(chalk.cyan('\n👤 Stored profiles:\n'));
        profiles.forEach((p) => {
          const cfg = storage.getConfig(p);
          const isActive = p === active;
          const indicator = isActive ? chalk.green('● ') : chalk.dim('○ ');
          const name = isActive ? chalk.bold(chalk.green(p)) : chalk.bold(p);
          console.log(`   ${indicator}${name}  ${chalk.dim(cfg?.appName ?? '(no app)')}`);
        });
        console.log();
        return;
      }

      // ── Switch active profile ──────────────────────────────────────────────
      if (options.use) {
        const profiles = storage.listProfiles();
        if (!profiles.includes(options.use)) {
          console.error(
            chalk.red(`❌ Profile "${options.use}" not found.\n`) +
            chalk.dim(`   Available: ${profiles.join(', ') || '(none)'}`)
          );
          process.exit(1);
        }
        storage.setActiveProfile(options.use);
        const cfg = storage.getConfig(options.use);
        console.log(chalk.green(`\n✅ Switched to profile "${chalk.bold(options.use)}"`));
        console.log(`   ${chalk.bold('App:')} ${chalk.cyan(cfg?.appName ?? '(none)')}\n`);
        return;
      }

      // ── Show current config ────────────────────────────────────────────────
      if (options.show) {
        const profile = options.profile ?? storage.getActiveProfile();
        const config = storage.getConfig(profile);
        if (!config) {
          console.log(chalk.yellow(`⚠  No configuration found for profile "${profile}".`));
          return;
        }
        console.log(chalk.cyan('\n📋 Current configuration:'));
        console.log(`   ${chalk.bold('Profile: ')} ${chalk.green(profile)}`);
        console.log(`   ${chalk.bold('App Name:')} ${chalk.green(config.appName)}`);
        console.log(`   ${chalk.bold('API Key: ')} ${chalk.green(maskKey(config.apiKey))}\n`);
        return;
      }

      // ── Clear config ───────────────────────────────────────────────────────
      if (options.clear) {
        if (options.all) {
          storage.clearConfig('*');
          console.log(chalk.green('✅ All profiles cleared successfully.'));
        } else {
          const profile = options.profile ?? storage.getActiveProfile();
          storage.clearConfig(profile);
          console.log(chalk.green(`✅ Profile "${profile}" cleared successfully.`));
        }
        return;
      }

      // ── Save config ────────────────────────────────────────────────────────
      if (!options.app || !options.key) {
        console.error(
          chalk.red('❌ Both --app and --key are required.\n') +
          chalk.dim('   Example: bubble-io-cli config --app my-app --key YOUR_BUBBLE_API_KEY')
        );
        process.exit(1);
      }

      const profile = options.profile ?? 'default';
      storage.saveConfig({ appName: options.app, apiKey: options.key }, profile);

      console.log(chalk.green('\n✅ Configuration saved successfully!'));
      console.log(`   ${chalk.bold('Profile:')} ${chalk.cyan(profile)}`);
      console.log(`   ${chalk.bold('App:    ')} ${chalk.cyan(options.app)}`);
      console.log(`   ${chalk.bold('Key:    ')} ${chalk.cyan(maskKey(options.key))}\n`);
    });
}

/**
 * Masks an API key for safe display, showing only the last 4 characters.
 */
function maskKey(key: string): string {
  if (key.length <= 4) return '****';
  return `${'*'.repeat(key.length - 4)}${key.slice(-4)}`;
}
