# 🫧 bubble-io-cli

<div align="center">

**A powerful, open-source command-line interface for developers and entrepreneurs who build with Bubble.io.**

[![npm version](https://img.shields.io/npm/v/bubble-io-cli?color=blue&style=flat-square)](https://www.npmjs.com/package/bubble-io-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green?style=flat-square&logo=node.js)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![Build](https://img.shields.io/badge/build-tsup-orange?style=flat-square)](https://tsup.egoist.dev)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](CONTRIBUTING.md)

</div>

---

## ✨ What is bubble-io-cli?

`bubble-io-cli` brings your Bubble.io application to the terminal. Instead of navigating the Bubble dashboard to export data or manage configurations, you can now automate these workflows directly from the command line — making it perfect for **CI/CD pipelines**, **scheduled backups**, **developer tooling**, and **no-code + code hybrid workflows**.

```bash
# Install globally
npm install -g bubble-io-cli

# Configure once
bubble-io-cli config --app my-cool-app --key YOUR_BUBBLE_API_KEY

# Back up any data type instantly
bubble-io-cli backup --type Product --env version-live
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

### `config` — Manage Credentials

Store your Bubble app credentials securely in local OS config storage.

```bash
# Save your credentials
bubble-io-cli config --app my-cool-app --key YOUR_BUBBLE_API_KEY

# View the currently saved configuration (key is masked)
bubble-io-cli config --show

# Remove all stored credentials
bubble-io-cli config --clear
```

| Option | Alias | Description |
|---|---|---|
| `--app <name>` | `-a` | Your Bubble app subdomain (e.g. `my-cool-app`) |
| `--key <apiKey>` | `-k` | Your private Bubble API key |
| `--show` | | Display the currently saved configuration |
| `--clear` | | Remove all stored credentials |

---

### `backup` — Export Data

Download records from any Bubble data type and save them as a local JSON file. By default, **cursor-based pagination** is used automatically to fetch every record regardless of count. Use `--limit` to cap the number of rows fetched — ideal for testing or previewing data before a full export.

```bash
# Backup from the test environment (default)
bubble-io-cli backup --type Product

# Backup from production (version-live)
bubble-io-cli backup --type User --env version-live

# Backup to a specific output directory
bubble-io-cli backup --type Order --env version-live --output ./exports

# Preview the first 100 rows only (partial export)
bubble-io-cli backup --type Product --limit 100

# Partial export from production into a specific folder
bubble-io-cli backup --type User --env version-live --limit 50 --output ./exports
```

| Option | Alias | Description | Default |
|---|---|---|---|
| `--type <datatype>` | `-t` | Bubble data type name (**required**) | — |
| `--env <environment>` | `-e` | `version-test` or `version-live` | `version-test` |
| `--output <dir>` | `-o` | Output directory for the JSON file | `.` |
| `--limit <number>` | `-l` | Maximum number of records to fetch (omit to fetch all) | — |

**Output format (full export):**

```json
{
  "meta": {
    "app": "my-cool-app",
    "environment": "version-live",
    "dataType": "Product",
    "exportedAt": "2026-01-15T10:30:00.000Z",
    "totalRecords": 1234
  },
  "data": [ ... ]
}
```

**Output format (partial export with `--limit`):**

```json
{
  "meta": {
    "app": "my-cool-app",
    "environment": "version-test",
    "dataType": "Product",
    "exportedAt": "2026-01-15T10:30:00.000Z",
    "totalRecords": 100,
    "limitedTo": 100
  },
  "data": [ ... ]
}
```

> **Note:** When `limitedTo` is present in `meta`, the export is partial. The `totalRecords` field reflects the actual number of rows fetched, not the total available in Bubble.

---

### `generate` — Scaffold Templates

Generate boilerplate TypeScript files for common Bubble integration patterns.

```bash
# List all available templates
bubble-io-cli generate --list

# Scaffold a Bubble plugin server-side action
bubble-io-cli generate --template plugin-action --name SendEmail

# Scaffold an API Connector helper class for a data type
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

## 🏗️ Architecture

```
bubble-io-cli/
├── src/
│   ├── index.ts              # CLI entry point (Commander setup)
│   ├── commands/             # Command definitions (thin action handlers)
│   │   ├── config.ts         # bubble-io-cli config
│   │   ├── backup.ts         # bubble-io-cli backup
│   │   └── generate.ts       # bubble-io-cli generate
│   ├── services/
│   │   └── bubble-api.ts     # BubbleApiClient (Axios, pagination)
│   └── utils/
│       └── storage.ts        # Configstore + file I/O helpers
└── tests/
    ├── bubble-api.test.ts
    └── storage.test.ts
```

> **Separation of concerns:** Command files handle only UX (spinners, colors, exit codes). All business logic lives in `services/` and `utils/`.

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

Please keep the existing architecture clean: new commands go in `src/commands/`, new API logic goes in `src/services/`, and utility helpers go in `src/utils/`.

---

## 📝 License

Distributed under the **MIT License**. See [LICENSE](LICENSE) for more information.

---

<div align="center">
  Built with ❤️ for the Bubble.io developer community
</div>
