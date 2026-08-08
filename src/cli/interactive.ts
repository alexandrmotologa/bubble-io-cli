import {
  intro,
  outro,
  select,
  text,
  password,
  confirm,
  note,
  cancel,
  isCancel,
  log,
} from '@clack/prompts';
import chalk from 'chalk';
import { Command } from 'commander';
import { storage } from '../utils/storage.js';

// ---------------------------------------------------------------------------
// Helper: Safe Cancel Handler
// ---------------------------------------------------------------------------

/**
 * Checks if the prompt was cancelled by the user (e.g. Ctrl+C or Esc).
 * If cancelled, prints a goodbye message and terminates the process cleanly.
 */
function checkCancel<T>(value: T | symbol): asserts value is T {
  if (isCancel(value)) {
    cancel('Operation cancelled.');
    process.exit(0);
  }
}

/**
 * Helper to mask sensitive API keys for safe terminal display.
 */
function maskApiKey(key: string): string {
  if (key.length <= 4) return '****';
  return `${'*'.repeat(Math.max(key.length - 4, 4))}${key.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Credentials Setup Helper
// ---------------------------------------------------------------------------

/**
 * Prompts the user to set up their Bubble credentials interactively if not yet configured.
 */
async function promptForCredentials(profileName = 'default'): Promise<{ appName: string; apiKey: string }> {
  log.info(chalk.cyan(`⚙️  Set up Bubble.io credentials for profile "${profileName}"`));

  const appName = await text({
    message: 'Bubble App Name / Subdomain:',
    placeholder: 'e.g. my-app (from my-app.bubbleapps.io)',
    validate: (val) => {
      if (!val || val.trim().length === 0) return 'App name is required.';
      if (val.includes('.')) return 'Enter only the subdomain name (e.g. "my-app", not "my-app.bubbleapps.io").';
      return undefined;
    },
  });
  checkCancel(appName);

  const apiKey = await password({
    message: 'Bubble API Key (Data / Meta API Token):',
    mask: '•',
    validate: (val) => {
      if (!val || val.trim().length === 0) return 'API Key is required.';
      return undefined;
    },
  });
  checkCancel(apiKey);

  const trimmedApp = appName.trim();
  const trimmedKey = apiKey.trim();

  storage.saveConfig({ appName: trimmedApp, apiKey: trimmedKey }, profileName);
  log.success(chalk.green(`✅ Configuration saved for profile "${profileName}".`));

  return { appName: trimmedApp, apiKey: trimmedKey };
}

/**
 * Ensures credentials exist before executing operations that require the Bubble API.
 */
async function ensureCredentials(): Promise<{ appName: string; apiKey: string }> {
  const activeProfile = storage.getActiveProfile();
  const existingConfig = storage.getConfig(activeProfile);

  if (existingConfig) {
    return existingConfig;
  }

  const shouldConfigure = await confirm({
    message: `No credentials found for profile "${activeProfile}". Would you like to configure them now?`,
    initialValue: true,
  });
  checkCancel(shouldConfigure);

  if (!shouldConfigure) {
    cancel('Cannot proceed without API credentials.');
    process.exit(0);
  }

  return await promptForCredentials(activeProfile);
}

// ---------------------------------------------------------------------------
// Category: Schema Sub-Menu
// ---------------------------------------------------------------------------

async function handleSchemaMenu(program: Command): Promise<void> {
  await ensureCredentials();

  const action = await select({
    message: '📐 Schema Operations — Choose an action:',
    options: [
      { value: 'list', label: '🔍 List App Schema', hint: 'Browse all data types and fields' },
      { value: 'diff', label: '🔄 Schema Diff', hint: 'Compare schema between test and live environments' },
      { value: 'erd', label: '📊 Generate ERD Diagram', hint: 'Export Mermaid.js Entity-Relationship diagram' },
      { value: 'migrate_generate', label: '📝 Generate Schema Migration', hint: 'Create timestamped migration file from schema diff' },
      { value: 'migrate_list', label: '📜 View Migration History / Status', hint: 'Inspect recorded migrations and lockfile baseline' },
      { value: 'migrate_snapshot', label: '📸 Create Baseline Schema Snapshot', hint: 'Initialize or update schema.lock.json baseline' },
      { value: 'back', label: '⬅️  Back to Main Menu' },
    ],
  });
  checkCancel(action);

  if (action === 'back') return;

  if (action === 'list') {
    const env = await select({
      message: 'Target environment:',
      options: [
        { value: 'version-test', label: '🧪 Development (version-test)' },
        { value: 'version-live', label: '🚀 Production (version-live)' },
      ],
    });
    checkCancel(env);

    const viewMode = await select({
      message: 'Display mode:',
      options: [
        { value: 'all_fields', label: '📋 All Types & Fields (--fields)' },
        { value: 'types_only', label: '🏷️  Type Names Only' },
        { value: 'specific_type', label: '🎯 Specific Data Type (--type)' },
      ],
    });
    checkCancel(viewMode);

    const args = ['node', 'bubble-io-cli', 'schema', 'list', '--env', String(env)];

    if (viewMode === 'all_fields') {
      args.push('--fields');
    } else if (viewMode === 'specific_type') {
      const typeName = await text({
        message: 'Enter data type name to inspect:',
        placeholder: 'e.g. User, Product, Order',
        validate: (val) => (!val || val.trim().length === 0 ? 'Type name is required.' : undefined),
      });
      checkCancel(typeName);
      args.push('--type', typeName.trim(), '--fields');
    }

    await program.parseAsync(args);
  } else if (action === 'diff') {
    const envA = await select({
      message: 'Source environment (Environment A):',
      options: [
        { value: 'version-test', label: '🧪 Development (version-test)' },
        { value: 'version-live', label: '🚀 Production (version-live)' },
      ],
    });
    checkCancel(envA);

    const envB = await select({
      message: 'Target environment (Environment B):',
      options: [
        { value: 'version-live', label: '🚀 Production (version-live)' },
        { value: 'version-test', label: '🧪 Development (version-test)' },
      ],
    });
    checkCancel(envB);

    await program.parseAsync(['node', 'bubble-io-cli', 'schema', 'diff', '--env-a', String(envA), '--env-b', String(envB)]);
  } else if (action === 'erd') {
    const env = await select({
      message: 'Target environment:',
      options: [
        { value: 'version-test', label: '🧪 Development (version-test)' },
        { value: 'version-live', label: '🚀 Production (version-live)' },
      ],
    });
    checkCancel(env);

    const outputChoice = await select({
      message: 'Output destination:',
      options: [
        { value: 'file', label: '💾 Save to Markdown file (e.g. ./erd.md)' },
        { value: 'stdout', label: '🖥️  Print Mermaid syntax to terminal' },
      ],
    });
    checkCancel(outputChoice);

    const includeSystem = await confirm({
      message: 'Include Bubble system types (User, FileObject, etc.) in diagram?',
      initialValue: false,
    });
    checkCancel(includeSystem);

    const args = ['node', 'bubble-io-cli', 'schema', 'erd', '--env', String(env)];
    if (includeSystem) args.push('--include-system-types');

    if (outputChoice === 'file') {
      const outputPath = await text({
        message: 'File path to save ERD:',
        placeholder: './erd.md',
        defaultValue: './erd.md',
      });
      checkCancel(outputPath);
      args.push('--output', outputPath.trim());
    }

    await program.parseAsync(args);
  } else if (action === 'migrate_generate') {
    const name = await text({
      message: 'Migration name / identifier:',
      placeholder: 'e.g. add_user_profile_and_orders',
      validate: (val) => (!val || val.trim().length === 0 ? 'Migration name is required.' : undefined),
    });
    checkCancel(name);

    const description = await text({
      message: 'Migration description (optional):',
      placeholder: 'e.g. Add phone number and status field to User table',
    });
    checkCancel(description);

    const env = await select({
      message: 'Target environment to inspect:',
      options: [
        { value: 'version-test', label: '🧪 Development (version-test)' },
        { value: 'version-live', label: '🚀 Production (version-live)' },
      ],
    });
    checkCancel(env);

    const diffMode = await select({
      message: 'Baseline comparison source:',
      options: [
        { value: 'lockfile', label: '🔒 Local Lockfile Baseline (schema.lock.json)', hint: 'Tracks incremental changes against last snapshot' },
        { value: 'from_env', label: '🌐 Direct Environment Diff (--from-env)', hint: 'Compare directly with another live Bubble environment' },
      ],
    });
    checkCancel(diffMode);

    let fromEnvVal: string | undefined;
    if (diffMode === 'from_env') {
      const fromEnv = await select({
        message: 'Source environment to compare from:',
        options: [
          { value: 'version-live', label: '🚀 Production (version-live)' },
          { value: 'version-test', label: '🧪 Development (version-test)' },
        ],
      });
      checkCancel(fromEnv);
      fromEnvVal = String(fromEnv);
    }

    const dir = await text({
      message: 'Migrations directory:',
      placeholder: './migrations',
      defaultValue: './migrations',
    });
    checkCancel(dir);

    const args = [
      'node',
      'bubble-io-cli',
      'schema',
      'migrate:generate',
      '--name',
      name.trim(),
      '--env',
      String(env),
      '--dir',
      dir.trim() || './migrations',
    ];

    if (description && description.trim().length > 0) {
      args.push('--description', description.trim());
    }

    if (fromEnvVal) {
      args.push('--from-env', fromEnvVal);
    }

    await program.parseAsync(args);
  } else if (action === 'migrate_list') {
    const dir = await text({
      message: 'Migrations directory:',
      placeholder: './migrations',
      defaultValue: './migrations',
    });
    checkCancel(dir);

    await program.parseAsync([
      'node',
      'bubble-io-cli',
      'schema',
      'migrate:list',
      '--dir',
      dir.trim() || './migrations',
    ]);
  } else if (action === 'migrate_snapshot') {
    const env = await select({
      message: 'Target environment for snapshot:',
      options: [
        { value: 'version-test', label: '🧪 Development (version-test)' },
        { value: 'version-live', label: '🚀 Production (version-live)' },
      ],
    });
    checkCancel(env);

    const dir = await text({
      message: 'Migrations directory for lockfile:',
      placeholder: './migrations',
      defaultValue: './migrations',
    });
    checkCancel(dir);

    await program.parseAsync([
      'node',
      'bubble-io-cli',
      'schema',
      'migrate:generate',
      '--snapshot-only',
      '--env',
      String(env),
      '--dir',
      dir.trim() || './migrations',
    ]);
  }
}

// ---------------------------------------------------------------------------
// Category: Data Operations Sub-Menu
// ---------------------------------------------------------------------------

async function handleDataMenu(program: Command): Promise<void> {
  await ensureCredentials();

  const action = await select({
    message: '💾 Data Operations — Choose an action:',
    options: [
      { value: 'backup', label: '📦 Create Database Backup', hint: 'Export records to JSON or CSV' },
      { value: 'restore', label: '📥 Restore Data from Backup', hint: 'Upload records back to Bubble API' },
      { value: 'diff', label: '🔍 Diff Live Data vs Backup File', hint: 'Detect added, removed, or modified records' },
      { value: 'seed', label: '🌱 Seed Relational Data', hint: 'Import complex multi-table dataset from JSON' },
      { value: 'query', label: '💬 Interactive Query REPL', hint: 'Live terminal data browser with filters & pagination' },
      { value: 'export_db', label: '📤 Export to External Database', hint: 'Direct stream to SQLite, Postgres, or BigQuery' },
      { value: 'back', label: '⬅️  Back to Main Menu' },
    ],
  });
  checkCancel(action);

  if (action === 'back') return;

  if (action === 'backup') {
    const typeName = await text({
      message: 'Bubble data type to backup:',
      placeholder: 'e.g. User, Product, Order',
      validate: (v) => (!v || v.trim().length === 0 ? 'Data type is required.' : undefined),
    });
    checkCancel(typeName);

    const env = await select({
      message: 'Target environment:',
      options: [
        { value: 'version-test', label: '🧪 Development (version-test)' },
        { value: 'version-live', label: '🚀 Production (version-live)' },
      ],
    });
    checkCancel(env);

    const format = await select({
      message: 'Export format:',
      options: [
        { value: 'json', label: '📄 JSON (Full metadata + nested types)' },
        { value: 'csv', label: '📊 CSV (Spreadsheet-friendly)' },
      ],
    });
    checkCancel(format);

    const outputDir = await text({
      message: 'Output directory:',
      placeholder: '.',
      defaultValue: '.',
    });
    checkCancel(outputDir);

    const isLimit = await confirm({
      message: 'Do you want to limit the number of records (partial backup)?',
      initialValue: false,
    });
    checkCancel(isLimit);

    let limitVal: string | undefined;
    if (isLimit) {
      const limitInput = await text({
        message: 'Max number of records:',
        placeholder: '100',
        validate: (v) => (isNaN(Number(v)) || Number(v) <= 0 ? 'Must be a positive number.' : undefined),
      });
      checkCancel(limitInput);
      limitVal = limitInput.trim();
    }

    const args = [
      'node',
      'bubble-io-cli',
      'backup',
      '--type',
      typeName.trim(),
      '--env',
      String(env),
      '--format',
      String(format),
      '--output',
      outputDir.trim(),
    ];
    if (limitVal) args.push('--limit', limitVal);

    await program.parseAsync(args);
  } else if (action === 'restore') {
    const filePath = await text({
      message: 'Path to backup JSON file:',
      placeholder: 'e.g. ./backup-user-2026-08-08.json',
      validate: (v) => (!v || v.trim().length === 0 ? 'File path is required.' : undefined),
    });
    checkCancel(filePath);

    const env = await select({
      message: 'Target restore environment:',
      options: [
        { value: 'version-test', label: '🧪 Development (version-test) [Recommended]' },
        { value: 'version-live', label: '🚀 Production (version-live) [Caution]' },
      ],
    });
    checkCancel(env);

    const mode = await select({
      message: 'Restore mode:',
      options: [
        { value: 'create', label: '➕ Create (Insert as new records)' },
        { value: 'upsert', label: '🔄 Upsert (Update existing by _id, create new)' },
      ],
    });
    checkCancel(mode);

    const isDryRun = await confirm({
      message: 'Perform a dry-run first (validate without writing)?',
      initialValue: true,
    });
    checkCancel(isDryRun);

    const args = [
      'node',
      'bubble-io-cli',
      'restore',
      '--file',
      filePath.trim(),
      '--env',
      String(env),
      '--mode',
      String(mode),
    ];
    if (isDryRun) args.push('--dry-run');

    await program.parseAsync(args);
  } else if (action === 'diff') {
    const filePath = await text({
      message: 'Path to local backup JSON file to compare against:',
      placeholder: 'e.g. ./backup-user.json',
      validate: (v) => (!v || v.trim().length === 0 ? 'File path is required.' : undefined),
    });
    checkCancel(filePath);

    const env = await select({
      message: 'Target environment to check:',
      options: [
        { value: 'version-test', label: '🧪 Development (version-test)' },
        { value: 'version-live', label: '🚀 Production (version-live)' },
      ],
    });
    checkCancel(env);

    const summaryOnly = await confirm({
      message: 'Show summary counts only (omit individual record diffs)?',
      initialValue: false,
    });
    checkCancel(summaryOnly);

    const args = ['node', 'bubble-io-cli', 'diff', '--file', filePath.trim(), '--env', String(env)];
    if (summaryOnly) args.push('--summary');

    await program.parseAsync(args);
  } else if (action === 'seed') {
    const filePath = await text({
      message: 'Path to seed file (.json):',
      placeholder: 'e.g. seeds/catalog.json',
      validate: (v) => (!v || v.trim().length === 0 ? 'Seed file path is required.' : undefined),
    });
    checkCancel(filePath);

    const env = await select({
      message: 'Target environment:',
      options: [
        { value: 'version-test', label: '🧪 Development (version-test)' },
        { value: 'version-live', label: '🚀 Production (version-live)' },
      ],
    });
    checkCancel(env);

    const isDryRun = await confirm({
      message: 'Run preflight check / dry-run simulation first?',
      initialValue: true,
    });
    checkCancel(isDryRun);

    const args = ['node', 'bubble-io-cli', 'seed', '--file', filePath.trim(), '--env', String(env)];
    if (isDryRun) args.push('--dry-run');

    await program.parseAsync(args);
  } else if (action === 'query') {
    const env = await select({
      message: 'Environment for interactive query session:',
      options: [
        { value: 'version-test', label: '🧪 Development (version-test)' },
        { value: 'version-live', label: '🚀 Production (version-live)' },
      ],
    });
    checkCancel(env);

    log.info(chalk.cyan('Launching interactive REPL Query Session... (type .help for commands, .exit to return)'));
    await program.parseAsync(['node', 'bubble-io-cli', 'query', '--env', String(env)]);
  } else if (action === 'export_db') {
    const provider = await select({
      message: 'Select target database provider:',
      options: [
        { value: 'sqlite', label: '🪶 SQLite (Local zero-config .db file)' },
        { value: 'postgres', label: '🐘 PostgreSQL (Relational DB)' },
        { value: 'bigquery', label: '☁️  Google Cloud BigQuery (Data Warehouse)' },
      ],
    });
    checkCancel(provider);

    const dataType = await text({
      message: 'Bubble data type to export:',
      placeholder: 'e.g. User, Product',
      validate: (v) => (!v || v.trim().length === 0 ? 'Data type is required.' : undefined),
    });
    checkCancel(dataType);

    const env = await select({
      message: 'Target environment:',
      options: [
        { value: 'version-test', label: '🧪 Development (version-test)' },
        { value: 'version-live', label: '🚀 Production (version-live)' },
      ],
    });
    checkCancel(env);

    const args = [
      'node',
      'bubble-io-cli',
      'export',
      'db',
      '--type',
      dataType.trim(),
      '--target',
      String(provider),
      '--env',
      String(env),
    ];

    if (provider === 'sqlite') {
      const dbPath = await text({
        message: 'SQLite database file destination:',
        placeholder: './bubble.db',
        defaultValue: './bubble.db',
      });
      checkCancel(dbPath);
      args.push('--db', dbPath.trim());
    } else if (provider === 'postgres') {
      const connStr = await text({
        message: 'PostgreSQL Connection URL:',
        placeholder: 'postgresql://user:password@localhost:5432/mydb',
        validate: (v) => (!v || v.trim().length === 0 ? 'Connection string is required.' : undefined),
      });
      checkCancel(connStr);
      args.push('--connection-string', connStr.trim());
    } else if (provider === 'bigquery') {
      const project = await text({
        message: 'GCP Project ID:',
        validate: (v) => (!v || v.trim().length === 0 ? 'Project ID is required.' : undefined),
      });
      checkCancel(project);

      const dataset = await text({
        message: 'BigQuery Dataset Name:',
        defaultValue: 'bubble_data',
      });
      checkCancel(dataset);

      args.push('--project', project.trim(), '--dataset', dataset.trim());
    }

    await program.parseAsync(args);
  }
}

// ---------------------------------------------------------------------------
// Category: Code & Type Generation Sub-Menu
// ---------------------------------------------------------------------------

async function handleGenerateMenu(program: Command): Promise<void> {
  const action = await select({
    message: '🧬 Code Generation — Choose an action:',
    options: [
      { value: 'types', label: '⚡ TypeScript Type Generation', hint: 'Create .d.ts interfaces from live schema' },
      { value: 'template', label: '🏗️  Scaffold Integration Template', hint: 'Plugin actions, API connectors, webhooks' },
      { value: 'ci', label: '🚀 CI/CD Workflow Generation', hint: 'Generate GitHub Actions for nightly backups' },
      { value: 'back', label: '⬅️  Back to Main Menu' },
    ],
  });
  checkCancel(action);

  if (action === 'back') return;

  if (action === 'types') {
    await ensureCredentials();

    const env = await select({
      message: 'Target environment for schema reflection:',
      options: [
        { value: 'version-test', label: '🧪 Development (version-test)' },
        { value: 'version-live', label: '🚀 Production (version-live)' },
      ],
    });
    checkCancel(env);

    const outputChoice = await select({
      message: 'Output destination:',
      options: [
        { value: 'file', label: '💾 Save to TypeScript file (e.g. ./src/types/bubble.d.ts)' },
        { value: 'stdout', label: '🖥️  Preview in terminal' },
      ],
    });
    checkCancel(outputChoice);

    const filterType = await text({
      message: 'Filter specific data type (leave blank for all):',
      placeholder: 'e.g. User, or press Enter for all',
    });
    checkCancel(filterType);

    const args = ['node', 'bubble-io-cli', 'generate', 'types', '--env', String(env)];
    if (filterType && filterType.trim().length > 0) {
      args.push('--type', filterType.trim());
    }

    if (outputChoice === 'file') {
      const outputPath = await text({
        message: 'File path to save types:',
        placeholder: './bubble-types.d.ts',
        defaultValue: './bubble-types.d.ts',
      });
      checkCancel(outputPath);
      args.push('--output', outputPath.trim());
    }

    await program.parseAsync(args);
  } else if (action === 'template') {
    const template = await select({
      message: 'Select template type to scaffold:',
      options: [
        { value: 'plugin-action', label: '🔌 Plugin Action (Server-side action scaffold)' },
        { value: 'api-connector', label: '🔗 API Connector (Integration helper)' },
        { value: 'data-trigger', label: '⚡ Data Trigger (Webhook receiver scaffold)' },
      ],
    });
    checkCancel(template);

    const name = await text({
      message: 'Entity name:',
      placeholder: 'e.g. ProcessOrder, SyncUser',
      validate: (v) => (!v || v.trim().length === 0 ? 'Name is required.' : undefined),
    });
    checkCancel(name);

    const output = await text({
      message: 'Output directory:',
      placeholder: './generated',
      defaultValue: './generated',
    });
    checkCancel(output);

    await program.parseAsync([
      'node',
      'bubble-io-cli',
      'generate',
      '--template',
      String(template),
      '--name',
      name.trim(),
      '--output',
      output.trim(),
    ]);
  } else if (action === 'ci') {
    const dataType = await text({
      message: 'Bubble data type to automate backup for:',
      placeholder: 'User',
      defaultValue: 'User',
    });
    checkCancel(dataType);

    const env = await select({
      message: 'Target environment in CI:',
      options: [
        { value: 'version-live', label: '🚀 Production (version-live)' },
        { value: 'version-test', label: '🧪 Development (version-test)' },
      ],
    });
    checkCancel(env);

    const cron = await text({
      message: 'Backup schedule cron expression (UTC):',
      placeholder: '0 3 * * *',
      defaultValue: '0 3 * * *',
    });
    checkCancel(cron);

    await program.parseAsync([
      'node',
      'bubble-io-cli',
      'generate',
      'ci',
      '--provider',
      'github',
      '--type',
      dataType.trim(),
      '--env',
      String(env),
      '--cron',
      cron.trim(),
    ]);
  }
}

// ---------------------------------------------------------------------------
// Category: Developer Tools Sub-Menu
// ---------------------------------------------------------------------------

async function handleDevToolsMenu(program: Command): Promise<void> {
  const action = await select({
    message: '🛠️  Developer Tools — Choose an action:',
    options: [
      { value: 'audit', label: '🛡️  PII Security & Privacy Audit', hint: 'Scan schema or backup files for sensitive data' },
      { value: 'health', label: '🏥 API Health & Connectivity Check', hint: 'Ping Bubble endpoints and measure latency' },
      { value: 'mock', label: '🎭 Start Mock API Server', hint: 'Local offline Bubble Data API from backup files' },
      { value: 'workflow', label: '⚡ Trigger Backend Workflow', hint: 'Call exposed Bubble backend workflows via API' },
      { value: 'plugin', label: '🔌 Plugin & Extension Manager', hint: 'Inspect/deploy plugins or manage CLI extensions' },
      { value: 'completions', label: '🐚 Shell Completions Setup', hint: 'Install Bash, Zsh, or Fish autocompletions' },
      { value: 'back', label: '⬅️  Back to Main Menu' },
    ],
  });
  checkCancel(action);

  if (action === 'back') return;

  if (action === 'audit') {
    const auditTarget = await select({
      message: 'Audit target:',
      options: [
        { value: 'schema', label: '🌐 Live Bubble App Schema' },
        { value: 'file', label: '📄 Local Backup JSON File' },
      ],
    });
    checkCancel(auditTarget);

    const threshold = await select({
      message: 'Minimum risk severity to report:',
      options: [
        { value: 'MEDIUM', label: '🟡 Medium (Emails, Names, Addresses, etc.)' },
        { value: 'HIGH', label: '🟠 High (Phones, IP addresses, Financial)' },
        { value: 'CRITICAL', label: '🔴 Critical only (API Keys, Passwords, Tokens, SSN)' },
      ],
    });
    checkCancel(threshold);

    if (auditTarget === 'schema') {
      await ensureCredentials();
      const env = await select({
        message: 'Target environment:',
        options: [
          { value: 'version-test', label: '🧪 Development (version-test)' },
          { value: 'version-live', label: '🚀 Production (version-live)' },
        ],
      });
      checkCancel(env);

      await program.parseAsync(['node', 'bubble-io-cli', 'audit', '--schema', '--env', String(env), '--threshold', String(threshold)]);
    } else {
      const filePath = await text({
        message: 'Path to backup JSON file to scan:',
        placeholder: 'e.g. backup-user.json',
        validate: (v) => (!v || v.trim().length === 0 ? 'File path is required.' : undefined),
      });
      checkCancel(filePath);

      await program.parseAsync(['node', 'bubble-io-cli', 'audit', '--file', filePath.trim(), '--threshold', String(threshold)]);
    }
  } else if (action === 'health') {
    await ensureCredentials();

    const envChoice = await select({
      message: 'Environment to test:',
      options: [
        { value: 'all', label: '🌐 Both Environments (version-test & version-live)' },
        { value: 'version-test', label: '🧪 Development only (version-test)' },
        { value: 'version-live', label: '🚀 Production only (version-live)' },
      ],
    });
    checkCancel(envChoice);

    const args = ['node', 'bubble-io-cli', 'health'];
    if (envChoice === 'all') {
      args.push('--all');
    } else {
      args.push('--env', String(envChoice));
    }

    await program.parseAsync(args);
  } else if (action === 'mock') {
    const filePath = await text({
      message: 'Path to backup JSON file to serve as mock API data:',
      placeholder: 'e.g. backup-product.json',
      validate: (v) => (!v || v.trim().length === 0 ? 'File path is required.' : undefined),
    });
    checkCancel(filePath);

    const port = await text({
      message: 'Local server port:',
      placeholder: '4000',
      defaultValue: '4000',
    });
    checkCancel(port);

    log.info(chalk.cyan(`Starting local mock API server on http://localhost:${port}...`));
    await program.parseAsync(['node', 'bubble-io-cli', 'mock', '--file', filePath.trim(), '--port', port.trim()]);
  } else if (action === 'workflow') {
    await ensureCredentials();

    const wfName = await text({
      message: 'Bubble Workflow API Name:',
      placeholder: 'e.g. send-invoice, daily-cleanup',
      validate: (v) => (!v || v.trim().length === 0 ? 'Workflow name is required.' : undefined),
    });
    checkCancel(wfName);

    const env = await select({
      message: 'Target environment:',
      options: [
        { value: 'version-live', label: '🚀 Production (version-live)' },
        { value: 'version-test', label: '🧪 Development (version-test)' },
      ],
    });
    checkCancel(env);

    const payloadInput = await text({
      message: 'JSON parameters to pass (or leave blank):',
      placeholder: 'e.g. {"userId": "123"} or @params.json',
    });
    checkCancel(payloadInput);

    const args = ['node', 'bubble-io-cli', 'workflow', 'trigger', '--name', wfName.trim(), '--env', String(env)];
    if (payloadInput && payloadInput.trim().length > 0) {
      args.push('--data', payloadInput.trim());
    }

    await program.parseAsync(args);
  } else if (action === 'plugin') {
    const pluginAction = await select({
      message: 'Plugin management action:',
      options: [
        { value: 'list', label: '📋 List app plugins (Bubble Plugin API)' },
        { value: 'ext_list', label: '🔌 List CLI extension plugins' },
        { value: 'ext_reload', label: '🔄 Reload CLI extension plugins' },
      ],
    });
    checkCancel(pluginAction);

    if (pluginAction === 'list') {
      await program.parseAsync(['node', 'bubble-io-cli', 'plugin', 'list']);
    } else if (pluginAction === 'ext_list') {
      await program.parseAsync(['node', 'bubble-io-cli', 'plugin', 'ext', 'list']);
    } else if (pluginAction === 'ext_reload') {
      await program.parseAsync(['node', 'bubble-io-cli', 'plugin', 'ext', 'reload']);
    }
  } else if (action === 'completions') {
    const shell = await select({
      message: 'Select your shell for completion instructions:',
      options: [
        { value: 'bash', label: '🐚 Bash' },
        { value: 'zsh', label: '🐚 Zsh' },
        { value: 'fish', label: '🐠 Fish' },
      ],
    });
    checkCancel(shell);

    await program.parseAsync(['node', 'bubble-io-cli', 'completions', `--${shell}`]);
  }
}

// ---------------------------------------------------------------------------
// Category: Profiles & Configuration Sub-Menu
// ---------------------------------------------------------------------------

async function handleConfigMenu(program: Command): Promise<void> {
  const action = await select({
    message: '⚙️  Profile & Configuration — Choose an action:',
    options: [
      { value: 'show', label: '📋 Show Current Configuration', hint: 'Display active profile, app name, and masked key' },
      { value: 'list', label: '👤 List Stored Profiles', hint: 'View all configured named profiles' },
      { value: 'use', label: '🔀 Switch Active Profile', hint: 'Change default profile' },
      { value: 'edit', label: '➕ Add or Update Profile Credentials', hint: 'Enter new app name and API key' },
      { value: 'clear', label: '🗑️  Clear Profile Credentials', hint: 'Remove credentials for a profile' },
      { value: 'back', label: '⬅️  Back to Main Menu' },
    ],
  });
  checkCancel(action);

  if (action === 'back') return;

  if (action === 'show') {
    await program.parseAsync(['node', 'bubble-io-cli', 'config', '--show']);
  } else if (action === 'list') {
    await program.parseAsync(['node', 'bubble-io-cli', 'config', '--list']);
  } else if (action === 'use') {
    const profiles = storage.listProfiles();
    if (profiles.length === 0) {
      log.warn('No profiles found.');
      return;
    }
    const profileToUse = await select({
      message: 'Select profile to activate:',
      options: profiles.map((p) => ({ value: p, label: p })),
    });
    checkCancel(profileToUse);

    await program.parseAsync(['node', 'bubble-io-cli', 'config', '--use', String(profileToUse)]);
  } else if (action === 'edit') {
    const profileName = await text({
      message: 'Profile name to configure (or "default"):',
      placeholder: 'default',
      defaultValue: storage.getActiveProfile(),
    });
    checkCancel(profileName);

    await promptForCredentials(profileName.trim());
  } else if (action === 'clear') {
    const clearOption = await select({
      message: 'Clear options:',
      options: [
        { value: 'current', label: `🗑️  Clear active profile ("${storage.getActiveProfile()}")` },
        { value: 'all', label: '⚠️  Clear ALL profiles (Reset CLI store)' },
      ],
    });
    checkCancel(clearOption);

    if (clearOption === 'all') {
      const confirmAll = await confirm({
        message: 'Are you sure you want to delete ALL saved profiles?',
        initialValue: false,
      });
      checkCancel(confirmAll);
      if (confirmAll) {
        await program.parseAsync(['node', 'bubble-io-cli', 'config', '--clear', '--all']);
      }
    } else {
      await program.parseAsync(['node', 'bubble-io-cli', 'config', '--clear']);
    }
  }
}

// ---------------------------------------------------------------------------
// Main Interactive Entry Point
// ---------------------------------------------------------------------------

/**
 * Runs the interactive terminal user interface (TUI) when the CLI is invoked without arguments.
 *
 * @param program - The configured Commander root instance.
 */
export async function runInteractiveMenu(program: Command): Promise<void> {
  // 1. Intro Banner
  intro(chalk.bgCyan.black.bold(' 🫧  Bubble.io CLI — Interactive Mode '));

  // 2. Active Profile Summary
  const activeProfile = storage.getActiveProfile();
  const currentConfig = storage.getConfig(activeProfile);

  if (currentConfig) {
    note(
      `${chalk.bold('Profile:')} ${chalk.cyan(activeProfile)}\n` +
      `${chalk.bold('App:    ')} ${chalk.green(currentConfig.appName + '.bubbleapps.io')}\n` +
      `${chalk.bold('API Key:')} ${chalk.dim(maskApiKey(currentConfig.apiKey))}`,
      'Active Environment'
    );
  } else {
    note(
      chalk.yellow('No credentials configured yet.\nSelect "⚙️ Configure / Change Profile" or any action to get started.'),
      'Welcome'
    );
  }

  // 3. Interactive Menu Loop
  let keepRunning = true;

  while (keepRunning) {
    const choice = await select({
      message: 'What would you like to do?',
      options: [
        { value: 'schema', label: '📐 Schema Operations', hint: 'List, Diff, ERD diagram' },
        { value: 'data', label: '💾 Data Operations', hint: 'Backup, Restore, Diff, Seed, REPL Query, DB Export' },
        { value: 'generate', label: '🧬 Code & Type Generation', hint: 'TypeScript interfaces, Templates, CI/CD' },
        { value: 'devtools', label: '🛠️  Developer Tools', hint: 'PII Audit, Health check, Mock server, Workflows' },
        { value: 'config', label: '⚙️  Profiles & Credentials', hint: 'Manage saved apps and API keys' },
        { value: 'exit', label: '❌ Exit' },
      ],
    });
    checkCancel(choice);

    try {
      switch (choice) {
        case 'schema':
          await handleSchemaMenu(program);
          break;
        case 'data':
          await handleDataMenu(program);
          break;
        case 'generate':
          await handleGenerateMenu(program);
          break;
        case 'devtools':
          await handleDevToolsMenu(program);
          break;
        case 'config':
          await handleConfigMenu(program);
          break;
        case 'exit':
          keepRunning = false;
          break;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(chalk.red(`Error executing action: ${msg}`));
    }

    if (keepRunning) {
      console.log(); // Blank line for spacing
      const another = await confirm({
        message: 'Would you like to execute another action?',
        initialValue: true,
      });
      checkCancel(another);

      if (!another) {
        keepRunning = false;
      }
    }
  }

  // 4. Outro
  outro(chalk.cyan('✨ Thanks for using Bubble.io CLI!'));
}
