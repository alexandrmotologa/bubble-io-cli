import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { storage } from '../utils/storage.js';
import { BubbleMetaClient } from '../services/bubble-meta.js';
import { generateTypeFile } from '../utils/type-generator.js';
import { generateGitHubActionsWorkflow } from '../utils/ci-generators/github-actions.js';

/**
 * Available code generation templates for Bubble plugin integrations.
 */
type TemplateType = 'plugin-action' | 'api-connector' | 'data-trigger';

interface TemplateOption {
  name: string;
  description: string;
  generate: (typeName: string, outputDir: string) => void;
}

const TEMPLATES: Record<TemplateType, TemplateOption> = {
  'plugin-action': {
    name: 'Plugin Action',
    description: 'Scaffold a Bubble plugin server-side action with typed parameters',
    generate: (typeName: string, outputDir: string) => generatePluginAction(typeName, outputDir),
  },
  'api-connector': {
    name: 'API Connector',
    description: 'Scaffold an API connector integration helper for a Bubble data type',
    generate: (typeName: string, outputDir: string) => generateApiConnector(typeName, outputDir),
  },
  'data-trigger': {
    name: 'Data Trigger',
    description: 'Scaffold a webhook receiver to handle Bubble data change triggers',
    generate: (typeName: string, outputDir: string) => generateDataTrigger(typeName, outputDir),
  },
};

/**
 * Registers the `generate` command group with its sub-commands.
 *
 * Usage (templates):
 *   bubble-io-cli generate --template plugin-action --name MyAction
 *   bubble-io-cli generate --template api-connector --name Product
 *   bubble-io-cli generate --list
 *
 * Usage (type generation):
 *   bubble-io-cli generate types --output ./bubble-types.d.ts
 *   bubble-io-cli generate types --type Product --output ./src/types/product.d.ts
 *   bubble-io-cli generate types --type Order   (preview to stdout)
 */
export function registerGenerateCommand(program: Command): void {
  const generate = program
    .command('generate')
    .alias('g')
    .description('Scaffold templates or generate TypeScript types from your Bubble schema')
    .option('-t, --template <type>', 'Template type: plugin-action | api-connector | data-trigger')
    .option('-n, --name <name>', 'Name for the generated entity (e.g. Product, MyAction)')
    .option('-o, --output <dir>', 'Output directory for scaffold templates', './generated')
    .option('--list', 'List all available scaffold templates')
    .action((options: { template?: string; name?: string; output: string; list?: boolean }) => {
      // ── List templates ───────────────────────────────────────────────────────
      if (options.list) {
        console.log(chalk.cyan('\n📦 Available templates:\n'));
        for (const [key, tpl] of Object.entries(TEMPLATES)) {
          console.log(`   ${chalk.bold(chalk.green(key))}`);
          console.log(`   ${chalk.dim(tpl.description)}\n`);
        }
        return;
      }

      // ── Validate inputs ──────────────────────────────────────────────────────
      if (!options.template || !options.name) {
        console.error(
          chalk.red('❌ Both --template and --name are required.\n') +
          chalk.dim('   Example: bubble-io-cli generate --template plugin-action --name MyAction\n') +
          chalk.dim('   Or list templates with: bubble-io-cli generate --list\n') +
          chalk.dim('   Or generate TypeScript types with: bubble-io-cli generate types')
        );
        process.exit(1);
      }

      const templateKey = options.template as TemplateType;
      if (!(templateKey in TEMPLATES)) {
        console.error(
          chalk.red(`❌ Unknown template "${options.template}".\n`) +
          chalk.dim(`   Available: ${Object.keys(TEMPLATES).join(', ')}`)
        );
        process.exit(1);
      }

      const template = TEMPLATES[templateKey];
      const spinner = ora(`Generating ${chalk.bold(template.name)} for "${options.name}"…`).start();

      try {
        if (!existsSync(options.output)) {
          mkdirSync(options.output, { recursive: true });
        }

        template.generate(options.name, options.output);

        spinner.succeed(chalk.green(`Generated ${template.name}: `) + chalk.cyan(options.output));
        console.log(chalk.dim(`\n   Template: ${templateKey}`));
        console.log(chalk.dim(`   Name:     ${options.name}`));
        console.log(chalk.dim(`   Output:   ${options.output}\n`));
      } catch (error: unknown) {
        spinner.fail(chalk.red('Generation failed'));
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`\n❌ ${message}\n`));
        process.exit(1);
      }
    });

  // ── generate types ─────────────────────────────────────────────────────────
  generate
    .command('types')
    .description('Generate TypeScript interface definitions from your Bubble schema')
    .option('-e, --env <environment>', 'Target environment', 'version-test')
    .option('-p, --profile <name>', 'Profile to use for credentials')
    .option('-t, --type <name>', 'Generate only the interface for this data type')
    .option('-o, --output <file>', 'Save the generated types to a file (default: print to stdout)')
    .action(async (options: {
      env: string;
      profile?: string;
      type?: string;
      output?: string;
    }) => {
      const config = storage.getConfig(options.profile);
      if (!config) {
        console.error(
          chalk.red('❌ No credentials configured.\n') +
          chalk.dim('   Run: bubble-io-cli config --app <name> --key <key>')
        );
        process.exit(1);
      }

      const spinner = ora({ text: 'Fetching schema from Bubble Meta API…', color: 'cyan' }).start();

      try {
        const meta = new BubbleMetaClient(config.appName, config.apiKey, options.env);
        let types = await meta.getDataTypes();

        // ── Validate --type filter ────────────────────────────────────────────
        if (options.type) {
          const lower = options.type.toLowerCase();
          const matched = types.filter(
            (t) => t.display.toLowerCase() === lower || t.id.toLowerCase() === lower
          );
          if (matched.length === 0) {
            spinner.fail(chalk.red(`Data type "${options.type}" not found.`));
            console.error(
              chalk.dim(`\n   Available types: ${types.map((t) => t.display).join(', ')}\n`)
            );
            process.exit(1);
          }
        }

        spinner.succeed(
          chalk.green(
            `Fetched ${types.length} data type(s) — generating TypeScript interfaces…`
          )
        );

        const content = generateTypeFile(types, {
          singleType: options.type,
          appName: config.appName,
          env: options.env,
        });

        const typeCount = options.type ? 1 : types.length;

        if (options.output) {
          // ── Write to file ─────────────────────────────────────────────────
          await writeFile(options.output, content, 'utf-8');
          console.log(
            chalk.green(`\n✅ Generated ${chalk.bold(String(typeCount))} interface(s) → `) +
            chalk.cyan(options.output)
          );
          console.log(chalk.dim(`   App:  ${config.appName}`));
          console.log(chalk.dim(`   Env:  ${options.env}`));
          if (options.type) {
            console.log(chalk.dim(`   Type: ${options.type}`));
          }
          console.log();
        } else {
          // ── Print to stdout ───────────────────────────────────────────────
          console.log(
            chalk.cyan(
              `\n🔷 TypeScript interfaces — ${chalk.bold(config.appName)} [${options.env}]\n`
            )
          );
          console.log(content);
          console.log(
            chalk.dim(`   Tip: save to a file with --output <path.d.ts>\n`)
          );
        }
      } catch (error: unknown) {
        spinner.fail(chalk.red('Type generation failed'));
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`\n❌ ${message}\n`));
        if (message.includes('403')) {
          console.error(
            chalk.dim(
              '   → Enable the Meta API in your Bubble app: Settings → API → Enable Data API & check "Expose schema"\n'
            )
          );
        }
        process.exit(1);
      }
    });

  // ── generate ci ────────────────────────────────────────────────────────────
  generate
    .command('ci')
    .description('Generate a CI/CD workflow file for automated nightly Bubble backups')
    .requiredOption('--provider <name>', 'CI/CD provider to target (currently supported: github)')
    .option('-t, --type <datatype>', 'Bubble data type to back up in the workflow', 'User')
    .option('-e, --env <environment>', 'Bubble environment used in the workflow', 'version-live')
    .option('--cron <expression>', 'Cron expression (UTC) for the backup schedule', '0 3 * * *')
    .option('--retention <days>', 'Artifact retention in days (GitHub)', '30')
    .option('-f, --format <type>', 'Backup format: json or csv', 'json')
    .option('--cli-version <version>', 'bubble-io-cli version to pin in the workflow', 'latest')
    .option('-o, --output <dir>', 'Output directory for the generated workflow file', '.github/workflows')
    .action(async (options: {
      provider: string;
      type: string;
      env: string;
      cron: string;
      retention: string;
      format: string;
      cliVersion: string;
      output: string;
    }) => {
      // ── Validate provider ────────────────────────────────────────────────
      const supportedProviders = ['github'];
      if (!supportedProviders.includes(options.provider)) {
        console.error(
          chalk.red(`❌ Unsupported provider "${options.provider}".\n`) +
          chalk.dim(`   Supported: ${supportedProviders.join(', ')}\n`)
        );
        process.exit(1);
      }

      // ── Validate format ──────────────────────────────────────────────────
      const validFormats = ['json', 'csv'];
      if (!validFormats.includes(options.format)) {
        console.error(
          chalk.red(`❌ Invalid --format "${options.format}".\n`) +
          chalk.dim(`   Valid values: ${validFormats.join(', ')}\n`)
        );
        process.exit(1);
      }

      // ── Validate retention ───────────────────────────────────────────────
      const retentionDays = parseInt(options.retention, 10);
      if (isNaN(retentionDays) || retentionDays < 1 || retentionDays > 90) {
        console.error(
          chalk.red('❌ --retention must be a number between 1 and 90.\n')
        );
        process.exit(1);
      }

      const spinner = ora(
        `Generating ${chalk.bold('GitHub Actions')} workflow for ${chalk.cyan(options.type)} backups…`
      ).start();

      try {
        // ── Ensure output directory exists ──────────────────────────────────
        await mkdir(options.output, { recursive: true });

        // ── Generate YAML content ───────────────────────────────────────────
        const yaml = generateGitHubActionsWorkflow({
          dataType: options.type,
          env: options.env,
          cron: options.cron,
          retentionDays,
          format: options.format as 'json' | 'csv',
          cliVersion: options.cliVersion,
        });

        const outputFile = join(options.output, 'bubble-backup.yml');
        await writeFile(outputFile, yaml, 'utf-8');

        spinner.succeed(
          chalk.green('Generated GitHub Actions workflow → ') + chalk.cyan(outputFile)
        );

        console.log();
        console.log(`   ${chalk.bold('Schedule:  ')} ${chalk.cyan(options.cron)} (UTC)`);
        console.log(`   ${chalk.bold('Type:      ')} ${chalk.cyan(options.type)}`);
        console.log(`   ${chalk.bold('Env:       ')} ${chalk.cyan(options.env)}`);
        console.log(`   ${chalk.bold('Format:    ')} ${chalk.cyan(options.format)}`);
        console.log(`   ${chalk.bold('Retention: ')} ${chalk.cyan(`${options.retention} days`)}`);
        console.log(`   ${chalk.bold('CLI ver:   ')} ${chalk.cyan(options.cliVersion)}`);
        console.log();
        console.log(chalk.yellow('  ⚠  Required GitHub Secrets (Settings → Secrets → Actions):'));
        console.log(chalk.dim('     BUBBLE_APP_NAME  — your Bubble app name'));
        console.log(chalk.dim('     BUBBLE_API_KEY   — your Bubble Data API key'));
        console.log();
        console.log(chalk.dim('  Tip: commit and push the workflow file to trigger on schedule.'));
        console.log();
      } catch (error: unknown) {
        spinner.fail(chalk.red('CI workflow generation failed'));
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`\n❌ ${message}\n`));
        process.exit(1);
      }
    });
}

// ── Template generators ──────────────────────────────────────────────────────

function generatePluginAction(name: string, outputDir: string): void {
  const className = toPascalCase(name);
  const content = `import axios from 'axios';

/**
 * Bubble Plugin Server-Side Action: ${className}
 * Auto-generated by bubble-io-cli
 *
 * Configure this file as a server-side action in your Bubble plugin editor.
 * See: https://bubble.io/plugin_editor
 */
export interface ${className}Params {
  // TODO: Define your action input parameters here
  apiKey: string;
  inputValue: string;
}

export interface ${className}Result {
  // TODO: Define your action output fields here
  success: boolean;
  message: string;
}

/**
 * Entry point called by Bubble's plugin runtime.
 */
export async function run${className}(params: ${className}Params): Promise<${className}Result> {
  try {
    // TODO: Implement your action logic here
    console.log('Running ${className} action with params:', params);

    return {
      success: true,
      message: 'Action completed successfully',
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, message };
  }
}
`;
  writeFileSync(join(outputDir, `${className}Action.ts`), content, 'utf-8');
}

function generateApiConnector(name: string, outputDir: string): void {
  const className = toPascalCase(name);
  const content = `import axios, { AxiosInstance } from 'axios';

/**
 * Bubble API Connector: ${className}
 * Auto-generated by bubble-io-cli
 *
 * Use this connector inside Bubble's API Connector plugin or as a
 * standalone integration helper.
 */
export interface ${className}Record {
  _id: string;
  Created_Date: string;
  Modified_Date: string;
  // TODO: Add your data type fields here
}

export class ${className}Connector {
  private readonly client: AxiosInstance;

  constructor(appName: string, apiKey: string, env: string = 'version-test') {
    this.client = axios.create({
      baseURL: \`https://\${appName}.bubbleapps.io/\${env}/api/1.1/obj\`,
      headers: { Authorization: \`Bearer \${apiKey}\` },
    });
  }

  async getAll(): Promise<${className}Record[]> {
    const res = await this.client.get<{ response: { results: ${className}Record[] } }>('/${name.toLowerCase()}');
    return res.data.response.results;
  }

  async getById(id: string): Promise<${className}Record> {
    const res = await this.client.get<{ response: ${className}Record }>(\`/${name.toLowerCase()}/\${id}\`);
    return res.data.response;
  }

  async create(data: Omit<${className}Record, '_id' | 'Created_Date' | 'Modified_Date'>): Promise<{ id: string }> {
    const res = await this.client.post<{ id: string }>('/${name.toLowerCase()}', data);
    return res.data;
  }

  async update(id: string, data: Partial<${className}Record>): Promise<void> {
    await this.client.patch(\`/${name.toLowerCase()}/\${id}\`, data);
  }

  async delete(id: string): Promise<void> {
    await this.client.delete(\`/${name.toLowerCase()}/\${id}\`);
  }
}
`;
  writeFileSync(join(outputDir, `${className}Connector.ts`), content, 'utf-8');
}

function generateDataTrigger(name: string, outputDir: string): void {
  const className = toPascalCase(name);
  const content = `import { createServer, IncomingMessage, ServerResponse } from 'http';

/**
 * Bubble Data Trigger Webhook Receiver: ${className}
 * Auto-generated by bubble-io-cli
 *
 * Point your Bubble API workflow to POST to this endpoint.
 * Configure: https://manual.bubble.io/core-resources/api/the-bubble-api
 */

const PORT = process.env.PORT ?? 3000;

interface ${className}TriggerPayload {
  // TODO: Map the fields Bubble sends in the webhook body
  _id?: string;
  [key: string]: unknown;
}

async function handle${className}Trigger(payload: ${className}TriggerPayload): Promise<void> {
  console.log('[${className}Trigger] Received payload:', JSON.stringify(payload, null, 2));
  // TODO: Add your business logic here (e.g. send email, call external API)
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method !== 'POST') {
    res.writeHead(405).end('Method Not Allowed');
    return;
  }

  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', async () => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString()) as ${className}TriggerPayload;
      await handle${className}Trigger(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } catch (err) {
      console.error('[${className}Trigger] Error:', err);
      res.writeHead(500).end('Internal Server Error');
    }
  });
});

server.listen(PORT, () => {
  console.log(\`[${className}Trigger] Webhook server listening on port \${PORT}\`);
});
`;
  writeFileSync(join(outputDir, `${className}Trigger.ts`), content, 'utf-8');
}

function toPascalCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}
