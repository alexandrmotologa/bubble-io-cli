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

## ✅ v2.1.0 — Community Features (Current)

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

> 💬 **Have an idea?** [Open a feature request](https://github.com/alexandrmotologa/bubble-io-cli/issues/new?template=feature_request.md) — we'd love to hear from you!
