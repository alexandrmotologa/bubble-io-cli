#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { registerConfigCommand } from './commands/config.js';
import { registerBackupCommand } from './commands/backup.js';
import { registerGenerateCommand } from './commands/generate.js';
import { registerRestoreCommand } from './commands/restore.js';
import { registerDiffCommand } from './commands/diff.js';

const program = new Command();

program
  .name('bubble-io-cli')
  .description(
    chalk.cyan('🫧  bubble-io-cli') +
    chalk.dim(' — A developer CLI for managing and interacting with Bubble.io applications')
  )
  .version('1.1.0', '-v, --version', 'Output the current version')
  .helpOption('-h, --help', 'Display help for command');

// Register all sub-commands
registerConfigCommand(program);
registerBackupCommand(program);
registerRestoreCommand(program);
registerDiffCommand(program);
registerGenerateCommand(program);

// Show help if no command provided
if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(chalk.red(`\n❌ Unexpected error: ${message}\n`));
  process.exit(1);
});
