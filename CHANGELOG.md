# Changelog

All notable changes to `bubble-io-cli` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [4.1.0] — 2026-08-08

### Added

#### `seed` — Relational Data Import (Graph / Smart Seed)

- **Relational format for `bubble-io-cli seed`** — A new JSON format that lets users import entire interconnected relational datasets in a single command, with automatic dependency resolution.

- **`_ref` / `@alias` system:**
  - `"_ref": "@alias"` assigns a temporary local alias to a record. The alias is never sent to Bubble.
  - Any field value starting with `@` (e.g. `"Category": "@cat_tech"`) is treated as a cross-reference and replaced at runtime with the real Bubble `_id` of the aliased record.
  - Arrays of references fully supported: `"Sizes": ["@size_14", "@size_16"]`.

- **Graph Resolution Engine** — `src/utils/graph-resolver.ts`
  - Builds a Directed Acyclic Graph (DAG) from the seed document.
  - `resolveGraph(doc)` — validates all `_ref`/`@ref` pairs, detects cycles, returns a topologically sorted execution queue + deferred patch list.
  - `substituteRefs(value, idMap)` — recursively replaces `@alias` strings/arrays/objects with real Bubble IDs.
  - Validation: fails fast with a clear message for duplicate `_ref` aliases or unknown `@ref` targets.

- **Relational Seeder Engine** — `src/utils/relational-seeder.ts`
  - `runRelationalSeed(opts)` — orchestrates the full import lifecycle: resolve graph → create in order → maintain ID map → execute deferred patches.
  - `isRelationalDoc(parsed)` — detects whether a JSON file is the new relational format vs. the legacy single-type format; used by `seed` command for transparent auto-routing.
  - `printRelationalSummary(result)` — renders a formatted per-type breakdown after import.

- **Capabilities:**

  | Scenario | Behavior |
  |---|---|
  | N-level deep dependencies (A→B→C→…→N) | ✅ Unlimited depth via Kahn's topological sort |
  | Array / List-of-references fields | ✅ `["@ref1", "@ref2"]` fully substituted |
  | Self-referencing hierarchies (e.g. Category tree) | ✅ Individual record-level graph nodes |
  | Circular dependencies (A↔B) | ✅ 2-pass: Create without circular field + deferred PATCH |
  | Unknown `@ref` alias | ✅ Fails fast with clear error before any API calls |
  | Duplicate `_ref` aliases | ✅ Fails fast with clear error before any API calls |
  | Atomic rollback on error | ✅ Reverse deletion of created records via `--rollback-on-error` |

- **`--rollback-on-error` flag** — When enabled, any failure during record creation or deferred patching triggers an automatic reverse cleanup: all records created during the session are deleted via Bubble's DELETE endpoint to prevent orphaned/dirty states.
- **`--dry-run` in relational mode** — Prints the full creation order, which records are being created, and which deferred PATCH operations will be issued for circular references. Zero API calls made.

- **`--json` output** in relational mode returns `{ success, format: "relational", totalCreated, totalPatched, byType, idMap, errors }`.

- **Backward compatibility** — Fully maintained. The legacy `{ "type": "...", "records": [...] }` format continues to work without any changes. Format is auto-detected.

- **Example file** — `examples/relational-seed.json` with a 4-level (Category → Product → Size → Price) dataset demonstrating circular link resolution.

### Changed

- `src/commands/seed.ts` — Extended to auto-detect format and route to `RelationalSeeder` for relational docs; legacy path unchanged.

---

## [4.0.0] — 2026-08-08


### Added

#### `generate ci` — GitHub Actions CI/CD Workflow Generator

- **`bubble-io-cli generate ci --provider github`** — Generates a production-ready `.github/workflows/bubble-backup.yml` file in a single command. No manual YAML editing required.
  - **Nightly cron schedule** — Configurable via `--cron` (default: `0 3 * * *`, 3:00 AM UTC)
  - **`workflow_dispatch`** support for on-demand manual runs from the GitHub Actions tab
  - **npm install step** — Installs `bubble-io-cli` from npm; version can be pinned with `--cli-version`
  - **Secure credential handling** — Reads `BUBBLE_APP_NAME` and `BUBBLE_API_KEY` from GitHub Secrets; printed reminder in terminal output
  - **GitHub Actions Artifact upload** — Backup saved as a named artifact with configurable `--retention` days (1–90, default 30)
  - **Job summary** — Writes a rich Markdown table to `$GITHUB_STEP_SUMMARY` visible in the GitHub Actions UI
  - **JSON validation** — Runs `bubble-io-cli backup --json` and validates the result before uploading
  - Options: `--type`, `--env`, `--cron`, `--retention`, `--format` (`json`|`csv`), `--cli-version`, `--output`
- New module: `src/utils/ci-generators/github-actions.ts`
  - `generateGitHubActionsWorkflow(opts: GitHubActionsOptions): string` — pure function, zero side-effects, fully testable
  - `formatCronHuman(cron: string): string` — helper that converts cron expressions to human-readable descriptions

#### `export db` — Direct Database Export

- **`bubble-io-cli export db --type <T> --target <provider>`** — Exports records from any Bubble data type directly into an external database. Supports three providers:

  **SQLite** (`--target sqlite`):
  - Uses `sql.js` (pure JavaScript WebAssembly port — zero native compilation, zero build tools required)
  - `--db <path>` flag specifies the output `.db` file (default: `./bubble.db`)
  - WAL-mode pragma enabled for consistency; database persisted to disk on `disconnect()`
  - Transactional batch inserts (`BEGIN TRANSACTION … COMMIT`) for maximum throughput
  - Schema inferred from the first record; new columns added via `ALTER TABLE ADD COLUMN`
  - `INSERT OR REPLACE` upsert semantics — idempotent re-runs produce no duplicates

  **PostgreSQL** (`--target postgres`):
  - Uses the `pg` package via dynamic import (optional `peerDependency` — install with `npm install pg`)
  - `--connection-string <url>` accepts standard PostgreSQL connection strings
  - Column types: `JSONB` for objects/arrays, `TIMESTAMPTZ` for ISO 8601 date strings, `BIGINT`/`DOUBLE PRECISION` for numbers, `TEXT` otherwise
  - `ON CONFLICT DO UPDATE SET` upsert in a single transaction; rolled back on error
  - Connection string password masked in terminal output (`***`)

  **BigQuery** (`--target bigquery`):
  - Uses `@google-cloud/bigquery` via dynamic import (optional `peerDependency`)
  - `--project <id>` and `--dataset <id>` (default: `bubble_data`) required
  - `--key-file <path>` for service account auth; defaults to Application Default Credentials (ADC)
  - Auto-creates dataset (US region) and table if they do not exist
  - Schema evolution: compares existing metadata and patches new fields
  - Streaming inserts in batches of 500 (BigQuery limit); `_id` used as `insertId` for deduplication
  - Table names prefixed with `bubble_` to avoid conflicts with existing BQ assets

- **Provider pattern architecture:**
  - `DbProvider` interface: `connect()`, `upsertTable(typeName, records)`, `disconnect()`
  - `getDbProvider(opts: DbProviderOptions): Promise<DbProvider>` factory with dynamic imports
  - Heavy dependencies (`pg`, `@google-cloud/bigquery`) never bundled unless the user installs them; missing package errors include clear install instructions

- New files:
  - `src/services/db-providers/index.ts` — `DbProvider` interface, option types, factory
  - `src/services/db-providers/sqlite.ts` — sql.js provider
  - `src/services/db-providers/postgres.ts` — pg provider
  - `src/services/db-providers/bigquery.ts` — BigQuery provider
  - `src/commands/export.ts` — `export db` command (3-step orchestration: fetch → connect → upsert)

### Changed

- **`package.json` version** bumped to `4.0.0`
- **`src/index.ts`** — registered `registerExportCommand(program)` alongside existing commands
- **`generate` command** — extended to include `generate ci` sub-command alongside existing `generate types` and scaffold templates
- **Dependencies:**
  - `sql.js@^1.12.0` added to `dependencies` (included in the published bundle)
  - `pg >= 8.0.0` declared as optional `peerDependency`
  - `@google-cloud/bigquery >= 7.0.0` declared as optional `peerDependency`
  - `@types/pg@^8.11.0` and `@types/sql.js@^1.4.0` added to `devDependencies`
- **Keywords** in `package.json` extended: `ci-cd`, `github-actions`, `database`, `sqlite`, `postgresql`, `bigquery`

---

## [3.3.1] — 2026-08-08

### Added

#### `diff` — Performance & Usability Improvements

- **`--local-only` flag** — New smart fetch mode for the `diff` command. Instead of downloading the entire remote table (which is slow and capacity-expensive for large databases), this flag extracts the `_id` values from the local backup file and queries Bubble only for those specific records, using the Data API `in` constraint. IDs are sent in chunks of 50 to respect URL length limits. This reduces a 500-request paginated scan to a single API call for a 10-record backup.
  - Trade-off: cannot detect records *added* to Bubble after the backup was taken (only detects modifications and deletions of backed-up records).
- **`--limit <number>` flag** — Caps the number of records fetched from the remote during a `diff`. Useful for spot-checking large tables without downloading everything.
- **Mutual exclusion validation** — The CLI now exits early with a clear error message if both `--local-only` and `--limit` are provided together.
- **Mode info header** — When `--local-only` or `--limit` is active, a descriptive info line is printed before the spinner to inform the user of the current fetch mode.

### Changed

- **`diff` summary output** — The `+ N added` line is hidden when running with `--local-only` since new-record detection is not possible in that mode.

### Fixed

- **`workflow trigger`** — Added support for reading JSON payloads from a file using the `@` prefix in the `--data` flag (e.g. `--data @payload.json`). This resolves parsing issues when passing complex JSON inline via CLI on Windows shells (PowerShell/CMD) which often strip quotes unexpectedly.

### Documentation

- **`README.md`** — Updated `diff` command section with new options, examples (`--local-only`, `--limit`, combined with `--summary`), and trade-off notes.
- **`docs/architecture.md`** — Added two new Command Flow diagrams (`diff` full fetch and `diff --local-only` smart fetch), updated `BubbleApiClient` method table to reflect the `constraints` parameter and the `deleteRecord` method.

---

## [3.3.0] — 2026-08-08

### Added

#### CLI Plugin Extensibility System
- **`src/utils/plugin-loader.ts`** — New plugin discovery and registration engine (zero new dependencies, uses Node stdlib only)
- **`BubbleCLIPlugin` interface** — Public contract for third-party CLI extensions:
  - `name: string` — unique plugin identifier
  - `version?: string` — optional semver version
  - `description?: string` — optional one-line description
  - `register(program: Command): void` — called at startup with the root Commander instance
- **Discovery mechanism** — scans three sources in priority order:
  1. `$CWD/.bubble-cli/plugins/*.js` — project-scoped plugins (committed to repo)
  2. `$HOME/.bubble-cli/plugins/*.js` — user-global plugins
  3. `npm root -g / bubble-io-cli-plugin-*` — globally installed npm packages
- **Error isolation** — a broken plugin (throws during load or `register()`) is caught and reported without crashing the CLI or blocking other plugins
- **ESM interop** — supports both `module.exports = plugin` and `module.exports.default = plugin`
- **Deduplication** — the same resolved path is only loaded once, even if it appears in multiple discovery sources

#### `plugin ext` — New sub-command group
- `bubble-io-cli plugin ext list [--json]` — lists all discovered CLI extension plugins (name, version, source path, load status)
- `bubble-io-cli plugin ext info <name> [--json]` — shows details about a specific loaded plugin
- `bubble-io-cli plugin ext reload [--json]` — forces a fresh plugin discovery and reloads all extensions

#### Public API Export
- **`bubble-io-cli/plugin`** — new package export path exposing the `BubbleCLIPlugin` interface for TypeScript plugin authors

#### Documentation
- **`docs/PLUGIN_AUTHORING.md`** — comprehensive plugin authoring guide including:
  - Quick-start tutorial (local `.js` plugin)
  - TypeScript template with full type safety
  - npm publishing guide (`bubble-io-cli-plugin-*` naming convention)
  - Available Commander patterns (top-level commands, sub-command groups, credential access)
  - Discovery rules table
  - Best practices
  - Two full working examples

### Changed
- **`src/index.ts`** — CLI startup now calls `loadPlugins(program)` before `parseAsync()`, wrapped in an async IIFE for CommonJS compatibility
- **`package.json`** — version bumped to `3.3.0`, `exports` field added, `extensible-cli` and `plugins` keywords added

### Infrastructure
- **`BubbleApiClient` constructor** — added optional 4th parameter `httpClient?: AxiosInstance` for dependency injection (enables test isolation without module-level mocking)
- **`vitest.config.mjs`** — pool switched from `forks` to `vmForks` to resolve Node 24.12.0 + Vitest 4.x IPC bootstrapping failure
- **`axios`** — pinned to `^1.7.0` (ESM-only axios 1.19+ was incompatible with vitest module mocking in vmForks)
- **Tests** — 15 new tests for `plugin-loader.ts` (240 total, 13 test files, all passing)

---

## [3.2.0] — 2026-08-07

### Added

#### `audit privacy` — PII & Privacy Security Audit Scanner
- `bubble-io-cli audit privacy` — Scan your Bubble schema or a local backup file for potentially exposed Personally Identifiable Information (PII) and security risks
- **Dual scan modes:**
  - **Remote schema** — Fetches live schema via the Bubble Meta API and inspects all data type field names
  - **Local file** — Parses a `bubble-io-cli backup` JSON file and reconstructs field names from record keys
- **8 PII detection categories** across 3 risk levels:
  - 🔴 `CRITICAL` — Credentials (`password`, `token`, `api_key`, `secret`, `ssn`, `credit_card`, …)
  - 🟠 `HIGH` — Contact PII (`email`, `phone`, `address`, `dob`), Government IDs (`passport`, `national_id`), Medical (`diagnosis`, `patient`), Biometric (`fingerprint`, `face_id`)
  - 🟡 `MEDIUM` — Geolocation (`gps`, `latitude`, `longitude`), Demographics (`full_name`, `salary`, `gender`)
- **Case-insensitive + compound matching** — `EMAIL`, `User_Email_Address`, `customer_email` all detected
- **First-match-wins deduplication** — one finding per field, highest risk wins
- **Rich terminal report** — color-coded findings with per-finding reasons and Bubble Privacy Rule recommendations
- **CI-friendly exit codes** — exits with code `1` when CRITICAL findings are detected (usable in GitHub Actions)
- `--file <path>` — Scan a local backup JSON file
- `--env <env>` — Target environment for remote schema scan (default: `version-test`)
- `--type <name>` — Limit scan to a single data type
- `--min-risk MEDIUM|HIGH|CRITICAL` — Filter output by minimum severity (default: `MEDIUM`)
- `--json` — Machine-readable JSON output for automated pipelines
- `--profile <name>` — Named credential profile
- `src/utils/pii-scanner.ts` — Pure, deterministic PII detection engine
  - `scanTypes()`, `scanSchema()`, `scanBackupFile()` — all exported and fully tested
  - `PII_PATTERNS` — exported pattern dictionary for extensibility and testing

#### Infrastructure
- **Vitest upgraded** `^1.0.0` → `^4.0.0` — Full Node.js v24 compatibility
- **`vitest.config.mjs`** — ESM config to resolve CJS deprecation and TypeScript source paths
- **`tests/storage.test.ts`** — Fixed `Configstore` mock to use a proper class constructor (Vitest 4 breaking change)

#### Tests
- 40 new unit tests for `pii-scanner.ts`
- **Total: 226/226 tests passing** (12 test files)

---

## [3.1.0] — 2026-08-07

### Added

#### `query` — Interactive REPL / Query Mode
- `bubble-io-cli query` — Start a fully interactive terminal session for searching and browsing Bubble records
- **Type selection menu** — Numbered list of all data types fetched live from the Meta API
- **Quick text search** — Instant `text contains` filter on the first text field of the selected type
- **Structured constraints** — Interactive field + operator + value selection with 7 supported operators: `equals`, `not equal`, `text contains`, `greater than`, `less than`, `is_empty`, `is_not_empty`
- **Formatted table rendering** — Uses `cli-table3` to display records in aligned, color-coded columns with column priority (`_id` first, date fields last, auto-truncation at 30 chars)
- **Pagination** — Next/Previous page navigation with cursor-based offset (`n` / `p` actions)
- **Export** — `e` action exports the current page to a timestamped `query-export-<Type>-<timestamp>.json` file
- **Filter management** — `x` to clear all filters, `r` to refine, `t` to change type
- **Graceful exit** — `q` or `Ctrl+C` prints a goodbye message and exits cleanly
- `--env <environment>` — Target `version-test` or `version-live`
- `--profile <name>` — Named credential profile
- `--page-size <n>` — Records per page (default: 20, max: 100)

#### Core Infrastructure
- `src/utils/table-renderer.ts` — Pure table rendering utility
  - `buildTableHeaders()`, `renderTable()`, `truncateCell()`, `formatCellValue()` — all exported and tested
- `src/utils/query-session.ts` — Immutable REPL session state machine
  - `createSession()`, `buildConstraints()`, `paginationInfo()`, `applyPageResult()`, `resetFilters()`, `nextPage()`, `prevPage()`, `currentCursor()`

#### Tests
- 59 new unit tests (25 for `table-renderer`, 34 for `query-session`)
- **Total: 186/186 tests passing** (11 test files)

#### New Dependency
- `cli-table3@^0.6.3` — Bordered terminal table renderer (includes built-in TypeScript types)

---

## [3.0.0] — 2026-08-07


### Added

#### `generate types` — TypeScript Interface Generator
- `bubble-io-cli generate types` — Fetch the live Bubble schema and emit clean TypeScript interface definitions
- Inspects all data types via the Bubble Meta API and maps each field to its TypeScript equivalent
- **Full Bubble → TypeScript type mapping:**
  - `text` → `string`, `number` → `number`, `boolean` → `boolean`
  - `date` → `string` (ISO 8601 string, as returned by the Bubble Data API)
  - `geographic address` → `BubbleGeographicAddress` (helper interface auto-emitted)
  - `file`, `image`, `option` → `string`
  - `list of text/number/date/boolean/file/image` → `string[]`, `number[]`, `string[]`, `boolean[]`, `string[]`, `string[]`
  - `list of <CustomType>` → `string[]` (Bubble stores list-of-thing as ID arrays)
  - Custom data type references → `string` (Bubble stores relationships as ID strings)
- **System fields** automatically injected in every interface: `_id`, `Creation Date`, `Modified Date`
- **All user-defined fields are optional** (`?`) — Bubble may omit unfilled fields in API responses
- **Quoted property names** for fields with spaces: `'My Field'?: string` (valid TypeScript)
- **JSDoc comments** on every field showing the original Bubble type, with "relationship → stored as Bubble ID" for reference fields
- `--type <name>` — Generate only a single interface (case-insensitive match)
- `--output <file>` — Write to a `.d.ts` / `.ts` file; omit for stdout preview
- `--env <environment>` — Target environment (default: `version-test`)
- `--profile <name>` — Named profile support

#### Core Infrastructure
- `src/utils/type-generator.ts` — New pure utility: `bubbleTypeToTs()`, `generateInterface()`, `generateTypeFile()`
  - Zero side-effects, fully deterministic output
  - Exports `BUBBLE_TYPE_MAP` constant for reuse and testing

#### Tests
- 38 new unit tests for `type-generator.ts`
- **Total: 127/127 tests passing**

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
