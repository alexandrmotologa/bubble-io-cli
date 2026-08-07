# Changelog

All notable changes to `bubble-io-cli` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.1] — 2026-08-07

### Added
- **`backup --limit <number>` / `-l`** — Optional cap on the number of records fetched.
  - When omitted, behavior is unchanged (full pagination, all records exported).
  - When provided, fetching stops as soon as the cap is reached.
  - The API page size is automatically trimmed to never over-fetch (e.g. `--limit 25` sends `?limit=25` instead of `?limit=100`).
  - The exported JSON `meta` envelope now includes a `limitedTo` field when a limit is active.
  - Terminal output shows a `Limit` line with a `(partial export)` indicator when limited.

### Changed
- `BubbleApiClient.getAllRecords()` now accepts an optional `maxRecords?: number` second parameter.

---

## [1.0.0] — 2026-08-07


### 🎉 Initial Release

This is the first public release of `bubble-io-cli`, an open-source TypeScript CLI for interacting with Bubble.io applications via the Data API.

### Added

#### Commands
- **`bubble-io-cli config`** — Store and manage Bubble.io API credentials locally
  - `--app <name>` — Set the Bubble app subdomain
  - `--key <apiKey>` — Set the private API key
  - `--show` — Display saved configuration (with masked API key)
  - `--clear` — Remove all stored credentials

- **`bubble-io-cli backup`** — Export all records from a Bubble data type to a local JSON file
  - `--type <datatype>` — Target data type (e.g. `User`, `Product`, `Order`)
  - `--env <environment>` — Target environment (`version-test` or `version-live`)
  - `--output <dir>` — Output directory for the generated backup file
  - Automatic cursor-based pagination (fetches all records regardless of count)
  - Structured JSON output with metadata envelope (`meta` + `data`)

- **`bubble-io-cli generate`** — Scaffold TypeScript integration templates
  - `--template plugin-action` — Bubble plugin server-side action scaffold
  - `--template api-connector` — Full CRUD connector class for a Bubble data type
  - `--template data-trigger` — HTTP webhook receiver for Bubble data change events
  - `--list` — Display all available templates

#### Core Infrastructure
- **`BubbleApiClient`** (`src/services/bubble-api.ts`) — Axios-based HTTP client with:
  - Bearer token authentication
  - Response interceptor with human-readable error messages
  - Cursor-based pagination via `getAllRecords()`
  - 30-second request timeout
  - Connectivity `ping()` method

- **`StorageManager`** (`src/utils/storage.ts`) — Configstore wrapper with:
  - Typed `saveConfig()` / `getConfig()` API
  - Secure local OS config storage
  - `saveJsonFile()` / `readJsonFile()` for export operations

#### Developer Experience
- Full TypeScript strict-mode codebase
- `tsup` build pipeline (CommonJS output + `.d.ts` declarations)
- `tsx` for zero-build-step development
- Vitest unit tests for `BubbleApiClient` and `StorageManager`
- `chalk` colored terminal output throughout
- `ora` loading spinners for all async operations

#### Documentation
- Professional `README.md` with badges, usage examples, and command reference
- `docs/architecture.md` — Internal design and command flow
- `docs/roadmap.md` — Planned features and milestone timeline
- `CHANGELOG.md` (this file)

---

## [Unreleased]

See [docs/roadmap.md](docs/roadmap.md) for planned features.
