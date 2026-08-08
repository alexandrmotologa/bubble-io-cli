#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { registerConfigCommand } from './commands/config.js';
import { registerBackupCommand } from './commands/backup.js';
import { registerGenerateCommand } from './commands/generate.js';
import { registerRestoreCommand } from './commands/restore.js';
import { registerDiffCommand } from './commands/diff.js';
import { registerCompletionsCommand } from './commands/completions.js';
import { registerHealthCommand } from './commands/health.js';
import { registerSchemaCommand } from './commands/schema.js';
import { registerWorkflowCommand } from './commands/workflow.js';
import { registerSeedCommand } from './commands/seed.js';
import { registerMockCommand } from './commands/mock.js';
import { registerPluginCommand } from './commands/plugin.js';
import { registerQueryCommand } from './commands/query.js';
import { registerAuditCommand } from './commands/audit.js';
import { registerExportCommand } from './commands/export.js';
import { loadPlugins } from './utils/plugin-loader.js';

const program = new Command();

program
  .name('bubble-io-cli')
  .description(
    chalk.cyan('🫧  bubble-io-cli') +
    chalk.dim(' — A developer CLI for managing and interacting with Bubble.io applications')
  )
  .version('4.2.0', '-v, --version', 'Output the current version')
  .helpOption('-h, --help', 'Display help for command');

// Register all sub-commands
registerConfigCommand(program);
registerBackupCommand(program);
registerRestoreCommand(program);
registerDiffCommand(program);
registerGenerateCommand(program);
registerCompletionsCommand(program);
registerHealthCommand(program);
registerSchemaCommand(program);
registerWorkflowCommand(program);
registerSeedCommand(program);
registerMockCommand(program);
registerPluginCommand(program);
registerQueryCommand(program);
registerAuditCommand(program);
registerExportCommand(program);

// Show help if no command provided
if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

// Wrap in an async IIFE — CommonJS module target does not support top-level await
(async () => {
  // Load external plugins before parsing — each plugin registers its commands
  await loadPlugins(program);

  program.parseAsync(process.argv).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`\n❌ Unexpected error: ${message}\n`));
    process.exit(1);
  });
})();
