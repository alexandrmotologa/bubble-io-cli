# Changelog

All notable changes to `bubble-io-cli` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.1.0] — 2026-08-07

### Added

#### Slack / Discord Notification Hooks (`backup --notify-slack` / `--notify-discord`)
- `--notify-slack <webhookUrl>` — Send a Slack Incoming Webhook notification on backup completion
  - Rich Block Kit format with app, type, env, records, file, and duration fields
- `--notify-discord <webhookUrl>` — Send a Discord Webhook notification
  - Color-coded Embed (green=success, red=failure)
- `--notify-on-error` — Also notify when backup fails (default: success only)
- Uses Node.js built-in `https`/`http` modules — zero extra dependencies
- `src/utils/notifications.ts` — `sendSlackNotification`, `sendDiscordNotification`, `dispatchNotifications`

#### `schema diff` Sub-Command
- `bubble-io-cli schema diff` — Compare schema between two Bubble environments
- Fetches both environments in parallel for speed
- Color-coded output: `+` green (added), `-` red (removed), `~` yellow (changed)
- Reports: new data types, removed types, field additions, removals, and type changes
- `--json` for CI environment comparison pipelines
- `src/utils/schema-diff.ts` — `diffSchemas()` pure diff engine

#### `schema erd` Sub-Command
- `bubble-io-cli schema erd` — Generate a Mermaid.js Entity-Relationship Diagram (ERD) from your Bubble schema
- Analyzes relationship fields dynamically by checking known data types
- Output directly to terminal or save to a Markdown file (`--output ./erd.md`)
- Renders natively in GitHub, VS Code, and standard markdown tools
- `--include-system-types` flag to include built-in Bubble types (User, FileObject, etc.)
- `src/utils/schema-erd.ts` — `generateErd()` generator logic


#### `mock` Command — Local Mock Server
- `bubble-io-cli mock --file backup.json --port 3333`
- Starts an Express HTTP server compatible with the Bubble Data API format
- Supports full CRUD: `GET /api/1.1/obj/:type`, `GET /:id`, `POST`, `PATCH`, `DELETE`
- Cursor + limit pagination matching Bubble's response envelope
- `--cors` flag for browser-based integration testing
- `--file Type=path` syntax for loading multiple data types
- `/health` endpoint returning store status (types and record counts)
- Graceful `SIGINT`/`SIGTERM` shutdown

#### `plugin` Command Group — Plugin Editor API
- `bubble-io-cli plugin list` — List all plugins for the current Bubble app
- `bubble-io-cli plugin get <pluginId>` — Get full definition of a plugin
- `bubble-io-cli plugin deploy --file plugin.json` — Create or update a plugin
  - `--id <pluginId>` to update an existing plugin
  - `--dry-run` to validate and preview without API calls
- Reads token from `BUBBLE_PLUGIN_TOKEN` env var
- `src/services/bubble-plugin.ts` — `BubblePluginClient` with `listPlugins`, `getPlugin`, `deployPlugin`

#### Tests
- 8 new unit tests for `schema-diff.ts`
- 7 new unit tests for `notifications.ts`
- **Total: 68/68 tests passing**

---

## [2.0.0] — 2026-08-07


### Added

#### `health` Command
- Check API connectivity and credential validity for one or both environments
- `--all` — Test both `version-test` and `version-live` in a single call
- Reports latency (ms) per environment
- `--json` for CI health-check gates (exits with code 1 if any env fails)

#### `schema list` Command
- Fetch all data types and their field definitions via the Bubble Meta API
- `--fields` — Show all fields for every type
- `--type <name>` — Inspect a single data type in detail
- `--json` — Export the full schema as a JSON object
- Helpful 403 error message guiding users to enable the Meta API in app settings

#### `workflow trigger` Command
- Trigger a Bubble backend workflow by its API name
- `--data <json>` — Pass parameters as a JSON object to the workflow
- `--json` for scripted automation and CI pipelines
- 404 guidance for enabling "This workflow can be triggered by API" in Bubble

#### `seed` Command
- Bulk-create records from a local JSON fixture file (`{ "type": "...", "records": [...] }`)
- `--concurrency <number>` — Control throughput (1–20 parallel requests)
- `--dry-run` — Preview without side effects; shows record count and type
- `--json` — Structured output including created IDs and any errors

#### Core Infrastructure
- `BubbleApiClient.triggerWorkflow(name, data)` — POST to Bubble `/wf/<name>` endpoint
- `src/services/bubble-meta.ts` — `BubbleMetaClient` for Bubble Meta API schema introspection

#### Tests
- **Total: 53/53 tests passing**

---

## [1.3.0] — 2026-08-07


### Added

#### Multi-App Profiles (`config` command)
- `--profile <name>` — Save credentials under a named profile (default: `"default"`)
- `--list` — Display all stored profiles with an active indicator (`●`)
- `--use <profile>` — Switch the currently active profile
- `--clear --all` — Wipe all profiles and reset to factory defaults
- All commands implicitly use the active profile; no migration needed for existing users

#### Shell Completions (`completions` command)
- `bubble-io-cli completions --bash` — Bash completion script
- `bubble-io-cli completions --zsh` — Zsh completion script  
- `bubble-io-cli completions --fish` — Fish completion script
- Context-aware suggestions: environment values, format types, restore modes, template names, JSON file paths
- Install with: `source <(bubble-io-cli completions --bash)` in `~/.bashrc`

#### Core
- `StorageManager` extended with: `getActiveProfile()`, `setActiveProfile()`, `listProfiles()`, profile-aware `saveConfig/getConfig/clearConfig`

#### Tests
- 5 new profile unit tests in `storage.test.ts`
- Configstore mock updated to support nested dot-notation objects
- **Total: 53/53 tests passing**

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
