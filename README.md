# 🫧 bubble-io-cli

<div align="center">

**A powerful, open-source command-line interface for developers and entrepreneurs who build with Bubble.io.**

[![npm version](https://img.shields.io/npm/v/bubble-io-cli?color=blue&style=flat-square)](https://www.npmjs.com/package/bubble-io-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green?style=flat-square&logo=node.js)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/tests-68%20passing-brightgreen?style=flat-square)](https://github.com/alexandrmotologa/bubble-io-cli)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](CONTRIBUTING.md)

</div>

---

## ✨ What is bubble-io-cli?

`bubble-io-cli` brings your Bubble.io application to the terminal. Instead of navigating the Bubble dashboard to export data or manage configurations, you can now automate these workflows directly from the command line — perfect for **CI/CD pipelines**, **scheduled backups**, **developer tooling**, and **no-code + code hybrid workflows**.

```bash
# Install globally
npm install -g bubble-io-cli

# Configure once
bubble-io-cli config --app my-cool-app --key YOUR_BUBBLE_API_KEY

# Back up any data type instantly
bubble-io-cli backup --type Product --env version-live

# Compare schema between environments
bubble-io-cli schema diff

# Start a local mock server for offline testing
bubble-io-cli mock --file ./backup-product.json --port 3333
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** >= 18.0.0
- A [Bubble.io](https://bubble.io) account with API access enabled
- Your Bubble **Private API Key** (found in Settings → API → Private key)

### Installation

```bash
# Install globally via npm
npm install -g bubble-io-cli

# Or use directly without installing
npx bubble-io-cli --help
```

---

## 📖 Commands

### `config` — Manage Credentials & Profiles

Store your Bubble app credentials securely in local OS config storage. Supports **multiple named profiles** so you can manage credentials for several Bubble apps simultaneously.

```bash
# Save credentials (default profile)
bubble-io-cli config --app my-cool-app --key YOUR_BUBBLE_API_KEY

# Save credentials under a named profile
bubble-io-cli config --app my-staging-app --key STAGING_KEY --profile staging

# List all stored profiles (shows active profile with ●)
bubble-io-cli config --list

# Switch the active profile
bubble-io-cli config --use staging

# View the current profile's configuration (key is masked)
bubble-io-cli config --show

# View a specific profile's configuration
bubble-io-cli config --show --profile staging

# Clear the current profile
bubble-io-cli config --clear

# Clear a specific profile
bubble-io-cli config --clear --profile staging

# Clear ALL profiles
bubble-io-cli config --clear --all
```

| Option | Alias | Description |
|---|---|---|
| `--app <name>` | `-a` | Your Bubble app subdomain |
| `--key <apiKey>` | `-k` | Your private Bubble API key |
| `--profile <name>` | `-p` | Named profile to save/load |
| `--show` | | Display the current config |
| `--list` | | List all profiles |
| `--use <profile>` | | Switch active profile |
| `--clear` | | Clear current or named profile |
| `--all` | | Combined with `--clear`: remove all profiles |

---

### `backup` — Export Data

Download records from any Bubble data type and save them locally. Supports JSON and CSV output, server-side filtering, incremental exports, cloud upload, encryption, watch mode, and CI-friendly JSON output.

```bash
# Basic backup (test environment, all records)
bubble-io-cli backup --type Product

# Backup from production
bubble-io-cli backup --type User --env version-live

# Limit to first 100 records
bubble-io-cli backup --type Product --limit 100

# Export as CSV
bubble-io-cli backup --type Order --format csv

# Server-side filtering (Bubble constraints)
bubble-io-cli backup --type Order \
  --constraint '[{"key":"status","constraint_type":"equals","value":"active"}]'

# Incremental export — only records modified since a date
bubble-io-cli backup --type User --since 2026-08-01

# Watch mode — backup every hour automatically
bubble-io-cli backup --type Product --watch --interval 3600

# Upload to Amazon S3 after export
bubble-io-cli backup --type User --destination s3://my-bucket/backups

# Upload to Google Cloud Storage
bubble-io-cli backup --type User --destination gs://my-bucket/backups

# Encrypt the backup (AES-256-GCM)
export BUBBLE_BACKUP_PASSPHRASE="your-strong-passphrase"
bubble-io-cli backup --type Product --encrypt

# Send Slack / Discord notification on completion
bubble-io-cli backup --type Product \
  --notify-slack https://hooks.slack.com/services/T/B/secret \
  --notify-discord https://discord.com/api/webhooks/123/secret

# Machine-readable JSON output for CI/CD
bubble-io-cli backup --type Product --json
```

| Option | Alias | Description | Default |
|---|---|---|---|
| `--type <datatype>` | `-t` | Bubble data type (**required**) | — |
| `--env <environment>` | `-e` | `version-test` or `version-live` | `version-test` |
| `--output <dir>` | `-o` | Output directory | `.` |
| `--limit <number>` | `-l` | Max records to fetch | all |
| `--format <type>` | `-f` | `json` or `csv` | `json` |
| `--constraint <json>` | `-c` | Bubble constraint JSON array | — |
| `--since <date>` | | Export only records modified after date | — |
| `--watch` | | Continuous backup mode | — |
| `--interval <seconds>` | | Watch interval (min 10s) | `3600` |
| `--destination <url>` | | Cloud upload: `s3://` or `gs://` | — |
| `--encrypt` | | AES-256-GCM encryption | — |
| `--notify-slack <url>` | | Slack Incoming Webhook URL | — |
| `--notify-discord <url>` | | Discord Webhook URL | — |
| `--notify-on-error` | | Also notify on failures | — |
| `--json` | | Machine-readable JSON output | — |

> **Cloud upload:** Requires `npm install @aws-sdk/client-s3` (for S3) or `npm install @google-cloud/storage` (for GCS), loaded lazily.
>
> **Encryption:** Reads passphrase from `BUBBLE_BACKUP_PASSPHRASE` env var. Output file uses `.enc` extension.

---

### `restore` — Upload Records to Bubble

Bulk-upload records from a local backup file back to Bubble via the Data API.

```bash
# Restore to test environment
bubble-io-cli restore --file ./backup-product-2026-08-07.json

# Restore with upsert mode (create new + update existing by _id)
bubble-io-cli restore --file ./backup-user.json --mode upsert

# Preview what would be restored (no API calls)
bubble-io-cli restore --file ./backup-product.json --dry-run

# Control parallelism
bubble-io-cli restore --file ./backup-order.json --concurrency 10
```

| Option | Alias | Description | Default |
|---|---|---|---|
| `--file <path>` | `-f` | Backup JSON file (**required**) | — |
| `--env <environment>` | `-e` | Target environment | `version-test` |
| `--type <datatype>` | `-t` | Override data type from file | — |
| `--mode <mode>` | `-m` | `create` or `upsert` | `create` |
| `--concurrency <n>` | | Parallel API requests (1–20) | `5` |
| `--dry-run` | | Simulate without API calls | — |

---

### `diff` — Compare Data

Compare live Bubble data against a local backup file and show exactly what changed.

```bash
# Compare Product type with a local backup
bubble-io-cli diff --file ./backup-product-2026-08-07.json

# Compare specific fields only
bubble-io-cli diff --file ./backup-user.json --fields name,email,plan

# Show summary counts only
bubble-io-cli diff --file ./backup-order.json --summary
```

| Option | Alias | Description |
|---|---|---|
| `--file <path>` | `-f` | Local backup file (**required**) |
| `--type <datatype>` | `-t` | Override the data type |
| `--env <environment>` | `-e` | Target environment |
| `--fields <list>` | | Comma-separated fields to compare |
| `--summary` | | Show counts only |

---

### `health` — Check API Connectivity

Verify that your credentials are valid and your Bubble app is reachable.

```bash
# Check test environment
bubble-io-cli health

# Check both environments at once
bubble-io-cli health --all

# Check production
bubble-io-cli health --env version-live

# Machine-readable output for CI
bubble-io-cli health --json
```

| Option | Alias | Description | Default |
|---|---|---|---|
| `--env <environment>` | `-e` | Environment to check | `version-test` |
| `--all` | | Test both environments | — |
| `--type <datatype>` | `-t` | Data type to ping | `User` |
| `--json` | | JSON output | — |

---

### `schema list` — Inspect App Schema

List all data types and their field definitions using the Bubble Meta API.

> **Requires:** Enable "Expose Data API" and "Expose schema" in Bubble → Settings → API.

```bash
# List all data types
bubble-io-cli schema list

# Show fields for all types
bubble-io-cli schema list --fields

# Inspect a specific type
bubble-io-cli schema list --type Product

# Export schema as JSON
bubble-io-cli schema list --json
```

### `schema diff` — Compare Schema Between Environments

```bash
# Compare test vs live schema (default)
bubble-io-cli schema diff

# Custom environments
bubble-io-cli schema diff --env-a version-test --env-b version-live

# JSON output for CI comparison
bubble-io-cli schema diff --json
```

Output is color-coded: `+` green (added), `-` red (removed), `~` yellow (changed), at the field level.

---

### `workflow trigger` — Trigger Backend Workflows

Call Bubble backend workflows that have "This workflow can be triggered by API" enabled.

```bash
# Trigger a workflow
bubble-io-cli workflow trigger --name send-invoice

# Trigger with parameters
bubble-io-cli workflow trigger --name process-order --data '{"orderId":"abc123"}'

# Trigger on production
bubble-io-cli workflow trigger --name daily-report --env version-live

# JSON output for scripting
bubble-io-cli workflow trigger --name send-invoice --json
```

| Option | Alias | Description | Default |
|---|---|---|---|
| `--name <workflowName>` | `-n` | API name of the workflow (**required**) | — |
| `--env <environment>` | `-e` | Target environment | `version-live` |
| `--data <json>` | `-d` | JSON object of workflow parameters | — |
| `--json` | | Machine-readable output | — |

---

### `seed` — Populate Test Data

Bulk-create records in Bubble from a local JSON fixture file. Ideal for seeding test environments.

```bash
# Seed from a fixture file
bubble-io-cli seed --file ./seeds/products.json

# Preview without creating anything
bubble-io-cli seed --file ./seeds/users.json --dry-run

# Control parallelism
bubble-io-cli seed --file ./seeds/orders.json --concurrency 10
```

**Seed file format:**

```json
{
  "type": "Product",
  "records": [
    { "name": "Widget", "price": 9.99 },
    { "name": "Gadget", "price": 24.99 }
  ]
}
```

---

### `mock` — Local Mock Server

Start a local Express HTTP server that exposes a Bubble-compatible Data API from a backup JSON file. Perfect for offline development and integration testing.

```bash
# Start mock server on default port 3333
bubble-io-cli mock --file ./backup-product.json

# Custom port
bubble-io-cli mock --file ./backup-user.json --port 4000

# Enable CORS (for browser-based testing)
bubble-io-cli mock --file ./backup-product.json --cors

# Load multiple data types at once
bubble-io-cli mock --file Product=./backup-product.json --file User=./backup-user.json
```

**Available endpoints once server is running:**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/1.1/obj/:type?cursor=0&limit=100` | Paginated list |
| `GET` | `/api/1.1/obj/:type/:id` | Single record |
| `POST` | `/api/1.1/obj/:type` | Create (in-memory) |
| `PATCH` | `/api/1.1/obj/:type/:id` | Update (in-memory) |
| `DELETE` | `/api/1.1/obj/:type/:id` | Delete (in-memory) |
| `GET` | `/health` | Server status and loaded types |

---

### `plugin` — Plugin Editor API

Manage Bubble plugins via the Plugin Editor API.

> **Requires:** `BUBBLE_PLUGIN_TOKEN` environment variable.  
> Get your token: Bubble Editor → Plugins → Plugin Editor → Settings → API token

```bash
export BUBBLE_PLUGIN_TOKEN="your-plugin-editor-token"

# List all plugins
bubble-io-cli plugin list

# Get a specific plugin's full definition
bubble-io-cli plugin get <pluginId>

# Deploy a plugin definition (create new)
bubble-io-cli plugin deploy --file ./plugin.json

# Update an existing plugin
bubble-io-cli plugin deploy --file ./plugin.json --id existing-plugin-id

# Preview without making API calls
bubble-io-cli plugin deploy --file ./plugin.json --dry-run
```

---

### `generate` — Scaffold Integration Templates

Generate boilerplate TypeScript files for common Bubble integration patterns.

```bash
# List available templates
bubble-io-cli generate --list

# Scaffold a plugin server-side action
bubble-io-cli generate --template plugin-action --name SendEmail

# Scaffold a CRUD API connector for a data type
bubble-io-cli generate --template api-connector --name Product

# Scaffold a webhook receiver for Bubble data triggers
bubble-io-cli generate --template data-trigger --name OrderCreated --output ./webhooks
```

| Template | Description |
|---|---|
| `plugin-action` | Typed Bubble plugin server-side action scaffold |
| `api-connector` | Full CRUD connector class for a Bubble data type |
| `data-trigger` | HTTP webhook receiver for Bubble data change events |

---

### `completions` — Shell Tab Completion

Generate tab-completion scripts for Bash, Zsh, or Fish.

```bash
# Bash (add to ~/.bashrc)
source <(bubble-io-cli completions --bash)

# Zsh (add to ~/.zshrc)
source <(bubble-io-cli completions --zsh)

# Fish (run once)
bubble-io-cli completions --fish > ~/.config/fish/completions/bubble-io-cli.fish
```

---

## 🏗️ Architecture

```
bubble-io-cli/
├── src/
│   ├── index.ts                   # CLI entry point — registers all commands
│   ├── commands/                  # Thin action handlers (UX only)
│   │   ├── config.ts              # config — credentials & profiles
│   │   ├── backup.ts              # backup — export with full options
│   │   ├── restore.ts             # restore — bulk upload from file
│   │   ├── diff.ts                # diff — compare live vs local
│   │   ├── health.ts              # health — API connectivity check
│   │   ├── schema.ts              # schema list / schema diff
│   │   ├── workflow.ts            # workflow trigger
│   │   ├── seed.ts                # seed — bulk create from fixtures
│   │   ├── mock.ts                # mock — local development server
│   │   ├── plugin.ts              # plugin list / get / deploy
│   │   ├── generate.ts            # generate — scaffold templates
│   │   └── completions.ts         # completions — shell tab completion
│   ├── services/                  # Business logic
│   │   ├── bubble-api.ts          # BubbleApiClient — Data API (CRUD + pagination)
│   │   ├── bubble-meta.ts         # BubbleMetaClient — Meta API (schema)
│   │   └── bubble-plugin.ts       # BubblePluginClient — Plugin Editor API
│   └── utils/                     # Infrastructure helpers
│       ├── storage.ts             # Configstore — config & multi-profile
│       ├── csv.ts                 # CSV serialization (flattenRecord + jsonToCsv)
│       ├── encryption.ts          # AES-256-GCM encrypt/decrypt
│       ├── cloud-upload.ts        # S3 + GCS upload adapters
│       ├── notifications.ts       # Slack + Discord webhook dispatcher
│       └── schema-diff.ts         # Schema diffing engine
└── tests/                         # Vitest unit tests (68 tests)
    ├── bubble-api.test.ts
    ├── storage.test.ts
    ├── csv.test.ts
    ├── restore.test.ts
    ├── encryption.test.ts
    ├── schema-diff.test.ts
    └── notifications.test.ts
```

> **Separation of concerns:** Command files handle only UX (spinners, colors, exit codes). All business logic lives in `services/` and `utils/`.

---

## 🌍 Environment Variables

| Variable | Used by | Description |
|---|---|---|
| `BUBBLE_BACKUP_PASSPHRASE` | `backup --encrypt` | Passphrase for AES-256-GCM backup encryption |
| `BUBBLE_PLUGIN_TOKEN` | `plugin` commands | Bubble Plugin Editor API token |
| `AWS_ACCESS_KEY_ID` | `backup --destination s3://` | AWS credentials for S3 upload |
| `AWS_SECRET_ACCESS_KEY` | `backup --destination s3://` | AWS credentials for S3 upload |
| `AWS_REGION` | `backup --destination s3://` | AWS region for S3 upload |
| `GOOGLE_APPLICATION_CREDENTIALS` | `backup --destination gs://` | GCP service account JSON path |

---

## 🛠️ Development

```bash
# Clone the repository
git clone https://github.com/alexandrmotologa/bubble-io-cli.git
cd bubble-io-cli

# Install dependencies
npm install

# Run in development mode (tsx, no build step)
npm run dev -- config --show

# Build the production bundle
npm run build

# Run tests
npm test

# Type check only
npm run lint
```

---

## 🤝 Contributing

Contributions are warmly welcome! Please follow these steps:

1. **Fork** the repository
2. **Create** a feature branch: `git checkout -b feat/my-new-command`
3. **Commit** your changes: `git commit -m 'feat: add my-new-command'`
4. **Push** to the branch: `git push origin feat/my-new-command`
5. **Open a Pull Request**

Architecture guide: new commands go in `src/commands/`, new API logic in `src/services/`, utility helpers in `src/utils/`. See [docs/architecture.md](docs/architecture.md) for the full design.

---

## 📝 License

Distributed under the **MIT License**. See [LICENSE](LICENSE) for more information.

---

<div align="center">
  Built with ❤️ for the Bubble.io developer community
</div>
