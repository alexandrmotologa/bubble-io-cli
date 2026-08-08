import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import path from 'path';
import { storage } from '../utils/storage.js';
import { BubbleApiClient } from '../services/bubble-api.js';

/**
 * Registers the `workflow` sub-command with `trigger` sub-command.
 *
 * Calls Bubble Backend Workflows via the API Connector exposed endpoint.
 * The workflow must be set to "This workflow can be triggered by API" in Bubble.
 *
 * Usage:
 *   bubble-io-cli workflow trigger --name "send-invoice"
 *   bubble-io-cli workflow trigger --name "send-invoice" --data '{"userId":"abc123"}'
 *   bubble-io-cli workflow trigger --name "process-order" --env version-live
 *   bubble-io-cli workflow trigger --name "daily-report" --json
 */
export function registerWorkflowCommand(program: Command): void {
  const workflow = program
    .command('workflow')
    .description('Interact with Bubble backend workflows via the API');

  workflow
    .command('trigger')
    .description('Trigger a Bubble backend workflow by its API name')
    .requiredOption('-n, --name <workflowName>', 'The API name of the workflow to trigger (as set in Bubble)')
    .option('-e, --env <environment>', 'Target environment', 'version-live')
    .option('-p, --profile <name>', 'Profile to use for credentials')
    .option('-d, --data <json>', 'JSON object to pass as workflow parameters')
    .option('--json', 'Output result as machine-readable JSON')
    .action(async (options: {
      name: string;
      env: string;
      profile?: string;
      data?: string;
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

      // ── Parse --data ────────────────────────────────────────────────────────
      let payload: Record<string, unknown> = {};
      if (options.data) {
        try {
          let jsonString = options.data;
          
          // Support reading from a file if the value starts with @
          if (jsonString.startsWith('@')) {
            const filePath = jsonString.slice(1);
            try {
              jsonString = await fs.readFile(path.resolve(process.cwd(), filePath), 'utf-8');
            } catch (fileErr) {
              throw new Error(`Failed to read file ${filePath}: ${fileErr instanceof Error ? fileErr.message : String(fileErr)}`);
            }
          }

          payload = JSON.parse(jsonString) as Record<string, unknown>;
          if (typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Must be a JSON object');
        } catch (e) {
          const msg = `Invalid --data JSON: ${e instanceof Error ? e.message : String(e)}`;
          if (isJsonMode) { console.log(JSON.stringify({ success: false, error: msg })); } else { console.error(chalk.red(`❌ ${msg}`)); }
          process.exit(1);
        }
      }

      const { appName, apiKey } = config;
      const spinner = isJsonMode ? null : ora({
        text: `Triggering workflow ${chalk.bold(options.name)} on ${chalk.bold(appName)} [${options.env}]…`,
        color: 'cyan',
      }).start();

      try {
        // Bubble backend workflows are triggered via POST to /wf/<workflow-name>
        const client = new BubbleApiClient(appName, apiKey, options.env);
        const result = await client.triggerWorkflow(options.name, payload);

        spinner?.succeed(chalk.green(`Workflow "${options.name}" triggered successfully`));

        if (isJsonMode) {
          console.log(JSON.stringify({ success: true, workflow: options.name, env: options.env, result }));
          return;
        }

        console.log(`\n   ${chalk.bold('Workflow:')} ${chalk.cyan(options.name)}`);
        console.log(`   ${chalk.bold('Env:     ')} ${chalk.cyan(options.env)}`);
        if (Object.keys(payload).length > 0) {
          console.log(`   ${chalk.bold('Payload: ')} ${chalk.dim(JSON.stringify(payload))}`);
        }
        if (result && typeof result === 'object') {
          console.log(`   ${chalk.bold('Response:')} ${chalk.dim(JSON.stringify(result))}`);
        }
        console.log();
      } catch (error: unknown) {
        spinner?.fail(chalk.red('Workflow trigger failed'));
        const message = error instanceof Error ? error.message : String(error);
        if (isJsonMode) {
          console.log(JSON.stringify({ success: false, error: message }));
        } else {
          console.error(chalk.red(`\n❌ ${message}\n`));
          if (message.includes('404')) {
            console.error(chalk.dim(`   → Ensure the workflow "${options.name}" is set to "This workflow can be triggered by API" in Bubble.\n`));
          }
        }
        process.exit(1);
      }
    });
}
