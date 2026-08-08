# Roadmap — bubble-io-cli

This document outlines the planned features and improvements for future versions of `bubble-io-cli`. Items are grouped by milestone. Contributions and feedback are welcome — open an issue to discuss ideas.

---

## ✅ v1.0.0 — Foundation (Shipped)

- [x] `config` command — local credential management (set, show, clear)
- [x] `backup` command — full data export with cursor pagination to JSON
- [x] `generate` command — scaffold plugin-action, api-connector, data-trigger
- [x] Automatic cursor-based pagination for all data types
- [x] `ora` spinners for async feedback
- [x] `chalk` colored output with masked API key display
- [x] Vitest unit tests for core services and utilities
- [x] MIT open-source license

---

## ✅ v1.0.1 — Record Limit (Shipped)

- [x] **`backup --limit <number>` / `-l`** — Optional cap on records fetched per export
  - Smart page-size trimming: `--limit 25` sends `?limit=25` to the API (no over-fetching)
  - `limitedTo` field added to the JSON `meta` envelope for partial exports
  - Spinner text and terminal output adapt to indicate a partial vs. full export
  - Input validation with a clear error message for non-positive values
  - 3 additional unit tests covering cap boundary, page-size trimming, and unlimited mode

---

## ✅ v1.1.0 — Data Enhancements (Shipped)

- [x] **Restore command** (`bubble-io-cli restore --file backup-user-*.json`) — bulk-upload records back to Bubble via the Data API
- [x] **Diff command** (`bubble-io-cli diff --type Product`) — compare remote data against a local backup and show what changed
- [x] **Backup filtering** — `--constraint` option for server-side filtering (wraps Bubble's `constraints` query parameter)
- [x] **CSV export** — `--format csv` option for spreadsheet-friendly output
- [x] **Incremental backups** — `--since <date>` option tracks `Modified Date` to export only recently changed records

---

## ✅ v1.2.0 — Workflow Automation (Shipped)

- [x] **`backup --json`** — Machine-readable JSON output (suppresses chalk/ora) for CI/CD scripts and GitHub Actions
- [x] **`backup --watch --interval <seconds>`** — Continuously back up at a configurable interval with graceful Ctrl+C stop
- [x] **`backup --destination s3://` / `gs://`** — Upload exports directly to Amazon S3 or Google Cloud Storage (lazy-loaded SDKs)
- [x] **`backup --encrypt`** — AES-256-GCM encryption for local backup files (passphrase via `BUBBLE_BACKUP_PASSPHRASE` env var)

---

## ✅ v1.3.0 — Developer Experience (Shipped)

- [x] **Multi-app profiles** (`bubble-io-cli config --profile staging`) — store and switch credentials for multiple Bubble apps
  - `--list` to see all profiles with active indicator
  - `--use <profile>` to switch the active profile
  - `--clear --all` to wipe all profiles
- [x] **Shell completions** (`bubble-io-cli completions`) — Bash, Zsh, and Fish tab-completion scripts
  - Context-aware: suggests env values, format types, file paths, template names
  - Install with: `source <(bubble-io-cli completions --bash)`

---

## ✅ v2.0.0 — Extended Platform Support (Shipped)

- [x] **`health` command** — Check API connectivity, validate credentials, report latency per environment
  - `--all` to test both version-test and version-live in one call
  - `--json` for CI health-check gates
- [x] **`schema list` command** — List all data types and their fields using the Bubble Meta API
  - `--fields` for full field listing, `--type <name>` to inspect a single type
  - `--json` to export schema as machine-readable JSON
- [x] **`workflow trigger` command** — Call Bubble backend workflows via API
  - `--data <json>` to pass parameters to the workflow
  - `--json` for scripted workflow automation
- [x] **`seed` command** — Bulk-create records from a local JSON fixture file
  - Configurable `--concurrency` for throughput tuning
  - `--dry-run` to preview without side effects
  - `--json` for CI pipeline integration
- [x] **`BubbleApiClient.triggerWorkflow()`** — POST to Bubble /wf/ endpoint
- [x] **`BubbleMetaClient`** (`src/services/bubble-meta.ts`) — Meta API client for schema introspection

---

## ✅ v2.1.0 — Community Features (Shipped)

- [x] **Slack / Discord notification hooks** (`--notify-slack <url>` / `--notify-discord <url>`) on backup completion
  - Rich Block Kit format for Slack, Embeds with color status for Discord
  - `--notify-on-error` to also notify on failure
  - Uses Node.js built-in `https` module — no extra dependencies
- [x] **Visual schema diff** (`bubble-io-cli schema diff`) between two environments
  - Color-coded: green=added, red=removed, yellow=changed (field-level)
  - `--json` for CI environment comparison
- [x] **Schema Entity-Relationship Diagram** (`bubble-io-cli schema erd`)
  - Generates Mermaid.js diagrams directly from your Bubble schema
  - Analyzes relationship fields to link data types together
  - `--output` flag to save directly as markdown files for GitHub/VS Code rendering
- [x] **Local mock server** (`bubble-io-cli mock --file backup.json --port 3333`)
  - Full CRUD endpoints compatible with the Bubble Data API format
  - Cursor + limit pagination, optional CORS, multi-type loading
  - `/health` endpoint for integration test probes
- [x] **Plugin Editor API** (`bubble-io-cli plugin list` / `plugin get` / `plugin deploy`)
  - List, inspect, and deploy Bubble plugins via the Plugin Editor API
  - `--dry-run` for safe deploy preview
  - Reads token from `BUBBLE_PLUGIN_TOKEN` env var

---

## ✅ v3.0.0 — TypeScript Type Safety (Shipped)

- [x] **`generate types` command** — Automatically generate TypeScript interfaces from your live Bubble schema
  - Fetches data types via the Bubble Meta API and maps each field to its TypeScript equivalent
  - **Full type mapping:** `text` → `string`, `number` → `number`, `boolean` → `boolean`, `date` → `string`, `geographic address` → `BubbleGeographicAddress`, `file`/`image`/`option` → `string`, list variants → `T[]`, relationship fields → `string` (ID)
  - **System fields** (`_id`, `Creation Date`, `Modified Date`) injected automatically in every interface
  - **All user-defined fields are optional** (`?`) — matches Bubble API behaviour
  - **Quoted property names** for fields with spaces (`'My Field'?: string`)
  - **JSDoc** comments on every field showing the original Bubble type and relationship annotation
  - `--type <name>` — single interface mode (case-insensitive)
  - `--output <file>` — write to `.d.ts` / `.ts` file; omit for stdout preview
  - `--env <environment>` — target environment support
  - `--profile <name>` — multi-profile support
- [x] `src/utils/type-generator.ts` — New pure, dependency-free utility module
  - `bubbleTypeToTs()`, `generateInterface()`, `generateTypeFile()` — all exported and fully tested
  - 38 new unit tests → **127 total tests passing**

---

## ✅ v3.1.0 — Interactive REPL / Query Mode (Shipped)

- [x] **`query` command** — Fully interactive terminal session for searching and browsing Bubble records
  - **Type selection menu** — Numbered list of all data types fetched live from the Meta API
  - **Quick text search** — Instant `text contains` filter on the first text field of the selected type
  - **Structured constraints** — Interactive field + operator + value selection (7 operators: `equals`, `not equal`, `text contains`, `greater than`, `less than`, `is_empty`, `is_not_empty`)
  - **Formatted table rendering** — `cli-table3` with column priority (`_id` first, date fields last), auto-truncation at 30 chars
  - **Pagination** — Next/Previous page navigation with cursor-based offset (`n` / `p`)
  - **Export** — `e` action writes current page to a timestamped JSON file
  - **Filter management** — `x` to clear, `r` to refine, `t` to change type
  - **Graceful exit** — `q` or `Ctrl+C` exits cleanly
  - `--env`, `--profile`, `--page-size` options
- [x] `src/utils/table-renderer.ts` — Pure table rendering utility (`buildTableHeaders`, `renderTable`, `truncateCell`, `formatCellValue`)
- [x] `src/utils/query-session.ts` — Immutable REPL state machine (`createSession`, `buildConstraints`, `paginationInfo`, `applyPageResult`, `resetFilters`, `nextPage`, `prevPage`, `currentCursor`)
- [x] `cli-table3@^0.6.3` — Only new production dependency (includes built-in TypeScript types)
- [x] 59 new unit tests → **186 total tests passing** (11 test files)

---

## ✅ v3.2.0 — PII & Privacy Security Audit (Shipped)

- [x] **`audit privacy` command** — Scan Bubble schema or local backup files for exposed PII and privacy risks
  - **Dual scan modes**: Remote schema (live Meta API) + local backup JSON file (`--file`)
  - **8 detection categories**: Credentials (CRITICAL), Financial (CRITICAL), Government IDs (HIGH), Biometric (HIGH), Contact PII (HIGH), Medical (HIGH), Geolocation (MEDIUM), Demographics (MEDIUM)
  - **Case-insensitive + compound matching** — `EMAIL`, `user_Email_Address`, `customer_email` all detected
  - **First-match-wins deduplication** — one finding per field, highest risk wins, no noise
  - **Rich terminal report** — color-coded findings with reasons and Bubble Privacy Rule recommendations
  - **CI exit code** — exits with code `1` on CRITICAL findings (usable in GitHub Actions security gates)
  - `--file <path>` — local backup scan mode
  - `--env <env>` — target environment (remote mode)
  - `--type <name>` — single data type filter
  - `--min-risk MEDIUM|HIGH|CRITICAL` — severity threshold (default: `MEDIUM`)
  - `--json` — machine-readable output for automated pipelines
  - `--profile <name>` — multi-profile support
- [x] `src/utils/pii-scanner.ts` — Pure deterministic engine (`scanTypes`, `scanSchema`, `scanBackupFile`, `PII_PATTERNS`)
- [x] **Infrastructure**: Vitest upgraded to `^4.0.0` for Node.js v24 compatibility; `vitest.config.mjs` created
- [x] 40 new unit tests → **226 total tests passing** (12 test files)

---

## ✅ v3.3.0 — Plugin Extensibility (Shipped)

- [x] **Plugin system** — Extend the CLI with external npm packages or local scripts
  - Auto-discovery of `bubble-io-cli-plugin-*` npm packages
  - Local plugin loading from `~/.bubble-cli/plugins/`
  - `plugin ext list` / `plugin ext info` / `plugin ext reload`
  - Full TypeScript plugin authoring guide in `docs/PLUGIN_AUTHORING.md`
- [x] `src/utils/plugin-loader.ts` — Dynamic plugin discovery and registration
- [x] Published `v3.3.1` patch with build and dependency fixes

---

## ✅ v4.0.0 — CI/CD Automation + Database Integrations (Current)

- [x] **`generate ci --provider github`** — Instant GitHub Actions workflow generator
  - Generates `.github/workflows/bubble-backup.yml` with zero manual YAML editing
  - Nightly cron schedule (configurable), `workflow_dispatch` for manual runs
  - Installs `bubble-io-cli` from npm (latest or pinned version)
  - Reads credentials from GitHub Secrets (`BUBBLE_APP_NAME`, `BUBBLE_API_KEY`)
  - Uploads backup as a GitHub Actions Artifact with configurable retention (1–90 days)
  - Writes a rich summary table to the GitHub Actions UI after each run
  - Options: `--type`, `--env`, `--cron`, `--retention`, `--format`, `--cli-version`, `--output`
- [x] `src/utils/ci-generators/github-actions.ts` — Pure function returning YAML string
  - `generateGitHubActionsWorkflow(opts)` — zero side-effects, fully testable
  - `formatCronHuman()` helper for human-readable schedule descriptions

- [x] **`export db --target sqlite|postgres|bigquery`** — Direct database export
  - **Provider pattern**: `DbProvider` interface with `connect()`, `upsertTable()`, `disconnect()`
  - **Factory**: `getDbProvider(opts)` resolves the correct provider via dynamic import
  - **Idempotent**: safe to re-run — uses upsert semantics (no duplicate records)
  - **Schema inference**: table structure derived automatically from the first batch of records
  - **Schema evolution**: `ALTER TABLE ADD COLUMN` for any new fields in subsequent records
  - **SQLite provider** (`sql.js` — pure JavaScript, zero native compilation required)
    - WAL-mode pragmas enabled; data persisted as binary `.db` file on `disconnect()`
    - Transactional batch insert for maximum performance
  - **PostgreSQL provider** (`pg` — optional `peerDependency`)
    - JSONB columns for objects, TIMESTAMPTZ detection for ISO date strings
    - `ON CONFLICT DO UPDATE` upsert within a single transaction
    - Connection string masked in terminal output (password hidden)
  - **BigQuery provider** (`@google-cloud/bigquery` — optional `peerDependency`)
    - Auto-creates dataset (US region) and table if they do not exist
    - Streaming inserts in batches of 500; `_id` used as `insertId` for deduplication
    - ADC (Application Default Credentials) by default; `--key-file` for service accounts
    - Table naming convention: `bubble_<type>` to avoid conflicts
- [x] `src/services/db-providers/index.ts` — `DbProvider` interface + `getDbProvider()` factory
- [x] `src/services/db-providers/sqlite.ts` — sql.js provider
- [x] `src/services/db-providers/postgres.ts` — pg provider (dynamic import)
- [x] `src/services/db-providers/bigquery.ts` — BigQuery provider (dynamic import)
- [x] `src/commands/export.ts` — `export db` command with 3-step orchestration flow
- [x] `sql.js@^1.12.0` added to `dependencies`
- [x] `pg` and `@google-cloud/bigquery` declared as optional `peerDependencies`

---

## ✅ v4.1.0 — Relational Data Import / Graph Seed (Current)

- [x] **`seed` command upgraded** — now supports a new multi-type relational JSON format with automatic dependency resolution alongside the original legacy format. Format is auto-detected; no flags needed.

- [x] **`_ref` / `@alias` cross-link system:**
  - `"_ref": "@alias"` assigns a temporary local alias to a record (never sent to Bubble)
  - Field values starting with `@` are automatically resolved to real Bubble `_id` before the API call
  - Arrays of references fully supported: `"Sizes": ["@size_14", "@size_16"]`

- [x] **Graph Resolution Engine** — `src/utils/graph-resolver.ts`
  - DAG (Directed Acyclic Graph) construction from seed document
  - Kahn's Algorithm topological sort → unlimited depth (N-levels: A→B→C→…→N)
  - Self-referencing hierarchies (Category tree, org charts, etc.)
  - Automatic circular dependency detection and 2-pass resolution (Create + deferred PATCH)
  - Fails fast with clear errors for unknown aliases or duplicate `_ref` definitions

- [x] **Relational Seeder Engine** — `src/utils/relational-seeder.ts`
  - Sequential execution following topological order
  - In-memory `@ref → Bubble _id` map maintained across all type creations
  - Deferred PATCH phase for circular dependency resolution
  - Real-time progress with per-record spinners
  - `--dry-run` mode: prints full creation order + deferred patches, zero API calls

- [x] **Full backward compatibility** — legacy `{ "type": "...", "records": [...] }` format unchanged
- [x] **Example file** — `examples/relational-seed.json` demonstrates 4-level relational dataset with circular refs
- [x] `src/commands/seed.ts` — auto-routes between legacy and relational engines

---

> 💬 **Have an idea?** [Open a feature request](https://github.com/alexandrmotologa/bubble-io-cli/issues/new?template=feature_request.md) — we'd love to hear from you!
