# Changelog

All notable changes to `bubble-io-cli` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.2.0] — 2026-08-07

### Added

#### Backup — Workflow Automation
- **`--json`** — Machine-readable JSON output mode for all backup operations
  - Suppresses all chalk colors, ora spinners, and human-readable formatting
  - Prints a single JSON object to stdout: `{ success, file, records, type, env, format, timestamp }`
  - On error: `{ success: false, error: "<message>" }`
  - Designed for use in GitHub Actions, GitLab CI, shell scripts, and cron jobs

- **`--watch` + `--interval <seconds>`** — Continuous backup mode
  - Runs a full backup cycle at the specified interval (minimum 10 seconds)
  - Graceful Ctrl+C / SIGINT handling — prints a stop message and exits cleanly
  - Works with `--json` for structured log output in automated pipelines
  - Each cycle logs the output file path and next-run countdown

- **`--destination <url>`** — Cloud upload after export
  - `s3://bucket-name/path` — Upload to Amazon S3 (requires `npm install @aws-sdk/client-s3`)
  - `gs://bucket-name/path` — Upload to Google Cloud Storage (requires `npm install @google-cloud/storage`)
  - SDKs are loaded lazily — a clear error message guides installation if missing
  - Appends the backup filename to the destination path automatically

- **`--encrypt`** — AES-256-GCM encryption for backup files
  - Reads passphrase from `BUBBLE_BACKUP_PASSPHRASE` environment variable (never from CLI args)
  - Output file uses `.enc` extension
  - Format: `base64(IV[16] | AuthTag[16] | CipherText[N])`
  - Key derived from passphrase using `scrypt`

#### New Utilities
- **`src/utils/encryption.ts`** — `encrypt(data, passphrase)` / `decrypt(data, passphrase)` using Node.js built-in `crypto` (no external dependencies)
- **`src/utils/cloud-upload.ts`** — `uploadToCloud(localPath, destination)` routing to S3 or GCS adapters

#### Tests
- 8 new unit tests for `encryption.ts` (round-trip, random IV, wrong passphrase rejection, tampered payload, edge cases)
- **Total: 48/48 tests passing**

---

## [1.1.0] — 2026-08-07


### Added

#### Commands
- **`bubble-io-cli restore`** — Bulk-upload records from a backup JSON file back to Bubble
  - `--file <path>` — Path to the backup JSON file (**required**)
  - `--mode create|upsert` — Create new records only, or create + update by `_id` (default: `create`)
  - `--env <environment>` — Target environment
  - `--type <datatype>` — Override the data type from the backup file
  - `--concurrency <number>` — Number of parallel API requests (default: 5, max: 20)
  - `--dry-run` — Simulate the restore without making any API calls
  - Strips read-only Bubble fields (`_id`, `Created Date`, `Modified Date`) before writing
  - Progress spinner with per-record counter and error summary

- **`bubble-io-cli diff`** — Compare live Bubble data against a local backup
  - `--file <path>` — Local backup file to compare against (**required**)
  - `--type <datatype>` — Override the data type
  - `--env <environment>` — Target environment
  - `--fields <list>` — Comma-separated field names to compare (default: all non-timestamp fields)
  - `--summary` — Show only counts, not full record details
  - Reports added, removed, and modified records with field-level `old → new` values

#### Backup Enhancements
- **`--format <type>` / `-f`** — Output format: `json` (default) or `csv`
  - CSV output uses RFC 4180 escaping and dot-notation flattening for nested fields
  - Header row is built from the union of all field names across all records
- **`--constraint <json>` / `-c`** — Server-side filtering using Bubble's `constraints` query parameter
  - Accepts a JSON array of constraint objects: `[{"key":"status","constraint_type":"equals","value":"active"}]`
- **`--since <date>`** — Export only records modified after a given ISO 8601 date
  - Automatically adds a `Modified Date > <date>` constraint to the API request
  - `since` field included in the backup JSON `meta` envelope

#### Core Infrastructure
- **`BubbleApiClient.createRecord(type, data)`** — POST a new record to the Bubble Data API
- **`BubbleApiClient.updateRecord(type, id, data)`** — PATCH an existing record by ID
- **`BubbleApiClient.deleteRecord(type, id)`** — DELETE a record by ID
- **`BubbleApiClient.getAllRecords()`** now accepts an optional `constraints` parameter
- **`BubbleApiClient.getDataType()`** now accepts an optional `constraints` parameter
- **`src/utils/csv.ts`** — New CSV utility: `flattenRecord()` + `jsonToCsv()`

#### Tests
- 15 new unit tests for `csv.ts` (`flattenRecord` + `jsonToCsv`)
- 5 new unit tests for CRUD methods and constraint passing in `BubbleApiClient`
- **Total: 40/40 tests passing**

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
